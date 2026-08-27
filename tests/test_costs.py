import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "tools"))
import costs  # noqa: E402


class CostFixture(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)

    def record(self, **overrides):
        fields = {
            "client": "Jane Doe",
            "company": "Acme",
            "role": "Data Scientist",
            "input_tokens": 100_000,
            "output_tokens": 10_000,
        }
        fields.update(overrides)
        return costs.record_run(root=self.root, **fields)


class PricingTests(CostFixture):
    def test_prices_input_and_output_at_the_published_rates(self):
        # 100k input at $5/M = $0.50; 10k output at $25/M = $0.25.
        entry = self.record()
        self.assertAlmostEqual(0.75, entry["usd"], places=4)

    def test_cache_reads_are_billed_at_a_tenth_of_input(self):
        entry = self.record(input_tokens=0, output_tokens=1, cache_read_tokens=1_000_000)
        # 1M cache-read tokens at $5/M x 0.1 = $0.50, plus a negligible output token.
        self.assertAlmostEqual(0.50, entry["usd"], places=3)

    def test_cache_writes_cost_more_than_plain_input(self):
        written = self.record(input_tokens=0, output_tokens=1, cache_write_tokens=100_000)
        plain = self.record(input_tokens=100_000, output_tokens=1)
        self.assertGreater(written["usd"], plain["usd"])

    def test_a_cheaper_model_costs_less_for_identical_usage(self):
        opus = self.record(model="claude-opus-5")
        haiku = self.record(model="claude-haiku-4-5")
        self.assertLess(haiku["usd"], opus["usd"])

    def test_an_unknown_model_is_refused_rather_than_priced_at_zero(self):
        with self.assertRaises(costs.CostError) as ctx:
            self.record(model="claude-imaginary-9")
        self.assertIn("unknown model", str(ctx.exception))


class LedgerTests(CostFixture):
    def test_runs_append_rather_than_overwrite(self):
        self.record(company="Acme")
        self.record(company="Globex")
        self.assertEqual(2, len(costs.load_runs(self.root)))

    def test_runs_can_be_filtered_to_one_client(self):
        self.record(client="Jane Doe")
        self.record(client="John Smith")
        self.assertEqual(1, len(costs.load_runs(self.root, client="Jane Doe")))

    def test_an_unattributed_run_is_refused(self):
        for missing in ("client", "company", "role"):
            with self.subTest(field=missing):
                with self.assertRaises(costs.CostError):
                    self.record(**{missing: ""})

    def test_a_run_with_no_tokens_is_refused(self):
        with self.assertRaises(costs.CostError):
            self.record(input_tokens=0, output_tokens=0)

    def test_negative_token_counts_are_refused(self):
        with self.assertRaises(costs.CostError):
            self.record(input_tokens=-1)

    def test_a_corrupt_ledger_line_is_reported_with_its_number(self):
        self.record()
        ledger = costs.ledger_path(self.root)
        with ledger.open("a", encoding="utf-8") as handle:
            handle.write("{not json\n")
        with self.assertRaises(costs.CostError) as ctx:
            costs.load_runs(self.root)
        self.assertIn("line 2", str(ctx.exception))

    def test_blank_lines_do_not_break_the_ledger(self):
        self.record()
        with costs.ledger_path(self.root).open("a", encoding="utf-8") as handle:
            handle.write("\n\n")
        self.assertEqual(1, len(costs.load_runs(self.root)))

    def test_the_stored_record_keeps_its_token_counts(self):
        self.record(input_tokens=1234, output_tokens=567)
        stored = json.loads(costs.ledger_path(self.root).read_text().splitlines()[0])
        self.assertEqual(1234, stored["input_tokens"])
        self.assertEqual(567, stored["output_tokens"])


class ReportTests(CostFixture):
    def test_an_empty_ledger_says_so_and_shows_how_to_record(self):
        report = "\n".join(costs.format_report([], margin=0.5))
        self.assertIn("No applications recorded yet", report)
        self.assertIn("costs record", report)

    def test_a_small_sample_refuses_to_produce_a_price(self):
        for _ in range(costs.MIN_SAMPLE_FOR_PRICING - 1):
            self.record()
        report = "\n".join(costs.format_report(costs.load_runs(self.root), margin=0.5))
        self.assertIn("Too few runs to price from", report)
        self.assertNotIn("Price floor", report)

    def test_a_sufficient_sample_prices_above_the_worst_run(self):
        for tokens in (100_000, 120_000, 140_000, 160_000, 400_000):
            self.record(input_tokens=tokens)
        runs = costs.load_runs(self.root)
        report = "\n".join(costs.format_report(runs, margin=0.5))

        self.assertIn("Price floor", report)
        worst = costs.summarise(runs)["worst"]
        # The floor must clear the worst run, not the mean - an average-priced
        # quote loses money on every overflow-fighting application.
        self.assertGreater(worst * 1.5, costs.summarise(runs)["mean"])
        self.assertIn(f"${worst * 1.5:.2f}", report)

    def test_the_report_flags_that_time_is_excluded(self):
        for _ in range(costs.MIN_SAMPLE_FOR_PRICING):
            self.record()
        report = "\n".join(costs.format_report(costs.load_runs(self.root), margin=0.5))
        self.assertIn("excludes your time", report)

    def test_summarise_reports_the_real_spread(self):
        for tokens in (100_000, 200_000, 300_000):
            self.record(input_tokens=tokens)
        stats = costs.summarise(costs.load_runs(self.root))
        self.assertEqual(3, stats["count"])
        self.assertLess(stats["min"], stats["max"])
        self.assertEqual(stats["worst"], stats["max"])


class CommandLineTests(CostFixture):
    def test_record_then_report_exits_zero(self):
        self.assertEqual(0, costs.main([
            "--root", str(self.root), "record",
            "--client", "Jane Doe", "--company", "Acme", "--role", "Data Scientist",
            "--input", "100000", "--output", "10000",
        ]))
        self.assertEqual(0, costs.main(["--root", str(self.root), "report"]))

    def test_recording_an_unknown_model_exits_one(self):
        self.assertEqual(1, costs.main([
            "--root", str(self.root), "record",
            "--client", "Jane Doe", "--company", "Acme", "--role", "X",
            "--model", "claude-imaginary-9", "--input", "1000",
        ]))


if __name__ == "__main__":
    unittest.main()
