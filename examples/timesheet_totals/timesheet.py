"""Adds up the hours each person worked from a list of start and finish times."""
import argparse
import collections
import csv
import os


def minutes(clock):
    hours, mins = clock.strip().split(":")
    return int(hours) * 60 + int(mins)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file", help="a .csv file with the columns name, date, start, end (times like 09:00)")
    parser.add_argument("--hourly-rate", type=float, default=None, help="pay per hour, to work out wages")
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()

    worked = collections.defaultdict(int)
    shifts = collections.Counter()
    with open(args.file, newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            length = minutes(row["end"]) - minutes(row["start"])
            if length < 0:
                length += 24 * 60          # a shift that runs past midnight
            worked[row["name"].strip()] += length
            shifts[row["name"].strip()] += 1

    os.makedirs(args.output_dir, exist_ok=True)
    out = os.path.join(args.output_dir, "hours.csv")
    with open(out, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["name", "shifts", "hours"] + (["pay"] if args.hourly_rate is not None else []))
        for name in sorted(worked):
            hours = worked[name] / 60
            row = [name, shifts[name], f"{hours:.2f}"]
            line = f"{name}: {hours:.2f} hours over {shifts[name]} shift(s)"
            if args.hourly_rate is not None:
                row.append(f"{hours * args.hourly_rate:.2f}")
                line += f", pay {hours * args.hourly_rate:.2f}"
            writer.writerow(row)
            print(line)
    print(f"Saved to {out}")


if __name__ == "__main__":
    main()
