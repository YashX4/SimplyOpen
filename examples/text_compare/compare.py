"""Shows what changed between two versions of a document, side by side."""
import argparse
import difflib
import os


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--old", required=True, help="the earlier version")
    parser.add_argument("--new", required=True, help="the later version")
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()

    with open(args.old, encoding="utf-8", errors="replace") as f:
        old = f.read().splitlines()
    with open(args.new, encoding="utf-8", errors="replace") as f:
        new = f.read().splitlines()

    added = removed = 0
    for line in difflib.ndiff(old, new):
        added += line.startswith("+ ")
        removed += line.startswith("- ")

    page = difflib.HtmlDiff(wrapcolumn=70).make_file(
        old, new, os.path.basename(args.old), os.path.basename(args.new))
    os.makedirs(args.output_dir, exist_ok=True)
    out = os.path.join(args.output_dir, "comparison.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(page)

    if added or removed:
        print(f"{added} line(s) added or changed in the new version, {removed} removed or changed from the old.")
    else:
        print("The two versions are the same.")
    print(f"Saved to {out}")


if __name__ == "__main__":
    main()
