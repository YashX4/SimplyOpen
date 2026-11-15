"""Counts the answers to each question in a survey and draws a simple bar for each."""
import argparse
import collections
import csv
import os

BAR = 30


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file", help="a .csv file: one row per person, one column per question")
    parser.add_argument("--skip-first-column", action="store_true",
                        help="ignore the first column (for example a time or a name)")
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()

    with open(args.file, newline="", encoding="utf-8-sig") as f:
        rows = list(csv.reader(f))
    questions, answers = rows[0], rows[1:]
    start = 1 if args.skip_first_column else 0

    report = [f"{len(answers)} people answered.", ""]
    for column in range(start, len(questions)):
        counts = collections.Counter(
            row[column].strip() for row in answers if column < len(row) and row[column].strip())
        answered = sum(counts.values())
        report.append(questions[column])
        width = max((len(a) for a in counts), default=0)
        for answer, count in counts.most_common():
            bar = "#" * max(1, round(BAR * count / answered))
            report.append(f"  {answer.ljust(width)}  {bar} {count} ({count / answered:.0%})")
        report.append("")

    os.makedirs(args.output_dir, exist_ok=True)
    out = os.path.join(args.output_dir, "survey_results.txt")
    with open(out, "w", encoding="utf-8") as f:
        f.write("\n".join(report))
    print("\n".join(report))
    print(f"Saved to {out}")


if __name__ == "__main__":
    main()
