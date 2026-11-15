"""Sorts a messy folder into tidy folders by type: Pictures, Documents, Music and so on."""
import argparse
import os
import shutil

KINDS = {
    "Pictures": {".png", ".jpg", ".jpeg", ".gif", ".webp", ".heic", ".svg"},
    "Documents": {".pdf", ".doc", ".docx", ".txt", ".md", ".rtf", ".odt"},
    "Spreadsheets": {".csv", ".xls", ".xlsx", ".ods"},
    "Music": {".mp3", ".wav", ".m4a", ".flac"},
    "Videos": {".mp4", ".mov", ".avi", ".mkv"},
    "Archives": {".zip", ".tar", ".gz", ".7z"},
}


def kind_of(name):
    ext = os.path.splitext(name)[1].lower()
    for kind, extensions in KINDS.items():
        if ext in extensions:
            return kind
    return "Other"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("folder", help="the messy folder")
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()

    counts = {}
    for name in sorted(os.listdir(args.folder)):
        path = os.path.join(args.folder, name)
        if not os.path.isfile(path) or name.startswith("."):
            continue
        kind = kind_of(name)
        target = os.path.join(args.output_dir, kind)
        os.makedirs(target, exist_ok=True)
        shutil.copy2(path, os.path.join(target, name))
        counts[kind] = counts.get(kind, 0) + 1

    for kind, count in sorted(counts.items()):
        print(f"{kind}: {count} file(s)")
    print(f"Sorted copies are in {args.output_dir}. The original folder was not changed.")


if __name__ == "__main__":
    main()
