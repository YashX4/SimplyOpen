"""Scores how easy a piece of writing is to read, and points out the longest sentences."""
import argparse
import os
import re


def syllables(word):
    """A rough count: groups of vowels, minus a silent final 'e'."""
    word = word.lower()
    count = len(re.findall(r"[aeiouy]+", word))
    if word.endswith("e") and not word.endswith(("le", "ee")) and count > 1:
        count -= 1
    return max(1, count)


def verdict(score):
    for least, text in ((90, "very easy (age 11)"), (70, "easy (age 12-13)"), (60, "plain English (age 13-15)"),
                        (50, "fairly hard (older teenagers)"), (30, "hard (university level)")):
        if score >= least:
            return text
    return "very hard (specialist readers)"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file", help="the text file to check")
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()

    with open(args.file, encoding="utf-8") as f:
        text = " ".join(f.read().split())
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", text) if re.search(r"[A-Za-z]", s)]
    words = re.findall(r"[A-Za-z']+", text)
    if not sentences or not words:
        raise SystemExit("There is no writing in that file to check.")

    per_sentence = len(words) / len(sentences)
    per_word = sum(syllables(w) for w in words) / len(words)
    score = 206.835 - 1.015 * per_sentence - 84.6 * per_word       # Flesch reading ease
    longest = sorted(sentences, key=lambda s: -len(s.split()))[:3]

    report = [f"Reading ease: {score:.0f} out of 100 - {verdict(score)}",
              f"{len(words)} words in {len(sentences)} sentences ({per_sentence:.1f} words per sentence).",
              "", "Longest sentences (try splitting these):"]
    report += [f"  [{len(s.split())} words] {s}" for s in longest]

    os.makedirs(args.output_dir, exist_ok=True)
    out = os.path.join(args.output_dir, "readability_report.txt")
    with open(out, "w", encoding="utf-8") as f:
        f.write("\n".join(report) + "\n")
    print("\n".join(report[:2]))
    print(f"Saved to {out}")


if __name__ == "__main__":
    main()
