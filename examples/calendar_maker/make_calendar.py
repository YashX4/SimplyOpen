"""Makes a printable one-page calendar for any month."""
import argparse
import calendar
import os

PAGE = """<!doctype html><meta charset="utf-8"><title>{title}</title>
<style>
body {{ font-family: sans-serif; margin: 2em; }}
table {{ border-collapse: collapse; width: 100%; table-layout: fixed; }}
th {{ padding: .4em; background: #333; color: white; }}
td {{ border: 1px solid #999; height: 6em; vertical-align: top; padding: .3em; font-weight: bold; }}
td.empty {{ background: #f3f3f3; }}
</style>
<h1>{title}</h1>
<table><tr>{head}</tr>
{weeks}
</table>"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--year", type=int, required=True)
    parser.add_argument("--month", type=int, required=True, help="1 for January ... 12 for December")
    parser.add_argument("--week-starts", choices=["Monday", "Sunday"], default="Monday")
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()
    if not 1 <= args.month <= 12:
        raise SystemExit("The month must be a number from 1 to 12.")

    first = calendar.SUNDAY if args.week_starts == "Sunday" else calendar.MONDAY
    cal = calendar.Calendar(firstweekday=first)
    head = "".join(f"<th>{calendar.day_abbr[d]}</th>" for d in cal.iterweekdays())
    weeks = []
    for week in cal.monthdayscalendar(args.year, args.month):
        cells = "".join(f"<td>{day}</td>" if day else '<td class="empty"></td>' for day in week)
        weeks.append(f"<tr>{cells}</tr>")
    title = f"{calendar.month_name[args.month]} {args.year}"

    os.makedirs(args.output_dir, exist_ok=True)
    out = os.path.join(args.output_dir, f"calendar_{args.year}_{args.month:02d}.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(PAGE.format(title=title, head=head, weeks="\n".join(weeks)))
    print(f"Made the calendar for {title}.")
    print(f"Saved to {out}")


if __name__ == "__main__":
    main()
