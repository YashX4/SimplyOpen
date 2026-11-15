"""Draws a random maze you can print and solve with a pencil."""
import argparse
import os
import random

CELL = 24


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--width", type=int, default=20, help="squares across")
    parser.add_argument("--height", type=int, default=14, help="squares down")
    parser.add_argument("--seed", type=int, default=None, help="same number gives the same maze")
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()
    w, h = max(2, args.width), max(2, args.height)

    # Carve passages with a depth-first walk; `open_walls` holds the removed walls.
    rng = random.Random(args.seed)
    seen, open_walls, stack = {(0, 0)}, set(), [(0, 0)]
    while stack:
        x, y = stack[-1]
        nexts = [(x + dx, y + dy) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))
                 if 0 <= x + dx < w and 0 <= y + dy < h and (x + dx, y + dy) not in seen]
        if not nexts:
            stack.pop()
            continue
        nxt = rng.choice(nexts)
        open_walls.add(frozenset(((x, y), nxt)))
        seen.add(nxt)
        stack.append(nxt)

    lines = []

    def wall(x1, y1, x2, y2):
        lines.append(f'<line x1="{x1 * CELL}" y1="{y1 * CELL}" x2="{x2 * CELL}" y2="{y2 * CELL}"/>')

    for x in range(w):
        if x != 0:
            wall(x, 0, x + 1, 0)          # top edge, with the entrance at the top left
        if x != w - 1:
            wall(x, h, x + 1, h)          # bottom edge, with the exit at the bottom right
    for y in range(h):
        wall(0, y, 0, y + 1)
        wall(w, y, w, y + 1)
    for x in range(w):
        for y in range(h):
            if x + 1 < w and frozenset(((x, y), (x + 1, y))) not in open_walls:
                wall(x + 1, y, x + 1, y + 1)
            if y + 1 < h and frozenset(((x, y), (x, y + 1))) not in open_walls:
                wall(x, y + 1, x + 1, y + 1)

    os.makedirs(args.output_dir, exist_ok=True)
    out = os.path.join(args.output_dir, "maze.svg")
    with open(out, "w", encoding="utf-8") as f:
        f.write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="-4 -4 {w * CELL + 8} {h * CELL + 8}" '
                f'width="{w * CELL + 8}" height="{h * CELL + 8}">'
                f'<rect x="-4" y="-4" width="100%" height="100%" fill="white"/>'
                f'<g stroke="black" stroke-width="2" stroke-linecap="square">{"".join(lines)}</g></svg>')
    print(f"Drew a {w} by {h} maze. Start at the top left, finish at the bottom right.")
    print(f"Saved to {out}")


if __name__ == "__main__":
    main()
