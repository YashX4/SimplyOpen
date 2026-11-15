"""Builds a matching set of lighter and darker shades from one colour."""
import argparse
import colorsys
import os
import re


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--color", required=True, help="the starting colour as a code like #3366cc")
    parser.add_argument("--steps", type=int, default=7, help="how many shades")
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()

    code = args.color.strip().lstrip("#")
    if len(code) == 3:
        code = "".join(c * 2 for c in code)
    if not re.fullmatch(r"[0-9a-fA-F]{6}", code):
        raise SystemExit("Write the colour as six letters and digits, like #3366cc.")
    steps = max(2, args.steps)
    r, g, b = (int(code[i:i + 2], 16) / 255 for i in (0, 2, 4))
    hue, _light, saturation = colorsys.rgb_to_hls(r, g, b)

    shades = []
    for i in range(steps):
        lightness = 0.92 - i * (0.92 - 0.12) / (steps - 1)     # from light to dark
        rgb = colorsys.hls_to_rgb(hue, lightness, saturation)
        shades.append(("#" + "".join(f"{round(c * 255):02x}" for c in rgb), lightness))

    blocks = "".join(
        f'<div style="background:{shade};color:{"#000" if light > 0.55 else "#fff"};'
        f'padding:1.5em;font-family:monospace">{shade}</div>' for shade, light in shades)
    os.makedirs(args.output_dir, exist_ok=True)
    out = os.path.join(args.output_dir, "palette.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(f'<!doctype html><meta charset="utf-8"><title>Palette for #{code}</title>'
                f'<body style="max-width:24em;margin:2em auto"><h1 style="font-family:sans-serif">'
                f"Shades of #{code.lower()}</h1>{blocks}</body>")
    print("  ".join(shade for shade, _ in shades))
    print(f"Saved to {out}")


if __name__ == "__main__":
    main()
