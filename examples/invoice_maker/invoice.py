"""Turns a list of items into a printable invoice."""
import argparse
import csv
import datetime
import html
import os

PAGE = """<!doctype html><meta charset="utf-8"><title>Invoice {number}</title>
<style>
body {{ font-family: sans-serif; max-width: 40em; margin: 2em auto; }}
table {{ border-collapse: collapse; width: 100%; }}
th, td {{ border-bottom: 1px solid #ccc; padding: .4em; text-align: left; }}
td.n, th.n {{ text-align: right; }}
tr.total td {{ font-weight: bold; border-top: 2px solid #333; }}
</style>
<h1>Invoice {number}</h1>
<p>From: {seller}<br>To: {customer}<br>Date: {date}</p>
<table><tr><th>Item</th><th class="n">Quantity</th><th class="n">Price</th><th class="n">Amount</th></tr>
{rows}
<tr><td colspan="3">Subtotal</td><td class="n">{subtotal:.2f}</td></tr>
<tr><td colspan="3">Tax ({tax:g}%)</td><td class="n">{tax_amount:.2f}</td></tr>
<tr class="total"><td colspan="3">Total due</td><td class="n">{total:.2f}</td></tr>
</table>"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file", help="a .csv file with the columns item, quantity, price")
    parser.add_argument("--customer", required=True, help="who the invoice is for")
    parser.add_argument("--seller", default="My Business", help="who the invoice is from")
    parser.add_argument("--number", default="001", help="the invoice number")
    parser.add_argument("--tax", type=float, default=0, help="tax in percent")
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()

    rows, subtotal = [], 0.0
    with open(args.file, newline="", encoding="utf-8-sig") as f:
        for line in csv.DictReader(f):
            quantity, price = float(line["quantity"]), float(line["price"])
            amount = quantity * price
            subtotal += amount
            rows.append(f'<tr><td>{html.escape(line["item"])}</td><td class="n">{quantity:g}</td>'
                        f'<td class="n">{price:.2f}</td><td class="n">{amount:.2f}</td></tr>')
    tax_amount = subtotal * args.tax / 100

    os.makedirs(args.output_dir, exist_ok=True)
    safe = "".join(c for c in args.number if c.isalnum() or c in "-_") or "invoice"
    out = os.path.join(args.output_dir, f"invoice_{safe}.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(PAGE.format(number=html.escape(args.number), seller=html.escape(args.seller),
                            customer=html.escape(args.customer), date=datetime.date.today().isoformat(),
                            rows="\n".join(rows), subtotal=subtotal, tax=args.tax,
                            tax_amount=tax_amount, total=subtotal + tax_amount))
    print(f"{len(rows)} items. Total due: {subtotal + tax_amount:.2f}")
    print(f"Saved to {out}")


if __name__ == "__main__":
    main()
