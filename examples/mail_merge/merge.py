"""Writes one personal letter per person from a single letter and a list of people."""
import argparse
import csv
import os
import re


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--template", required=True,
                        help="the letter, with blanks written like {name} or {amount}")
    parser.add_argument("--people", required=True,
                        help="a .csv file whose column names match the blanks")
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()

    with open(args.template, encoding="utf-8") as f:
        template = f.read()
    with open(args.people, newline="", encoding="utf-8-sig") as f:
        people = list(csv.DictReader(f))

    missing = set()

    def fill(row):
        def blank(match):
            key = match.group(1).strip()
            if key not in row:
                missing.add(key)
                return match.group(0)
            return row[key]
        return re.sub(r"\{([^{}]+)\}", blank, template)

    os.makedirs(args.output_dir, exist_ok=True)
    for number, row in enumerate(people, 1):
        first = next(iter(row.values()), "") or ""
        safe = re.sub(r"[^A-Za-z0-9]+", "_", first).strip("_") or "letter"
        with open(os.path.join(args.output_dir, f"{number:03d}_{safe}.txt"), "w", encoding="utf-8") as f:
            f.write(fill(row))

    print(f"Wrote {len(people)} letters to {args.output_dir}")
    if missing:
        print("These blanks have no matching column and were left as they are: " + ", ".join(sorted(missing)))


if __name__ == "__main__":
    main()
