"""Draws a bar chart picture from a two-column list of names and numbers."""
import argparse
import csv
import html
import os

COLORS = {"blue": "#2f6fde", "green": "#2a9d5c", "orange": "#e8833a", "purple": "#7b4fc9", "grey": "#666666"}
ROW, LEFT, WIDTH = 34, 170, 640


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file", help="a .csv file: name in the first column, number in the second")
    parser.add_argument("--title", default="")
    parser.add_argument("--color", choices=sorted(COLORS), default="blue")
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()

    bars = []
    with open(args.file, newline="", encoding="utf-8-sig") as f:
        for row in csv.reader(f):
            try:
                bars.append((row[0].strip(), float(row[1])))
            except (ValueError, IndexError):
                continue                    # the heading row, or a line without a number
    if not bars:
        raise SystemExit("No rows with a name and a number were found.")
    largest = max(value for _name, value in bars) or 1

    top = 50 if args.title else 14
    parts = []
    if args.title:
        parts.append(f'<text x="{WIDTH / 2}" y="30" text-anchor="middle" font-size="20" font-weight="bold">'
                     f"{html.escape(args.title)}</text>")
    for i, (name, value) in enumerate(bars):
        y = top + i * ROW
        length = max(0, value) / largest * (WIDTH - LEFT - 70)
        parts.append(f'<text x="{LEFT - 8}" y="{y + 17}" text-anchor="end">{html.escape(name)}</text>')
        parts.append(f'<rect x="{LEFT}" y="{y}" width="{length:.1f}" height="24" fill="{COLORS[args.color]}"/>')
        parts.append(f'<text x="{LEFT + length + 6:.1f}" y="{y + 17}">{value:g}</text>')
    height = top + len(bars) * ROW + 10

    os.makedirs(args.output_dir, exist_ok=True)
    out = os.path.join(args.output_dir, "chart.svg")
    with open(out, "w", encoding="utf-8") as f:
        f.write(f'<svg xmlns="http://www.w3.org/2000/svg" width="{WIDTH}" height="{height}" '
                f'font-family="sans-serif" font-size="14"><rect width="100%" height="100%" fill="white"/>'
                + "".join(parts) + "</svg>")
    print(f"Drew {len(bars)} bars.")
    print(f"Saved to {out}")


if __name__ == "__main__":
    main()
