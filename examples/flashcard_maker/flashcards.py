"""Turns a list of questions and answers into study cards you can click to flip, or print."""
import argparse
import csv
import html
import os

PAGE = """<!doctype html><meta charset="utf-8"><title>{title}</title>
<style>
body {{ font-family: sans-serif; margin: 2em; }}
.cards {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(14em, 1fr)); gap: 1em; }}
.card {{ border: 2px solid #333; border-radius: .6em; min-height: 8em; padding: 1em; cursor: pointer;
         display: flex; align-items: center; justify-content: center; text-align: center; }}
.card .a {{ display: none; color: #0a5; }}
.card.flipped .q {{ display: none; }}
.card.flipped .a {{ display: block; }}
@media print {{ .card .a {{ display: block; margin-left: 1em; }} }}
</style>
<h1>{title}</h1><p>Click a card to see its answer.</p>
<div class="cards">
{cards}
</div>
<script>document.querySelectorAll('.card').forEach(c => c.onclick = () => c.classList.toggle('flipped'))</script>"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file", help="a .csv file: question in the first column, answer in the second")
    parser.add_argument("--title", default="Flashcards")
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()

    with open(args.file, newline="", encoding="utf-8-sig") as f:
        rows = [r for r in csv.reader(f) if len(r) >= 2 and r[0].strip()]
    if rows and rows[0][0].strip().lower() in ("question", "front", "term"):
        rows = rows[1:]
    cards = "\n".join(f'<div class="card"><span class="q">{html.escape(q.strip())}</span>'
                      f'<span class="a">{html.escape(a.strip())}</span></div>' for q, a, *_ in rows)

    os.makedirs(args.output_dir, exist_ok=True)
    out = os.path.join(args.output_dir, "flashcards.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(PAGE.format(title=html.escape(args.title), cards=cards))
    print(f"Made {len(rows)} cards.")
    print(f"Saved to {out}")


if __name__ == "__main__":
    main()
