"""Profiles: one self-contained job-search workspace per person, managed by the UI.

A profile is a plain folder (no git) holding a copy of the framework plus that person's data.
Claude runs with the profile as its working directory, so every command, skill and tool reads
that person's CLAUDE.md, tracker, documents and settings - and nothing else.

Framework files are copied from a git ref of the app repo (JOBUI_TEMPLATE_REF, default
`master`), never from the working tree: the app checkout may itself hold someone's personal
data. Files are copied, not symlinked, because tools/*.py find their root with
Path(__file__).resolve() and would otherwise read the app's data. Portal CLI dependencies are
installed per profile with `bun install` (a few seconds; bun clones from its cache) - sharing
the app's node_modules breaks as soon as the app's install is older than the template.
"""
import json
import os
import re
import shutil
import subprocess
import time
from datetime import date
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
HOME = Path(os.environ.get("JOBUI_HOME", "~/JobSearch")).expanduser()
TEMPLATE_REF = os.environ.get("JOBUI_TEMPLATE_REF", "master")
SLUG = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")

# App-only files a profile never needs (and Claude shouldn't wander into).
APP_ONLY = (".github/", "tests/", "ui/", "assets/")
APP_ONLY_FILES = {"CONTRIBUTING.md", "SECURITY.md", "CHANGELOG.md"}

# Files /setup personalizes. Seeded from the template once; sync never overwrites them.
PERSON_SEEDS = (
    "CLAUDE.md",
    ".claude/skills/job-application-assistant/01-candidate-profile.md",
    ".claude/skills/job-application-assistant/02-behavioral-profile.md",
    ".claude/skills/job-application-assistant/03-writing-style.md",
    ".claude/skills/job-application-assistant/04-job-evaluation.md",
    ".claude/skills/job-application-assistant/05-cv-templates.md",
    ".claude/skills/job-application-assistant/06-cover-letter-templates.md",
    ".claude/skills/job-application-assistant/07-interview-prep.md",
    ".claude/skills/job-scraper/search-queries.md",
    "cv/main_example.tex",
    "cover_letters/cover_example.tex",
)
# Folders that hold the person's own data (sync only adds missing template files here).
PERSON_DIRS = ("documents/", "job_scraper/", "company_research/", "upskill/", "templates/")
PORTAL_SKILL = re.compile(r"^\.agents/skills/[^/]+/SKILL\.md$")
ENABLED_LINE = re.compile(r"^enabled:.*$", re.M)

# Setup status: a file still holding one of these tokens has not been personalized.
TOKEN = re.compile(r"\[YOUR[_ ][A-Z_ ]+\]|\[First\]")
REQUIRED = {  # file -> what the UI calls it
    "CLAUDE.md": "Profile summary (CLAUDE.md)",
    ".claude/skills/job-application-assistant/01-candidate-profile.md": "Candidate profile",
    ".claude/skills/job-application-assistant/04-job-evaluation.md": "Job evaluation criteria",
    ".claude/skills/job-application-assistant/05-cv-templates.md": "CV contact block",
    ".claude/skills/job-application-assistant/06-cover-letter-templates.md": "Cover letter signature",
    ".claude/skills/job-scraper/search-queries.md": "Search queries",
    "cv/main_example.tex": "CV template",
    "cover_letters/cover_example.tex": "Cover letter template",
}
OPTIONAL = {
    ".claude/skills/job-application-assistant/02-behavioral-profile.md": "Behavioral profile",
}
DATA_DIRS = ("documents/cv", "documents/linkedin", "documents/diplomas", "documents/references",
             "documents/projects", "documents/postings", "documents/applications",
             "job_scraper", "company_research", "upskill", "cv", "cover_letters", "ui")


class ProfileError(Exception):
    pass


# ---------- registry ----------
def registry_path():
    return HOME / "profiles.json"


