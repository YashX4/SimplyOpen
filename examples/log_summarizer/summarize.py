"""Reads a long program log and says how many errors and warnings it has, and which come up most."""
import argparse
import collections
import os
import re

LEVELS = ["ERROR", "WARNING", "INFO", "DEBUG"]
LINE = re.compile(r"\b(ERROR|WARN(?:ING)?|INFO|DEBUG)\b[:\]\s-]*(.*)", re.IGNORECASE)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file", help="the log file")
    parser.add_argument("--top", type=int, default=5, help="how many repeated messages to list")
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()

    levels = collections.Counter()
    messages = {"ERROR": collections.Counter(), "WARNING": collections.Counter()}
    total = 0
    with open(args.file, encoding="utf-8", errors="replace") as f:
        for line in f:
            total += 1
            match = LINE.search(line)
            if not match:
                continue
            level = match.group(1).upper()
            level = "WARNING" if level.startswith("WARN") else level
            levels[level] += 1
            if level in messages:
                # Numbers are blanked so "took 31ms" and "took 87ms" count as one message.
                messages[level][re.sub(r"\d+", "#", match.group(2).strip())] += 1

    report = [f"{total} lines read.", ""]
    report += [f"{level}: {levels[level]}" for level in LEVELS]
    for level in ("ERROR", "WARNING"):
        if messages[level]:
            report += ["", f"Most common {level.lower()} messages:"]
            report += [f"  {times}x  {text}" for text, times in messages[level].most_common(args.top)]

    os.makedirs(args.output_dir, exist_ok=True)
    out = os.path.join(args.output_dir, "log_summary.txt")
    with open(out, "w", encoding="utf-8") as f:
        f.write("\n".join(report) + "\n")
    print("\n".join(report))
    print(f"\nSaved to {out}")


if __name__ == "__main__":
    main()
