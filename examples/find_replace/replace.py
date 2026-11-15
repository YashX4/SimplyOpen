"""Swaps one word or phrase for another everywhere in a text file."""
import argparse
import os
import re


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file", help="the text file to change")
    parser.add_argument("--find", required=True, help="the words to look for")
    parser.add_argument("--replace", default="", help="what to put in their place")
    parser.add_argument("--ignore-case", action="store_true", help="treat capitals and small letters the same")
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()

    with open(args.file, encoding="utf-8") as f:
        text = f.read()
    flags = re.IGNORECASE if args.ignore_case else 0
    changed, times = re.subn(re.escape(args.find), lambda _m: args.replace, text, flags=flags)

    os.makedirs(args.output_dir, exist_ok=True)
    base, ext = os.path.splitext(os.path.basename(args.file))
    out = os.path.join(args.output_dir, f"{base}_replaced{ext}")
    with open(out, "w", encoding="utf-8") as f:
        f.write(changed)
    print(f'Replaced "{args.find}" {times} time(s).')
    print(f"Saved to {out}")


if __name__ == "__main__":
    main()
