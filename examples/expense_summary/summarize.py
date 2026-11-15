"""Adds up a list of expenses by category and by month."""
import argparse
import collections
import csv
import os


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file", help="a .csv file with the columns date (YYYY-MM-DD), category, amount")
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()

    by_category = collections.defaultdict(float)
    by_month = collections.defaultdict(float)
    count = 0
    with open(args.file, newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            amount = float(row["amount"])
            by_category[row["category"].strip() or "Uncategorised"] += amount
            by_month[row["date"].strip()[:7]] += amount
            count += 1
    total = sum(by_category.values())

    os.makedirs(args.output_dir, exist_ok=True)
    out = os.path.join(args.output_dir, "expense_summary.csv")
    with open(out, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["group", "name", "total", "share"])
        for name, amount in sorted(by_category.items(), key=lambda kv: -kv[1]):
            writer.writerow(["category", name, f"{amount:.2f}", f"{amount / total:.0%}" if total else "0%"])
        for name, amount in sorted(by_month.items()):
            writer.writerow(["month", name, f"{amount:.2f}", f"{amount / total:.0%}" if total else "0%"])
        writer.writerow(["all", "total", f"{total:.2f}", "100%"])

    print(f"{count} expenses, {total:.2f} in total.")
    for name, amount in sorted(by_category.items(), key=lambda kv: -kv[1]):
        print(f"  {name}: {amount:.2f}")
    print(f"Saved to {out}")


if __name__ == "__main__":
    main()
