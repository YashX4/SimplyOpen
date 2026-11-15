"""Makes neatly numbered copies of every file in a folder (holiday_001.jpg, holiday_002.jpg, ...)."""
import argparse
import os
import shutil


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("folder", help="the folder with the files to rename")
    parser.add_argument("--prefix", default="file", help="the name every copy starts with")
    parser.add_argument("--start", type=int, default=1, help="the first number")
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()

    names = sorted(n for n in os.listdir(args.folder)
                   if os.path.isfile(os.path.join(args.folder, n)) and not n.startswith("."))
    os.makedirs(args.output_dir, exist_ok=True)
    for number, name in enumerate(names, args.start):
        new_name = f"{args.prefix}_{number:03d}{os.path.splitext(name)[1].lower()}"
        shutil.copy2(os.path.join(args.folder, name), os.path.join(args.output_dir, new_name))
        print(f"{name} -> {new_name}")
    print(f"Copied {len(names)} files to {args.output_dir}. The originals were not changed.")


if __name__ == "__main__":
    main()
