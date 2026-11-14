"""Resize an image to a given width, keeping its proportions.

Usage:
    python resize.py photo.jpg --width 800 --format png --output-dir results
"""

import argparse
from pathlib import Path
from PIL import Image


def main():
    parser = argparse.ArgumentParser(description="Resize an image.")
    parser.add_argument("image", help="path to the image to resize")
    parser.add_argument("--width", type=int, default=800, help="new width in pixels")
    parser.add_argument("--format", choices=["png", "jpeg", "webp"], default="png")
    parser.add_argument("--output-dir", default=".", help="folder to save the result in")
    args = parser.parse_args()

    source = Path(args.image)
    output = Path(args.output_dir) / f"{source.stem}_resized.{args.format}"

    print(f"Opening {source.name}...")
    image = Image.open(source)
    height = round(image.height * args.width / image.width)
    print(f"Resizing from {image.width}x{image.height} to {args.width}x{height}...")
    resized = image.resize((args.width, height))
    if args.format == "jpeg":
        resized = resized.convert("RGB")  # JPEG has no transparency
    resized.save(output, format=args.format)

    print(f"Saved {output.name}")


if __name__ == "__main__":
    main()
