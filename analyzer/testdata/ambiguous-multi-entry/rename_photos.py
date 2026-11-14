import sys
from pathlib import Path


def main():
    folder = Path(sys.argv[1])
    for i, photo in enumerate(sorted(folder.glob("*.jpg")), start=1):
        print(f"would rename {photo.name} to photo_{i:03}.jpg")


if __name__ == "__main__":
    main()
