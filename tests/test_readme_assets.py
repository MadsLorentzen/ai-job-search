"""Every local image referenced by README.md must exist in the repo.

A broken header image on the repo landing page is a silent, high-visibility
failure; this guard turns it into a red CI run instead.
"""
import re
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
README = REPO / "README.md"

IMG_SRC = re.compile(r'<img[^>]+src="([^"]+)"')
MD_IMG = re.compile(r"!\[[^\]]*\]\(([^)\s]+)")


class ReadmeImageReferences(unittest.TestCase):
    def _local_refs(self):
        text = README.read_text(encoding="utf-8")
        refs = IMG_SRC.findall(text) + MD_IMG.findall(text)
        return [r for r in refs if not r.startswith(("http://", "https://"))]

    def test_readme_exists_and_references_at_least_one_local_image(self):
        refs = self._local_refs()
        self.assertGreaterEqual(len(refs), 1, "README lost its mascot header image")

    def test_all_local_image_references_resolve(self):
        for ref in self._local_refs():
            with self.subTest(ref=ref):
                self.assertTrue((REPO / ref).is_file(), f"README references missing file: {ref}")


if __name__ == "__main__":
    unittest.main()