def load_registry():
    p = registry_path()
    if not p.exists():
        return {"profiles": []}
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def save_registry(reg):
    HOME.mkdir(parents=True, exist_ok=True)
    tmp = registry_path().with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(reg, f, indent=2, ensure_ascii=False)
    os.replace(tmp, registry_path())


def list_profiles():
    return load_registry()["profiles"]


def get(slug):
    return next((p for p in list_profiles() if p["slug"] == slug), None)


def update(slug, **fields):
    reg = load_registry()
    for p in reg["profiles"]:
        if p["slug"] == slug:
            p.update(fields)
            save_registry(reg)
            return p
    raise ProfileError("no such profile")


# ---------- template ----------
def _git(*args, input=None):
    return subprocess.run(["git", "-C", str(APP), *args], input=input, capture_output=True, check=True).stdout


def template_sha():
    return _git("rev-parse", "--short", TEMPLATE_REF).decode().strip()


def template_files():
    """{path: bytes} for every framework file a profile gets, read from TEMPLATE_REF."""
    names = [n for n in _git("ls-tree", "-r", "--name-only", TEMPLATE_REF).decode("utf-8").splitlines()
             if not n.startswith(APP_ONLY) and n not in APP_ONLY_FILES]
    out = {}
    # One `git cat-file --batch` process for all blobs.
    data = _git("cat-file", "--batch", input="".join(f"{TEMPLATE_REF}:{n}\n" for n in names).encode())
    pos = 0
    for n in names:
        header_end = data.index(b"\n", pos)
        size = int(data[pos:header_end].split()[2])
        out[n] = data[header_end + 1:header_end + 1 + size]
        pos = header_end + 1 + size + 1
    return out


def _is_person_file(rel):
    return rel in PERSON_SEEDS or rel.startswith(PERSON_DIRS)


def install_deps(root, only=None):
    """bun install in each portal CLI of a profile. Returns the CLI folders that failed."""
    bun = shutil.which("bun")
    failed = []
    for pkg in sorted(Path(root).glob(".agents/skills/*/cli/package.json")):
        cli = pkg.parent
        if only is not None and cli not in only:
            continue
        nm = cli / "node_modules"
        if nm.is_symlink():   # left by an older version of this module
            nm.unlink()
        if not bun:
            failed.append(str(cli.relative_to(root)))
            continue
        r = subprocess.run([bun, "install", "--silent"], cwd=cli, capture_output=True, timeout=300)
        if r.returncode:
            failed.append(str(cli.relative_to(root)))
    return failed


# ---------- create / sync ----------
def create(slug, name):
    if not SLUG.match(slug or ""):
        raise ProfileError("Use lowercase letters, digits and dashes for the profile id")
    if get(slug):
        raise ProfileError("A profile with this id already exists")
    root = HOME / "profiles" / slug
    if root.exists():
        raise ProfileError(f"{root} already exists")
    files = template_files()
    for rel, blob in files.items():
        dest = root / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(blob)
    for d in DATA_DIRS:
        (root / d).mkdir(parents=True, exist_ok=True)
    failed = install_deps(root)
    profile = {"slug": slug, "name": (name or slug).strip()[:80], "path": str(root),
               "created": date.today().isoformat(), "template": template_sha(), "gmail": False,
               "deps_missing": failed}
    reg = load_registry()
    reg["profiles"].append(profile)
    save_registry(reg)
    return profile


def register_existing(slug, name, path, gmail=True):
    """Add an existing workspace (e.g. a checkout that predates profiles) without copying it."""
    if not SLUG.match(slug or "") or get(slug):
        raise ProfileError("invalid or duplicate profile id")
    path = Path(path).expanduser().resolve()
    if not (path / "CLAUDE.md").exists():
        raise ProfileError(f"{path} does not look like a job-search workspace")
    profile = {"slug": slug, "name": name, "path": str(path), "created": date.today().isoformat(),
               "template": None, "gmail": gmail, "external": True}
    reg = load_registry()
    reg["profiles"].append(profile)
    save_registry(reg)
    return profile


