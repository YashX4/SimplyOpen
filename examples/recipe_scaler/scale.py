"""Makes a recipe bigger or smaller by multiplying the amount at the start of each line."""
import argparse
import fractions
import os
import re

# An amount at the start of a line: "2", "1.5", "1/2" or "1 1/2".
AMOUNT = re.compile(r"^(\s*[-*]?\s*)(\d+\s+\d+/\d+|\d+/\d+|\d+(?:\.\d+)?)(?=\s)")


def pretty(value):
    """Writes 1.5 as '1 1/2' and 0.3333 as '1/3'; awkward amounts become decimals."""
    exact = fractions.Fraction(value).limit_denominator(8)
    if abs(float(exact) - float(value)) > 0.01:
        return f"{float(value):.2f}".rstrip("0").rstrip(".")
    whole, rest = divmod(exact, 1)
    if not rest:
        return str(whole)
    return f"{whole} {rest}" if whole else str(rest)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file", help="the recipe, one ingredient per line starting with its amount")
    parser.add_argument("--times", type=float, required=True, help="2 doubles it, 0.5 halves it")
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()
    factor = fractions.Fraction(args.times).limit_denominator(100)

    changed, lines = 0, []
    with open(args.file, encoding="utf-8") as f:
        for line in f.read().splitlines():
            match = AMOUNT.match(line)
            if match:
                amount = sum(fractions.Fraction(part) for part in match.group(2).split())
                line = match.group(1) + pretty(amount * factor) + line[match.end():]
                changed += 1
            lines.append(line)

    os.makedirs(args.output_dir, exist_ok=True)
    base, ext = os.path.splitext(os.path.basename(args.file))
    out = os.path.join(args.output_dir, f"{base}_scaled{ext or '.txt'}")
    with open(out, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(f"Changed {changed} amounts (times {args.times:g}).")
    print(f"Saved to {out}")


if __name__ == "__main__":
    main()
