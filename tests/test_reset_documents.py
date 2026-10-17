"""Replay /reset's actual Bash commands against isolated document files."""
import errno
import os
import re
import shutil
import subprocess
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

COMMAND = Path(__file__).resolve().parent.parent / ".claude/commands/reset.md"
FOLDERS = ("cv", "linkedin", "diplomas", "references", "projects", "postings", "applications")
BASH = shutil.which("bash")


def symlinks_available():
    """Probe only the filesystem capability needed by the scope controls."""
    with TemporaryDirectory() as directory:
        root = Path(directory)
        target = root / "target"
        target.touch()
        try:
            (root / "link").symlink_to(target)
        except NotImplementedError:
            return False
        except OSError as exc:
            if exc.errno in (errno.ENOSYS, errno.ENOTSUP, errno.EPERM):
                return False
            if os.name == "nt" and getattr(exc, "winerror", None) in (5, 1314):
                return False
            raise
        return True


SYMLINKS = bool(BASH) and symlinks_available()


@unittest.skipUnless(BASH, "requires Bash to replay the documented /reset command")
class ResetDocuments(unittest.TestCase):
    def reset_script(self):
        section = COMMAND.read_text(encoding="utf-8").split("### Documents reset", 1)[1]
        return re.search(r"```bash\n(.*?)```", section, re.S).group(1)

    def run_reset(self, populated):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            documents = root / "documents"
            documents.mkdir()
            readme = documents / "README.md"
            readme.write_text("Keep these framework instructions.\n")
            sibling = root / "outside-documents.md"
            sibling.write_text("Keep this external file.\n")
            for name in FOLDERS:
                folder = documents / name
                folder.mkdir()
                (folder / ".gitkeep").write_text("Keep this scaffold.\n")
                if populated:
                    (folder / "summary.md").write_text("A document\n")
                    (folder / ".source.md").write_text("A hidden document\n")
                    nested = folder / "project-or-application"
                    nested.mkdir()
                    (nested / "README.md").write_text("A nested document\n")
            result = subprocess.run([BASH, "-c", self.reset_script()], cwd=root, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stderr, "")
            self.assertEqual(readme.read_text(), "Keep these framework instructions.\n")
            self.assertEqual(sibling.read_text(), "Keep this external file.\n")
            self.assertEqual({path.name for path in documents.iterdir()}, {*FOLDERS, "README.md"})
            for name in FOLDERS:
                self.assertEqual([path.name for path in (documents / name).iterdir()], [".gitkeep"])
                self.assertEqual((documents / name / ".gitkeep").read_text(), "Keep this scaffold.\n")

    def test_all_document_entries_are_removed_without_removing_the_scaffold(self):
        self.run_reset(populated=True)

    def test_empty_document_folders_remain_usable(self):
        self.run_reset(populated=False)

    @unittest.skipUnless(SYMLINKS, "requires filesystem symlinks and Windows symlink privilege")
    def test_symlinked_roots_stop_before_any_deletion(self):
        for linked_root in ("documents", *(f"documents/{name}" for name in FOLDERS)):
            with self.subTest(linked_root=linked_root), TemporaryDirectory() as directory:
                root = Path(directory)
                outside = root / "outside"
                outside.mkdir()
                sentinel = outside / "keep.md"
                sentinel.write_text("External document.\n")
                documents = root / "documents"
                documents.mkdir()
                for name in FOLDERS:
                    folder = documents / name
                    folder.mkdir()
                    (folder / "local.md").write_text("Local document.\n")
                target = root / linked_root
                shutil.rmtree(target)
                target.symlink_to(outside, target_is_directory=True)
                locals_before = [path for name in FOLDERS for path in (documents / name).glob("local.md")]
                result = subprocess.run([BASH, "-c", self.reset_script()], cwd=root, capture_output=True, text=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("symbolic link", result.stderr)
                self.assertEqual(sentinel.read_text(), "External document.\n")
                for path in locals_before:
                    self.assertEqual(path.read_text(), "Local document.\n")

    @unittest.skipUnless(SYMLINKS, "requires filesystem symlinks and Windows symlink privilege")
    def test_internal_symlink_is_removed_without_following_its_target(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            outside = root / "outside"
            outside.mkdir()
            sentinel = outside / "keep.md"
            sentinel.write_text("External document.\n")
            for name in FOLDERS:
                (root / "documents" / name).mkdir(parents=True)
            link = root / "documents/projects/external"
            link.symlink_to(outside, target_is_directory=True)
            result = subprocess.run([BASH, "-c", self.reset_script()], cwd=root, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse(link.is_symlink())
            self.assertEqual(sentinel.read_text(), "External document.\n")
