"""Keep tracker-only Notion keys aligned with /scrape's executable producer.

The markdown is the command implementation. The derived test executes the
command it prescribes, then compares it with the actual /scrape key producer;
this is a local workflow-contract check, not live Notion acceptance.
"""
import re
import shlex
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPEC = ROOT / '.claude/commands/notion-sync.md'
SCRAPER = ROOT / '.claude/skills/job-scraper/SKILL.md'


class NotionSyncKeys(unittest.TestCase):
    def test_tracker_only_uses_the_scraper_key_producer(self):
        text = SPEC.read_text(encoding='utf-8')
        step2 = text.split('## Step 2:', 1)[1].split('## Step 3:', 1)[0]
        command = re.search(r'^python3 tools/job_key\.py .+$', step2, re.M)
        self.assertIsNotNone(command, 'tracker-only keys must use the executable /scrape producer')
        scrape_command = re.search(
            r'^python3 tools/job_key\.py .+$', SCRAPER.read_text(encoding='utf-8'), re.M
        ).group()
        # These are /apply's persisted fields: role and source, whereas the
        # scraper's corresponding fields are title and url. Include non-Latin
        # identity and a numeric portal URL, not just an ASCII replacement rule.
        for company, role, url in (
            ('Acme Corp', 'ML Engineer', 'https://example.com/jobs/ml-engineer'),
            ('Код Безопасности', 'Инженер', 'https://example.com/jobs/1234567'),
            ('Acme', 'ML Engineer', ''),
        ):
            with self.subTest(company=company):
                values = {'company': company, 'role': role, 'source': url, 'title': role, 'url': url}
                def run(template):
                    args = [values.get(arg[1:-1], arg) if arg.startswith('<') else arg
                            for arg in shlex.split(template)]
                    args[0] = sys.executable
                    result = subprocess.run(args, cwd=ROOT, capture_output=True, text=True, check=True)
                    return result.stdout.strip()
                self.assertEqual(run(command.group()), run(scrape_command))

    def test_legacy_lookup_is_narrow_and_never_overwrites_page_bodies(self):
        text = SPEC.read_text(encoding='utf-8')
        step4 = text.split('## Step 4:', 1)[1].split('## Step 5:', 1)[0]
        for rule in (
            'documented legacy tracker-only fallback Key',
            'historical runs may have normalized it differently',
            'first verify its Company and Name match',
            'when both posting URLs are known, require them to match too',
            'If identity is missing or differs, report a Key conflict and skip that job',
            'Never derive a legacy Key for a job without a tracker row',
            'exactly one legacy page and no canonical page',
            'update that page\'s Key to the canonical Key',
            'do not rewrite its body',
            'distinct canonical and legacy pages',
            'report a Key conflict and skip that job',
            'never merge or delete pages',
            'not a general migration of changed scraper keys',
        ):
            self.assertIn(rule, step4)


if __name__ == '__main__':
    unittest.main()
