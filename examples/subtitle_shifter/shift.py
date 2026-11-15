"""Moves every subtitle earlier or later, for when the words do not match the video."""
import argparse
import os
import re

STAMP = re.compile(r"(\d+):(\d\d):(\d\d)[,.](\d\d\d)")


def shifted(match, seconds):
    h, m, s, ms = (int(g) for g in match.groups())
    total = max(0, round((h * 3600 + m * 60 + s) * 1000 + ms + seconds * 1000))
    h, rest = divmod(total, 3600000)
    m, rest = divmod(rest, 60000)
    s, ms = divmod(rest, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file", help="the .srt subtitle file")
    parser.add_argument("--seconds", type=float, required=True,
                        help="how far to move them; a minus number makes them earlier")
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()

    with open(args.file, encoding="utf-8-sig") as f:
        lines = f.read().splitlines()
    count = 0
    for i, line in enumerate(lines):
        if "-->" in line:
            lines[i] = STAMP.sub(lambda m: shifted(m, args.seconds), line)
            count += 1

    os.makedirs(args.output_dir, exist_ok=True)
    base = os.path.splitext(os.path.basename(args.file))[0]
    out = os.path.join(args.output_dir, base + "_shifted.srt")
    with open(out, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    direction = "later" if args.seconds >= 0 else "earlier"
    print(f"Moved {count} subtitles {abs(args.seconds):g} seconds {direction}.")
    print(f"Saved to {out}")


if __name__ == "__main__":
    main()
