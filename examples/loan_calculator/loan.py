"""Works out the monthly payment on a loan and lists every payment until it is paid off."""
import argparse
import csv
import os


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--amount", type=float, required=True, help="how much is borrowed")
    parser.add_argument("--rate", type=float, required=True, help="yearly interest in percent")
    parser.add_argument("--years", type=float, required=True, help="how long the loan lasts")
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()

    months = max(1, round(args.years * 12))
    monthly_rate = args.rate / 100 / 12
    if monthly_rate:
        payment = args.amount * monthly_rate / (1 - (1 + monthly_rate) ** -months)
    else:
        payment = args.amount / months

    os.makedirs(args.output_dir, exist_ok=True)
    out = os.path.join(args.output_dir, "loan_schedule.csv")
    balance, total_interest = args.amount, 0.0
    with open(out, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["month", "payment", "interest", "paid_off", "still_owed"])
        for month in range(1, months + 1):
            interest = balance * monthly_rate
            paid_off = payment - interest
            balance = max(0.0, balance - paid_off)
            total_interest += interest
            writer.writerow([month, f"{payment:.2f}", f"{interest:.2f}", f"{paid_off:.2f}", f"{balance:.2f}"])

    print(f"Monthly payment: {payment:.2f} for {months} months")
    print(f"Total interest:  {total_interest:.2f}")
    print(f"Total paid:      {args.amount + total_interest:.2f}")
    print(f"Saved the full schedule to {out}")


if __name__ == "__main__":
    main()
