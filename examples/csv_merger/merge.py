"""Combine several CSV spreadsheets into one.

Usage:
    python merge.py january.csv february.csv --output-dir results
    python merge.py *.csv --output-dir results --remove-duplicates --sort-by name
"""

import argparse
import sys
from pathlib import Path

import pandas as pd


def main() -> int:
    parser = argparse.ArgumentParser(description="Combine CSV spreadsheets into one.")
    parser.add_argument("files", nargs="+", help="The CSV files to combine")
    parser.add_argument("--output-dir", required=True, help="Folder to save the combined file in")
    parser.add_argument("--remove-duplicates", action="store_true", help="Drop rows that appear more than once")
    parser.add_argument("--sort-by", default="", help="Name of a column to sort the result by")
    args = parser.parse_args()

    tables = []
    for name in args.files:
        table = pd.read_csv(name)
        print(f"Read {Path(name).name}: {len(table)} rows")
        tables.append(table)

    # Columns that only some files have are kept, and left empty for the rest.
    combined = pd.concat(tables, ignore_index=True)
    print(f"Combined: {len(combined)} rows, {len(combined.columns)} columns")

    if args.remove_duplicates:
        before = len(combined)
        # Two rows count as the same when the columns every file shares match.
        shared = [c for c in combined.columns if all(c in t.columns for t in tables)]
        combined = combined.drop_duplicates(subset=shared or None, keep="last")
        print(f"Removed {before - len(combined)} duplicate rows")

    if args.sort_by:
        if args.sort_by not in combined.columns:
            columns = ", ".join(combined.columns)
            print(f'There is no column called "{args.sort_by}". The columns are: {columns}', file=sys.stderr)
            return 1
        combined = combined.sort_values(args.sort_by)

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    target = output_dir / "combined.csv"
    combined.to_csv(target, index=False)
    print(f"Saved {target.name} ({len(combined)} rows)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
