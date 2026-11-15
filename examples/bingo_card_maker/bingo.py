"""Makes printable bingo cards from your own list of words."""
import argparse
import html
import os
import random

PAGE = """<!doctype html><meta charset="utf-8"><title>{title}</title>
<style>
body {{ font-family: sans-serif; }}
.card {{ page-break-after: always; margin: 2em auto; width: 36em; }}
table {{ border-collapse: collapse; width: 100%; }}
td {{ border: 2px solid #333; height: 6em; text-align: center; padding: .3em; }}
</style>
{cards}"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("words", help="a text file with one word or phrase per line")
    parser.add_argument("--cards", type=int, default=4, help="how many cards to make")
    parser.add_argument("--size", type=int, default=4, choices=[3, 4, 5], help="squares per side")
    parser.add_argument("--title", default="Bingo")
    parser.add_argument("--seed", type=int, default=None, help="same number gives the same cards")
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()

    with open(args.words, encoding="utf-8") as f:
        words = [line.strip() for line in f if line.strip()]
    needed = args.size * args.size
    if len(words) < needed:
        raise SystemExit(f"A {args.size}x{args.size} card needs {needed} words; the list has {len(words)}.")

    rng = random.Random(args.seed)
    cards = []
    for number in range(1, args.cards + 1):
        picked = rng.sample(words, needed)
        rows = ""
        for r in range(args.size):
            cells = "".join(f"<td>{html.escape(w)}</td>" for w in picked[r * args.size:(r + 1) * args.size])
            rows += f"<tr>{cells}</tr>"
        cards.append(f'<div class="card"><h2>{html.escape(args.title)} - card {number}</h2><table>{rows}</table></div>')

    os.makedirs(args.output_dir, exist_ok=True)
    out = os.path.join(args.output_dir, "bingo_cards.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(PAGE.format(title=html.escape(args.title), cards="\n".join(cards)))
    print(f"Made {args.cards} cards from {len(words)} words.")
    print(f"Saved to {out}")


if __name__ == "__main__":
    main()