def _version(blob):
    m = re.search(rb"framework_version:\s*([^\s]+)", blob[:600])
    return m.group(1).decode() if m else None


def sync(slug, dry_run=False):
    """Bring a profile's framework files up to the template. Person files are never overwritten;
    a personalized file whose template methodology version moved on is reported for merging."""
    profile = get(slug)
    if not profile:
        raise ProfileError("no such profile")
    if profile.get("external"):
        raise ProfileError("This workspace is managed by git, not by the UI - update it with git")
    root = Path(profile["path"])
    report = {"updated": [], "added": [], "needs_merge": []}
    for rel, blob in template_files().items():
        dest = root / rel
        if not dest.exists():
            report["added"].append(rel)
            if not dry_run:
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(blob)
            continue
        current = dest.read_bytes()
        if current == blob:
            continue
        if _is_person_file(rel):
            if _version(blob) and _version(blob) != _version(current):
                report["needs_merge"].append(rel)
            continue
        if PORTAL_SKILL.match(rel):
            m = ENABLED_LINE.search(current.decode("utf-8"))
            if m:   # keep the profile's on/off choice for this portal
                blob = ENABLED_LINE.sub(lambda _: m.group(0), blob.decode("utf-8"), count=1).encode()
                if blob == current:
                    continue
        report["updated"].append(rel)
        if not dry_run:
            dest.write_bytes(blob)
    if not dry_run:
        # Reinstall a portal's dependencies when its package.json changed or they were never installed.
        stale = {(root / rel).parent for rel in report["updated"] + report["added"] if rel.endswith("cli/package.json")}
        stale |= {p.parent for p in root.glob(".agents/skills/*/cli/package.json") if not (p.parent / "node_modules").is_dir()}
        failed = install_deps(root, only=stale) if stale else []
        update(slug, template=template_sha(), synced=time.strftime("%Y-%m-%d %H:%M"), deps_missing=failed)
    return report


# ---------- status ----------
def status(path):
    """new: nothing personalized yet; partial: some required files still hold template tokens;
    ready: every required file is personalized."""
    root = Path(path)
    missing, optional = [], []
    for rel, label in REQUIRED.items():
        f = root / rel
        if not f.exists() or TOKEN.search(f.read_text(encoding="utf-8", errors="replace")):
            missing.append({"file": rel, "label": label})
    for rel, label in OPTIONAL.items():
        f = root / rel
        if f.exists() and TOKEN.search(f.read_text(encoding="utf-8", errors="replace")):
            optional.append({"file": rel, "label": label})
    claude_md = root / "CLAUDE.md"
    fresh = not claude_md.exists() or "[YOUR_NAME]" in claude_md.read_text(encoding="utf-8", errors="replace")
    state = "new" if fresh else ("partial" if missing else "ready")
    docs = sum(1 for d in ("cv", "linkedin", "diplomas", "references", "projects")
               for f in (root / "documents" / d).glob("*") if f.is_file() and not f.name.startswith("."))
    return {"state": state, "missing": missing, "optional": optional, "documents": docs}


# ---------- export ----------
def export_zip(slug, dest_dir):
    profile = get(slug)
    if not profile:
        raise ProfileError("no such profile")
    root = Path(profile["path"])
    base = Path(dest_dir) / f"{slug}-{time.strftime('%Y%m%d-%H%M')}"
    # node_modules are symlinks into the app; leave them out of the backup.
    tmp = Path(dest_dir) / f".export-{slug}"
    if tmp.exists():
        shutil.rmtree(tmp)
    shutil.copytree(root, tmp, symlinks=True, ignore=shutil.ignore_patterns("node_modules"))
    out = shutil.make_archive(str(base), "zip", tmp)
    shutil.rmtree(tmp)
    return out
