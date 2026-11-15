"""Splits a list of names into random groups of the size you choose."""
import argparse
import os
import random


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file", help="a text file with one name per line")
    parser.add_argument("--group-size", type=int, default=3, help="people per group")
    parser.add_argument("--seed", type=int, default=None, help="same number gives the same groups")
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()
    if args.group_size < 1:
        raise SystemExit("Groups need at least 1 person.")

    with open(args.file, encoding="utf-8") as f:
        names = [line.strip() for line in f if line.strip()]
    random.Random(args.seed).shuffle(names)

    # Deal names out like cards so group sizes never differ by more than one.
    count = max(1, round(len(names) / args.group_size))
    groups = [names[i::count] for i in range(count)]

    lines = []
    for number, members in enumerate(groups, 1):
        lines.append(f"Group {number}: " + ", ".join(members))

    os.makedirs(args.output_dir, exist_ok=True)
    out = os.path.join(args.output_dir, "groups.txt")
    with open(out, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print("\n".join(lines))
    print(f"Saved to {out}")


if __name__ == "__main__":
    main()
