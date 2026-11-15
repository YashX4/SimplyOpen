"""Makes a list of strong random passwords."""
import argparse
import os
import secrets
import string


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--count", type=int, default=5, help="how many passwords")
    parser.add_argument("--length", type=int, default=16, help="letters per password")
    parser.add_argument("--no-symbols", action="store_true", help="letters and digits only")
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()

    if args.length < 4:
        raise SystemExit("A password needs at least 4 characters.")
    groups = [string.ascii_lowercase, string.ascii_uppercase, string.digits]
    if not args.no_symbols:
        groups.append("!@#$%^&*-_=+?")
    alphabet = "".join(groups)

    passwords = []
    for _ in range(args.count):
        # One character from each group, so every password has the full mix.
        chars = [secrets.choice(g) for g in groups]
        chars += [secrets.choice(alphabet) for _ in range(args.length - len(chars))]
        secrets.SystemRandom().shuffle(chars)
        passwords.append("".join(chars))

    os.makedirs(args.output_dir, exist_ok=True)
    out = os.path.join(args.output_dir, "passwords.txt")
    with open(out, "w", encoding="utf-8") as f:
        f.write("\n".join(passwords) + "\n")
    # The passwords themselves are only written to the file, never printed.
    print(f"Made {len(passwords)} passwords of {args.length} characters.")
    print(f"Saved to {out}")


if __name__ == "__main__":
    main()
