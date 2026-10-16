"""tools/extract_contacts.py: who a posting says to talk to, and nothing more.

Cases are modelled on real Dublin postings from a scrape batch (names and
addresses replaced): a named agency recruiter, a named academic contact with a
published address, recruiting inboxes, and the accommodation/privacy addresses
that must never become cold-outreach targets.
"""

import json
import subprocess
import sys
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "tools"))

from extract_contacts import extract  # noqa: E402


def kinds(contacts):
    return [(c["kind"], c["name"], c["email"]) for c in contacts]


class NamedContacts(unittest.TestCase):
    def test_lead_in_name_without_address(self):
        text = "For a confidential discussion, contact Jane Doe at Example Group today."
        self.assertEqual(kinds(extract(text)), [("named", "Jane Doe", None)])

    def test_name_with_role_after_it(self):
        text = "Your recruiter: Sam Byrne, Talent Acquisition Manager, Example Ltd."
        c = extract(text)
        self.assertEqual(c[0]["name"], "Sam Byrne")
        self.assertEqual(c[0]["role"], "Talent Acquisition Manager")

    def test_role_before_name(self):
        c = extract("Recruiter - Aoife Kelly. Apply via the careers site.")
        self.assertEqual(c[0]["name"], "Aoife Kelly")

    def test_informal_enquiries_with_title_and_published_address(self):
        text = (
            "Informal Enquiries in relation to this role should be directed to: "
            "Dr Ann Murphy, Assistant Professor. Email: ann.murphy@example.ie "
            "Please do not send applications to this email."
        )
        self.assertEqual(kinds(extract(text))[0], ("named", "Ann Murphy", "ann.murphy@example.ie"))

    def test_a_first_dot_last_address_alone_is_a_person(self):
        c = extract("Questions? Write to liam.walsh@example.com.")
        self.assertEqual(kinds(c), [("named", "Liam Walsh", "liam.walsh@example.com")])

    def test_team_words_are_not_names(self):
        self.assertEqual(extract("Please contact Talent Acquisition Team for details."), [])


class Inboxes(unittest.TestCase):
    def test_recruiting_inboxes_are_kept_and_classified(self):
        text = "Please reach out to recruiting@example.com. CVs to hr@example.ie."
        self.assertEqual(
            sorted(kinds(extract(text))),
            [("recruiting_inbox", None, "hr@example.ie"),
             ("recruiting_inbox", None, "recruiting@example.com")],
        )

    def test_trailing_full_stop_is_not_part_of_the_address(self):
        self.assertEqual(extract("Send it to careers@example.com.")[0]["email"],
                         "careers@example.com")

    def test_named_contacts_sort_before_inboxes(self):
        text = "Email jobs@example.com or contact Jane Doe directly."
        self.assertEqual(extract(text)[0]["kind"], "named")


class AddressesThatAreNotOutreachChannels(unittest.TestCase):
    """Published for another purpose: cold-emailing them is misuse."""

    def test_accommodation_address_by_context(self):
        text = ("If you require any accommodations during the recruitment process "
                "please contact careers@example.ie and we will support you.")
        self.assertEqual(extract(text), [])

    def test_accommodation_purpose_far_before_the_address(self):
        # Real Bio-Techne wording: the purpose word sits ~150 characters before hr@.
        text = ("If you require a reasonable accommodation to complete an application, "
                "participate in an interview, or take part in any other stage of the "
                "recruitment process, please contact hr@example.com for assistance.")
        self.assertEqual(extract(text), [])

    def test_a_recruiting_address_in_the_next_sentence_survives(self):
        text = ("We provide reasonable accommodations on request. "
                "To discuss the role, email recruiting@example.com.")
        self.assertEqual(extract(text)[0]["email"], "recruiting@example.com")

    def test_accommodation_address_by_local_part(self):
        self.assertEqual(extract("Email accommodations@example.com for help."), [])

    def test_privacy_and_noreply(self):
        text = ("To contact us about your data, use info@example.com. "
                "Replies to noreply@example.com are not read. dpo@example.com")
        self.assertEqual(extract(text), [])


class CommandLine(unittest.TestCase):
    def run_tool(self, *args, stdin=""):
        return subprocess.run(
            [sys.executable, str(REPO / "tools" / "extract_contacts.py"), *args],
            input=stdin, capture_output=True, text=True, encoding="utf-8",
        )

    def test_stdin_round_trip(self):
        proc = self.run_tool(stdin="Contact Jane Doe or careers@example.com.")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(len(json.loads(proc.stdout)["contacts"]), 2)

    def test_portal_detail_json(self):
        tmp = REPO / "tests" / "_tmp_detail.json"
        tmp.write_text(json.dumps({"result": {"description": "Email talent@example.com"}}))
        try:
            proc = self.run_tool("--json", str(tmp))
        finally:
            tmp.unlink()
        self.assertEqual(json.loads(proc.stdout)["contacts"][0]["email"], "talent@example.com")

    def test_unreadable_input_exits_2(self):
        self.assertEqual(self.run_tool("--text-file", "/nonexistent/x.txt").returncode, 2)


if __name__ == "__main__":
    unittest.main()
