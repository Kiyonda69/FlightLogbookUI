#!/usr/bin/env python
"""Export the legacy Apple Numbers logbook (FLIGHT LOGBOOK.numbers) to CSV.

Output:
  data/flights.csv        one row per flight leg, minutes as integers
  data/carry_forward.json cumulative totals recorded *before* the first month
                          in the Numbers file (the "前項までの合計" of 2017/1月)

Usage:
  pip install numbers-parser
  python tools/export_numbers.py "../FLIGHT LOGBOOK 2.numbers"              -> data/flights.csv, data/carry_forward.json
  python tools/export_numbers.py "../FLIGHT LOGBOOK.numbers" --tag test     -> data/flights_test.csv, data/carry_forward_test.json
                                                                              (fixture used by tools/test_logic.js)
"""
import csv, json, re, sys, datetime, warnings
from pathlib import Path
from numbers_parser import Document

warnings.filterwarnings("ignore")

# Column order of the Numbers table (0-based) -> Flights sheet field name.
# Header row 1 / row 2 of the Numbers table (JCAB 飛行日誌 layout):
NUMBERS_COLS = [
    "date", "aircraft_type", "registration", "dep", "arr", "dep_time", "arr_time",
    "flight_no", "takeoffs", "landings", "block",
    "pic", "solo_sic", "pus", "pic_xc", "pic_night",
    "sic", "dual", "sic_xc", "sic_night",
    "hood", "ifr", "sim", "ftd", "instructor", "flight_engineer", "other", "remarks",
]
DURATION_FIELDS = [
    "block", "pic", "solo_sic", "pus", "pic_xc", "pic_night", "sic", "dual",
    "sic_xc", "sic_night", "hood", "ifr", "sim", "ftd", "instructor",
    "flight_engineer", "other",
]
FIELDS = NUMBERS_COLS + ["source"]

TOTAL_LABELS = {"項 小 計", "前項までの合計", "合  計"}


def to_minutes(v):
    if v is None:
        return 0
    if isinstance(v, datetime.timedelta):
        return int(round(v.total_seconds() / 60))
    if isinstance(v, (int, float)):
        return int(round(v * 24 * 60)) if v < 1 else int(v)  # fraction-of-day or minutes
    m = re.match(r"^(?:(\d+) days?, )?(\d+):(\d\d)(?::\d\d)?$", str(v))
    if m:
        d, h, mi = m.groups()
        return (int(d or 0) * 24 + int(h)) * 60 + int(mi)
    raise ValueError(f"cannot parse duration {v!r}")


def to_hhmm(v):
    if v is None:
        return ""
    if isinstance(v, datetime.datetime):
        return v.strftime("%H:%M")
    return str(v)


def to_int(v):
    if v is None or v == "":
        return 0
    return int(float(v))


def parse_day(v):
    """月日 cell: '12.3' (str, 12月3日) or 13.0 (float, day only)."""
    s = str(v)
    if "." in s:
        head, tail = s.split(".", 1)
        # str '12.3' -> month 12 day 3 ; float 13.0 -> day 13
        if isinstance(v, float):
            return int(float(s))
        return int(tail)
    return int(s)


def main(path, tag=""):
    doc = Document(path)
    flights, carries = [], {}
    for sheet in doc.sheets:
        m = re.match(r"^(\d{4})年$", sheet.name)
        if not m:
            continue
        year = int(m.group(1))
        for table in sheet.tables:
            mm = re.match(r"^(\d{1,2})月$", table.name)
            if not mm:
                continue
            month = int(mm.group(1))
            for row in table.rows():
                v = [c.value for c in row]
                label = v[7]
                if label == "前項までの合計":
                    # Remember the carry-forward row of every month; the one from the
                    # earliest month that actually has flights becomes carry_forward.json.
                    carries[(year, month)] = {
                        f: (to_int(v[i]) if f in ("takeoffs", "landings") else to_minutes(v[i]))
                        for i, f in enumerate(NUMBERS_COLS) if f in DURATION_FIELDS or f in ("takeoffs", "landings")}
                if v[0] in (None, "月日", "＿＿年") or label in TOTAL_LABELS or not v[1]:
                    continue
                day = parse_day(v[0])
                rec = {
                    "date": f"{year:04d}-{month:02d}-{day:02d}",
                    "aircraft_type": v[1], "registration": v[2], "dep": v[3], "arr": v[4],
                    "dep_time": to_hhmm(v[5]), "arr_time": to_hhmm(v[6]),
                    "flight_no": v[7] or "", "takeoffs": to_int(v[8]), "landings": to_int(v[9]),
                }
                for i, f in enumerate(NUMBERS_COLS):
                    if f in DURATION_FIELDS:
                        rec[f] = to_minutes(v[i])
                rem = v[27]
                if isinstance(rem, datetime.timedelta):
                    rm = to_minutes(rem)
                    rec["remarks"] = f"{rm // 60}:{rm % 60:02d}" if rm else ""
                else:
                    rec["remarks"] = "" if rem is None else str(rem)
                rec["source"] = f"numbers:{sheet.name}/{table.name}"
                flights.append(rec)
    flights.sort(key=lambda r: (r["date"], r["dep_time"]))
    first = flights[0]["date"]
    carry = carries[(int(first[:4]), int(first[5:7]))]
    out = Path("data"); out.mkdir(exist_ok=True)
    suffix = ("_" + tag) if tag else ""
    with open(out / f"flights{suffix}.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader(); w.writerows(flights)
    json.dump(carry, open(out / f"carry_forward{suffix}.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"flights{suffix}.csv: {len(flights)} legs  first={flights[0]['date']} last={flights[-1]['date']}")
    print("carry_forward:", carry)


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    tag = sys.argv[sys.argv.index("--tag") + 1] if "--tag" in sys.argv else ""
    main(args[0] if args else "../FLIGHT LOGBOOK.numbers", tag)
