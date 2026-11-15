"""Finds files in a folder that are exact copies of each other."""
import argparse
import collections
import hashlib
import os


def fingerprint(path):
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("folder", help="the folder to look through (including folders inside it)")
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()

    groups = collections.defaultdict(list)
    total = 0
    for root, _dirs, files in os.walk(args.folder):
        for name in sorted(files):
            path = os.path.join(root, name)
            groups[fingerprint(path)].append(os.path.relpath(path, args.folder))
            total += 1
    copies = [sorted(paths) for paths in groups.values() if len(paths) > 1]
    copies.sort()

    lines = [f"Looked at {total} files. Found {len(copies)} set(s) of identical files.", ""]
    for number, paths in enumerate(copies, 1):
        lines.append(f"Set {number}:")
        lines += [f"  {p}" for p in paths]
        lines.append("")

    os.makedirs(args.output_dir, exist_ok=True)
    out = os.path.join(args.output_dir, "duplicates_report.txt")
    with open(out, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(lines[0])
    print(f"Saved the list to {out}")


if __name__ == "__main__":
    main()
