"""Counts how often each word appears in a piece of writing."""
import argparse
import collections
import csv
import os
import re

COMMON = set("a an and are as at be but by for from has have he her his i in is it its "
             "not of on or she that the their they this to was we were with you".split())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file", help="the text file to read")
    parser.add_argument("--top", type=int, default=20, help="how many words to list")
    parser.add_argument("--ignore-common", action="store_true", help="skip words like 'the' and 'and'")
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()

    with open(args.file, encoding="utf-8") as f:
        words = re.findall(r"[a-zA-Z']+", f.read().lower())
    counted = [w.strip("'") for w in words]
    counted = [w for w in counted if w and not (args.ignore_common and w in COMMON)]
    top = collections.Counter(counted).most_common(args.top)

    os.makedirs(args.output_dir, exist_ok=True)
    out = os.path.join(args.output_dir, "word_counts.csv")
    with open(out, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["word", "times"])
        writer.writerows(top)

    print(f"{len(words)} words in total, {len(set(counted))} different ones counted.")
    for word, times in top[:5]:
        print(f"  {word}: {times}")
    print(f"Saved the top {len(top)} to {out}")


if __name__ == "__main__":
    main()
