"""Pulls every email address out of a document and lists each one once."""
import argparse
import os
import re

EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file", help="any text file: notes, a saved web page, an exported chat")
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()

    with open(args.file, encoding="utf-8", errors="replace") as f:
        found = EMAIL.findall(f.read())
    unique = sorted({address.lower() for address in found})

    os.makedirs(args.output_dir, exist_ok=True)
    out = os.path.join(args.output_dir, "emails.txt")
    with open(out, "w", encoding="utf-8") as f:
        f.write("\n".join(unique) + ("\n" if unique else ""))
    print(f"Found {len(found)} addresses, {len(unique)} different.")
    print(f"Saved to {out}")


if __name__ == "__main__":
    main()
