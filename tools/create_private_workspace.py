"""Create a separate, non-Git career workspace from tracked framework files."""
import argparse
import json
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def create(destination, source=ROOT):
    source, destination = Path(source).resolve(), Path(destination).resolve()
    if destination.exists():
        raise ValueError('Destination exists; refusing to overwrite career data')
    for ancestor in (destination, *destination.parents):
        if (ancestor / '.git').exists():
            raise ValueError('Destination must be outside all Git repositories')
    files = subprocess.check_output(['git', '-C', str(source), 'ls-files', '-z']).decode().split('\0')
    paths = [Path(name) for name in files if name]
    for path in paths:
        origin = source / path
        if path.is_absolute() or '..' in path.parts or origin.is_symlink() or not origin.is_file():
            raise ValueError(f'Unsafe or missing tracked file: {path}')
    revision = subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip()
    destination.mkdir(parents=True)
    for path in paths:
        target = destination / path
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source / path, target)
    (destination / '.gitignore').write_text('*\n', encoding='utf-8')
    (destination / '.private-workspace.json').write_text(json.dumps({'source_commit': revision, 'git_enabled': False}), encoding='utf-8')
    return destination


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('destination', nargs='?', type=Path, default=ROOT.parent / 'ai-job-search-private')
    args = parser.parse_args()
    try:
        print(create(args.destination))
    except (ValueError, OSError, subprocess.CalledProcessError) as exc:
        parser.exit(1, f'Workspace not created: {exc}\n')

if __name__ == '__main__':
    main()
