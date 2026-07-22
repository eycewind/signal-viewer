#!/usr/bin/env python3
"""Export adjusted OHLCV from the PSX SQLite database for the signal viewer."""
from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, required=True, help="Path to psx_watcher.db")
    parser.add_argument("--symbol", default="OGDC")
    parser.add_argument("--output", type=Path, default=Path("public/data/OGDC.json"))
    args = parser.parse_args()

    symbol = args.symbol.upper()
    con = sqlite3.connect(f"file:{args.db.resolve()}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    try:
        rows = con.execute(
            """
            SELECT trade_date AS date,
                   COALESCE(open_adj, close_adj) AS open,
                   high_adj AS high, low_adj AS low, close_adj AS close,
                   COALESCE(volume_adj, CAST(volume AS REAL)) AS volume
            FROM daily_ohlc
            WHERE symbol = ?
              AND close_adj IS NOT NULL
              AND high_adj IS NOT NULL
              AND low_adj IS NOT NULL
            ORDER BY trade_date
            """,
            (symbol,),
        ).fetchall()
    finally:
        con.close()

    if not rows:
        raise SystemExit(f"No adjusted OHLCV rows found for {symbol}.")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    payload = {"symbol": symbol, "bars": [dict(row) for row in rows]}
    args.output.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    print(f"Exported {len(rows)} adjusted OHLCV bars for {symbol} to {args.output}")


if __name__ == "__main__":
    main()
