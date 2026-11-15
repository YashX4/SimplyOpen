"""Turns simple formatted notes (Markdown) into a web page you can open or print."""
import argparse
import html
import os
import re

STYLE = "body{font-family:Georgia,serif;max-width:40em;margin:2em auto;line-height:1.5}code{background:#eee;padding:0 .2em}"


def inline(text):
    text = html.escape(text)
    text = re.sub(r"`([^`]+)`", r"<code>\1</code>", text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(r"\*([^*]+)\*", r"<em>\1</em>", text)
    return re.sub(r"\[([^\]]+)\]\(([^)\s]+)\)", r'<a href="\2">\1</a>', text)


def convert(text):
    out, paragraph, in_list = [], [], False

    def flush():
        nonlocal in_list
        if paragraph:
            out.append("<p>" + " ".join(paragraph) + "</p>")
            paragraph.clear()
        if in_list:
            out.append("</ul>")
            in_list = False

    for line in text.splitlines():
        heading = re.match(r"(#{1,6})\s+(.*)", line)
        item = re.match(r"\s*[-*]\s+(.*)", line)
        if heading:
            flush()
            level = len(heading.group(1))
            out.append(f"<h{level}>{inline(heading.group(2))}</h{level}>")
        elif item:
            if paragraph or not in_list:
                flush()
                out.append("<ul>")
                in_list = True
            out.append(f"<li>{inline(item.group(1))}</li>")
        elif not line.strip():
            flush()
        else:
            if in_list:
                flush()
            paragraph.append(inline(line.strip()))
    flush()
    return "\n".join(out)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file", help="the .md or .txt file to convert")
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()

    with open(args.file, encoding="utf-8") as f:
        body = convert(f.read())
    base = os.path.splitext(os.path.basename(args.file))[0]
    os.makedirs(args.output_dir, exist_ok=True)
    out = os.path.join(args.output_dir, base + ".html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(f'<!doctype html><meta charset="utf-8"><title>{html.escape(base)}</title>'
                f"<style>{STYLE}</style>\n{body}\n")
    print(f"Saved to {out}")


if __name__ == "__main__":
    main()
