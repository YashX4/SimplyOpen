#!/usr/bin/env python3
"""Convert Zoom transcripts (.vtt) into plain-text files that NVivo can import.

Each caption block becomes one line of the form "Speaker: text", which NVivo
recognises as a speaker-tagged transcript.
"""
import argparse
import re
from pathlib import Path

TIMESTAMP = re.compile(r"^\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}")


def convert(vtt_text: str, keep_timestamps: bool) -> str:
    lines, stamp = [], None
    for raw in vtt_text.splitlines():
        line = raw.strip()
        if not line or line == "WEBVTT" or line.isdigit():
            continue
        if TIMESTAMP.match(line):
            stamp = line.split(" --> ")[0]
            continue
        speaker, _, text = line.partition(": ")
        entry = f"{speaker}: {text}" if text else f"Unknown: {speaker}"
        lines.append(f"[{stamp}] {entry}" if keep_timestamps and stamp else entry)
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description="Convert Zoom .vtt transcripts for NVivo.")
    parser.add_argument("transcripts", nargs="+", help="Zoom transcript files (.vtt)")
    parser.add_argument("--output-dir", default="nvivo_ready", help="Folder for the converted files")
    parser.add_argument("--keep-timestamps", action="store_true", help="Keep caption timestamps")
    args = parser.parse_args()

    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    for name in args.transcripts:
        source = Path(name)
        text = convert(source.read_text(encoding="utf-8"), args.keep_timestamps)
        (out_dir / f"{source.stem}.txt").write_text(text, encoding="utf-8")
        print(f"Converted {source.name}")


if __name__ == "__main__":
    main()
