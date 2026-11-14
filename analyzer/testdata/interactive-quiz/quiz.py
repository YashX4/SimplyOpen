"""A tiny times-table quiz that asks questions in the terminal."""
import random


def main() -> None:
    name = input("What's your name? ")
    rounds = int(input("How many questions would you like? "))
    level = input("Pick a level (easy/hard): ").strip().lower()
    top = 5 if level == "easy" else 12
    score = 0
    for _ in range(rounds):
        a, b = random.randint(1, top), random.randint(1, top)
        if input(f"{a} x {b} = ").strip() == str(a * b):
            score += 1
    print(f"Well done {name}, you got {score} out of {rounds}!")


if __name__ == "__main__":
    main()
