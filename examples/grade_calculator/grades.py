"""Works out each student's average and letter grade from a sheet of scores."""
import argparse
import csv
import os

LETTERS = [(90, "A"), (80, "B"), (70, "C"), (60, "D")]


def letter(average):
    for least, mark in LETTERS:
        if average >= least:
            return mark
    return "F"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file", help="a .csv file: first column is the name, the rest are scores out of 100")
    parser.add_argument("--pass-mark", type=float, default=60, help="the lowest passing average")
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()

    with open(args.file, newline="", encoding="utf-8-sig") as f:
        rows = list(csv.reader(f))
    header, students = rows[0], [r for r in rows[1:] if any(c.strip() for c in r)]

    results, passed = [], 0
    for row in students:
        scores = [float(c) for c in row[1:] if c.strip()]
        average = sum(scores) / len(scores) if scores else 0.0
        ok = average >= args.pass_mark
        passed += ok
        results.append(row + [f"{average:.1f}", letter(average), "pass" if ok else "fail"])

    os.makedirs(args.output_dir, exist_ok=True)
    out = os.path.join(args.output_dir, "grades.csv")
    with open(out, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(header + ["average", "grade", "result"])
        writer.writerows(results)

    for row in results:
        print(f"{row[0]}: {row[-3]} ({row[-2]})")
    print(f"{passed} of {len(results)} passed. Saved to {out}")


if __name__ == "__main__":
    main()
