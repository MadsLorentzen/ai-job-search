"""Offline tests for tools/verify_layout.py.

Every case is built from synthetic Page/Line geometry rather than a compiled
PDF, so the suite needs neither Poppler nor a LaTeX toolchain - matching the
repo's CI policy of keeping the Python tool tests self-contained.

The cases marked SILENT FAILURE are the ones that motivated the tool: each
describes a document that compiles cleanly, reports the expected page count,
and passes tools/verify_pdf.py, while the rendered page is visibly broken.
"""

import io
import sys
import unittest
from contextlib import redirect_stdout
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "tools"))

from verify_layout import Page, Line, find_orphans, report  # noqa: E402

A4_HEIGHT = 842.0


def line(top: float, left: float = 50.0, height: float = 10.0, text: str = "x") -> Line:
    return Line(top=top, bottom=top + height, left=left, height=height, text=text)


class TestGapAndBottomSpace(unittest.TestCase):
    def setUp(self):
        # Three body lines, then a 322pt jump, then the page-number footer.
        self.holed = Page(
            A4_HEIGHT,
            [line(50), line(64), line(78), line(400), line(770, text="1/2")],
        )

    def test_largest_gap_reports_size_and_position(self):
        """SILENT FAILURE: the hole an ejected \\cventry leaves behind."""
        gap, y = self.holed.largest_gap()
        self.assertEqual((round(gap), round(y)), (322, 78))

    def test_bottom_space_ignores_the_footer_band(self):
        """Measured to the last body line (y410), not to the page number at y770."""
        self.assertEqual(round(self.holed.bottom_space), 432)

    def test_page_with_no_body_lines_is_empty(self):
        self.assertTrue(Page(A4_HEIGHT, []).empty)

    def test_report_flags_the_hole(self):
        with redirect_stdout(io.StringIO()):  # report() prints its per-page measurements
            problems = report(Path("synthetic"), [self.holed])
        self.assertTrue(any("hole" in m for m in problems), problems)


class TestFooterBand(unittest.TestCase):
    def test_single_line_in_band_is_just_the_page_number(self):
        self.assertFalse(Page(A4_HEIGHT, [line(50), line(800, text="2/2")]).footer_crowded)

    def test_two_lines_in_band_means_body_text_spilled_in(self):
        """SILENT FAILURE: \\enlargethispage pushing body text over the footer."""
        self.assertTrue(Page(A4_HEIGHT, [line(50), line(780), line(800)]).footer_crowded)


class TestHeadingAndIndentDetection(unittest.TestCase):
    def setUp(self):
        self.page = Page(
            A4_HEIGHT,
            [
                line(50, height=16.0, text="Professional Experience"),
                line(80, left=50.0),
                line(94, left=70.0),
            ],
        )

    def test_taller_line_is_a_heading(self):
        self.assertTrue(self.page.is_heading(self.page.body[0]))
        self.assertFalse(self.page.is_heading(self.page.body[1]))

    def test_left_edge_separates_bullets_from_headers(self):
        self.assertTrue(self.page.is_indented(self.page.body[2]))
        self.assertFalse(self.page.is_indented(self.page.body[1]))


class TestOrphans(unittest.TestCase):
    def test_page_ending_on_a_section_heading(self):
        """SILENT FAILURE: a heading stranded at the bottom, content overleaf."""
        p1 = Page(A4_HEIGHT, [line(50), line(64), line(700, height=16.0, text="Education")])
        p2 = Page(A4_HEIGHT, [line(60, text="Example University"), line(74, left=70.0)])
        self.assertTrue(any("ends on the section heading" in m for m in find_orphans([p1, p2])))

    def test_entry_header_orphaned_from_its_bullets(self):
        """SILENT FAILURE: the \\cventry title on one page, its bullets on the next."""
        q1 = Page(A4_HEIGHT, [line(50), line(700, left=50.0, text="Software Engineer")])
        q2 = Page(A4_HEIGHT, [line(60, left=70.0, text="- built the thing")])
        self.assertTrue(any("orphaned from its bullets" in m for m in find_orphans([q1, q2])))

    def test_lone_list_marker_is_a_split_bullet_not_an_orphaned_header(self):
        """moderncv gives the itemize marker its own bbox line: different defect, different fix."""
        m1 = Page(A4_HEIGHT, [line(50), line(700, left=50.0, text="●")])
        m2 = Page(A4_HEIGHT, [line(60, left=70.0, text="continued item text here")])
        self.assertTrue(any("lone list marker" in m for m in find_orphans([m1, m2])))

    def test_clean_break_reports_nothing(self):
        r1 = Page(A4_HEIGHT, [line(50), line(700, left=50.0)])
        r2 = Page(A4_HEIGHT, [line(60, left=50.0)])
        self.assertEqual(find_orphans([r1, r2]), [])

    def test_indent_is_judged_against_the_document_margin(self):
        """A page that OPENS with bullets must not mistake their indent for its margin."""
        s1 = Page(A4_HEIGHT, [line(50, left=50.0), line(700, left=50.0, text="Data Analyst")])
        s2 = Page(A4_HEIGHT, [line(60, left=70.0, text="- first bullet")])
        self.assertTrue(any("orphaned from its bullets" in m for m in find_orphans([s1, s2])))


if __name__ == "__main__":
    unittest.main()
