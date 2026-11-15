"""Joins several spreadsheet files into one, even when their columns differ."""
import argparse
import csv
import os


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("files", nargs="+", help="the .csv files to join")
    parser.add_argument("--add-source", action="store_true",
                        help="add a column saying which file each row came from")
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()

    columns, rows = [], []
    for path in args.files:
        with open(path, newline="", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            for column in reader.fieldnames or []:
                if column not in columns:
                    columns.append(column)
            for row in reader:
                if args.add_source:
                    row["source_file"] = os.path.basename(path)
                rows.append(row)
    if args.add_source:
        columns.append("source_file")

    os.makedirs(args.output_dir, exist_ok=True)
    out = os.path.join(args.output_dir, "merged.csv")
    with open(out, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=columns, restval="")
        writer.writeheader()
        writer.writerows(rows)

    print(f"Joined {len(args.files)} files: {len(rows)} rows, {len(columns)} columns.")
    print(f"Saved to {out}")


if __name__ == "__main__":
    main()
