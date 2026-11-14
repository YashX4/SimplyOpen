import sys
from pathlib import Path


def main():
    folder = Path(sys.argv[1])
    for photo in folder.glob("*.jpg"):
        print(f"would resize {photo.name}")


if __name__ == "__main__":
    main()
