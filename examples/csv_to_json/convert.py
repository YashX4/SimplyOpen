"""Turns a spreadsheet file (.csv) into a .json file, one record per row."""
import argparse
import csv
import json
import os


def as_number(text):
    """Returns the text as a number when it looks like one, else unchanged."""
    for kind in (int, float):
        try:
            return kind(text)
        except ValueError:
            pass
    return text


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file", help="the .csv file to convert")
    parser.add_argument("--numbers", action="store_true",
                        help="store values that look like numbers as numbers")
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()

    with open(args.file, newline="", encoding="utf-8-sig") as f:
        records = list(csv.DictReader(f))
    if args.numbers:
        records = [{k: as_number(v) for k, v in r.items()} for r in records]

    os.makedirs(args.output_dir, exist_ok=True)
    name = os.path.splitext(os.path.basename(args.file))[0] + ".json"
    out = os.path.join(args.output_dir, name)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(records, f, indent=2, ensure_ascii=False)

    print(f"Converted {len(records)} rows.")
    print(f"Saved to {out}")


if __name__ == "__main__":
    main()
