"""Temporary HTTP data service for the Signal Viewer."""
from __future__ import annotations

import os
import sqlite3
from contextlib import closing
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from api.ml_c7 import router as ml_c7_router


app = FastAPI(title="Signal Viewer Data API")
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_methods=["GET"],
    allow_headers=["*"],
)
app.include_router(ml_c7_router)


def open_database() -> sqlite3.Connection:
    configured_path = os.environ.get("PSX_DB_PATH")
    if not configured_path:
        raise HTTPException(status_code=503, detail="PSX_DB_PATH is not configured")

    database_path = Path(configured_path).expanduser().resolve()
    try:
        connection = sqlite3.connect(
            f"{database_path.as_uri()}?mode=ro",
            uri=True,
        )
    except sqlite3.Error as error:
        raise HTTPException(status_code=503, detail="Market database is unavailable") from error

    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA query_only = ON")
    return connection


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/symbols")
def symbols() -> list[str]:
    try:
        with closing(open_database()) as connection:
            rows = connection.execute(
                """
                SELECT DISTINCT symbol
                FROM daily_ohlc
                WHERE close_adj IS NOT NULL
                  AND high_adj IS NOT NULL
                  AND low_adj IS NOT NULL
                  AND COALESCE(volume_adj, CAST(volume AS REAL)) IS NOT NULL
                ORDER BY symbol
                """
            ).fetchall()
    except sqlite3.Error as error:
        raise HTTPException(status_code=500, detail="Market data query failed") from error

    return [row["symbol"] for row in rows]


@app.get("/ohlcv/{symbol}")
def ohlcv(symbol: str) -> list[dict[str, str | float]]:
    normalized_symbol = symbol.strip().upper()
    if not normalized_symbol:
        raise HTTPException(status_code=400, detail="Symbol is required")

    try:
        with closing(open_database()) as connection:
            rows = connection.execute(
                """
                SELECT trade_date AS date,
                       COALESCE(open_adj, close_adj) AS open,
                       high_adj AS high,
                       low_adj AS low,
                       close_adj AS close,
                       COALESCE(volume_adj, CAST(volume AS REAL)) AS volume
                FROM daily_ohlc
                WHERE symbol = ?
                  AND close_adj IS NOT NULL
                  AND high_adj IS NOT NULL
                  AND low_adj IS NOT NULL
                  AND COALESCE(volume_adj, CAST(volume AS REAL)) IS NOT NULL
                ORDER BY trade_date
                """,
                (normalized_symbol,),
            ).fetchall()
    except sqlite3.Error as error:
        raise HTTPException(status_code=500, detail="Market data query failed") from error

    if not rows:
        raise HTTPException(status_code=404, detail=f"No adjusted OHLCV data found for {normalized_symbol}")

    return [dict(row) for row in rows]
