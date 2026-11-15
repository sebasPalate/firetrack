"""Write the static data the web client reads when there is no API.

    python -m pipeline.export_web              # every region with artifacts
    python -m pipeline.export_web spain        # one region

Output, under ``apps/web/public/data/`` (served as ``/data/...`` by Next.js or any
static host, e.g. Vercel):

    regions.json                      regions that have artifacts
    calendar/{region}.json            same payload as GET /calendar?region=
    method/{region}.json              same payload as GET /method?region=
    detections/{region}/{year}.csv    same rows as GET /detections, one file per year

The payloads come from ``pipeline.payloads``, the code the API uses, so the static
site and the API can never disagree.
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

from pipeline.firms import DATA, sql_literal
from pipeline.harmonize import DETECTION_ORDER
from pipeline.payloads import calendar_payload, detections_csv, public_region
from pipeline.regions import REPO_ROOT, load_regions

WEB_DATA = REPO_ROOT / "apps" / "web" / "public" / "data"


def connect():
    import duckdb

    return duckdb.connect()


def read_rows(con, path: Path, suffix: str = "") -> tuple[list[str], list[tuple]]:
    cursor = con.execute(f"SELECT * FROM read_parquet({sql_literal(path.as_posix())}) {suffix}")
    return [column[0] for column in cursor.description], cursor.fetchall()


def export_region(con, region: dict, data_dir: Path, out: Path) -> dict:
    processed = data_dir / "processed"
    calendar_path = processed / "calendar" / f"{region['id']}.parquet"
    hotspots_path = processed / "hotspots" / f"{region['id']}.parquet"
    method_path = processed / "method" / f"{region['id']}.json"

    columns, rows = read_rows(con, calendar_path)
    payload = calendar_payload(region, [dict(zip(columns, row)) for row in rows])
    _write_json(out / "calendar" / f"{region['id']}.json", payload)
    shutil.copyfile(method_path, _ensure(out / "method" / f"{region['id']}.json"))

    detections = out / "detections" / region["id"]
    if detections.exists():
        shutil.rmtree(detections)
    years = [y for (y,) in con.execute(
        f"SELECT DISTINCT year(acq_date) FROM read_parquet({sql_literal(hotspots_path.as_posix())}) ORDER BY 1"
    ).fetchall()]
    sizes = {}
    for year in years:
        columns, rows = read_rows(
            con, hotspots_path, f"WHERE year(acq_date) = {int(year)} ORDER BY {DETECTION_ORDER}"
        )
        target = _ensure(detections / f"{year}.csv")
        target.write_text(detections_csv(columns, rows), encoding="utf-8")
        sizes[year] = len(rows)
    return {"detections": sizes}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Write apps/web/public/data from the processed artifacts")
    parser.add_argument("regions", nargs="*", help="region ids (default: every region with artifacts)")
    parser.add_argument("--out", type=Path, default=WEB_DATA)
    args = parser.parse_args(argv)

    data_dir = Path(DATA)
    configured = load_regions()
    ready = [
        rid for rid in configured
        if (data_dir / "processed" / "calendar" / f"{rid}.parquet").exists()
        and (data_dir / "processed" / "method" / f"{rid}.json").exists()
    ]
    wanted = args.regions or ready
    missing = [rid for rid in wanted if rid not in ready]
    if missing:
        print(f"no artifacts for {missing}: run  python -m pipeline.harmonize <region>  first")
        return 2

    con = connect()
    try:
        for rid in wanted:
            report = export_region(con, configured[rid], data_dir, args.out)
            total = sum(report["detections"].values())
            print(f"{rid:>8}: calendar, method, {len(report['detections'])} yearly CSV files, {total:,} detections")
    finally:
        con.close()

    # The region list only names what was actually exported, so the client never
    # offers an area whose files are missing.
    exported = sorted(
        {p.stem for p in (args.out / "calendar").glob("*.json")} & set(configured),
        key=list(configured).index,
    )
    _write_json(args.out / "regions.json", [public_region(configured[rid]) for rid in exported])
    print(f"wrote {args.out}  (regions: {', '.join(exported)})")
    return 0


def _ensure(path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def _write_json(path: Path, payload) -> None:
    _ensure(path).write_text(json.dumps(payload, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())
