"""Tidies a spreadsheet file: trims stray spaces, drops empty rows and repeated rows."""
import argparse
import csv
import os


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file", help="the .csv file to tidy")
    parser.add_argument("--keep-duplicates", action="store_true", help="keep repeated rows")
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()

    with open(args.file, newline="", encoding="utf-8-sig") as f:
        rows = [[cell.strip() for cell in row] for row in csv.reader(f)]

    seen, kept, empty, repeated = set(), [], 0, 0
    for row in rows:
        if not any(row):
            empty += 1
            continue
        key = tuple(row)
        if key in seen and not args.keep_duplicates:
            repeated += 1
            continue
        seen.add(key)
        kept.append(row)

    os.makedirs(args.output_dir, exist_ok=True)
    name = os.path.splitext(os.path.basename(args.file))[0] + "_clean.csv"
    out = os.path.join(args.output_dir, name)
    with open(out, "w", newline="", encoding="utf-8") as f:
        csv.writer(f).writerows(kept)

    print(f"Read {len(rows)} rows.")
    print(f"Removed {empty} empty and {repeated} repeated rows.")
    print(f"Saved {len(kept)} rows to {out}")


if __name__ == "__main__":
    main()
