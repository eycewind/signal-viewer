# Signal Viewer – Contract C2: Data Service Integration

## Objective

Replace the current JSON file exchange with a lightweight Python HTTP service that exposes market data directly from the PSX SQLite database.

The React viewer shall retrieve historical OHLCV data via HTTP rather than reading exported JSON files. No strategy logic, indicators, UI layout, or signal generation behavior shall change.

This contract is purely an architectural improvement.

---

# Scope

## In Scope

- Implement a lightweight Python HTTP server (FastAPI or Flask acceptable).
- Connect directly to the existing SQLite database.
- Expose historical adjusted OHLCV data through a REST API.
- Modify the React viewer to consume the API instead of `public/data/OGDC.json`.
- Preserve all existing viewer functionality.
- Document how to start the API and viewer together.

---

## Out of Scope

The following are explicitly NOT part of this contract.

- Symbol selector
- Search/autocomplete
- Zoom or panning
- Date range selection
- Python-generated trading signals
- Indicator calculations on the server
- Performance optimization
- Authentication
- Database schema changes
- Viewer redesign
- Strategy changes

---

# Architecture

Target architecture after completion:

SQLite
    │
    ▼
psx-stock-watcher
    │
    ▼
signal-viewer/backend/
    │
HTTP API
    │
    ▼
React Viewer

The viewer must no longer depend on generated JSON files.

---
## Architectural Note

The backend introduced by this contract is a temporary local data service
implemented within the Signal Viewer project.

Its purpose is to remove the JSON file dependency and establish an HTTP
interface.

The long-term architectural target is for this service to migrate into the
`psx-stock-watcher` project, where it will become the authoritative data API.

The React viewer shall therefore interact only through HTTP and shall make no
assumptions about where the service is implemented.
---

## Project Structure

The HTTP service shall reside in a dedicated `backend/` directory.

Example:

signal-viewer/
├── backend/
│   ├── app.py
│   ├── requirements.txt
│   └── ...
├── src/
├── public/
├── contracts/
└── ...

The backend directory is reserved for all future Python service components
(API endpoints, database access, shared models, utilities, etc.).

The project root shall not contain standalone Python server files such as
`server.py` or `app.py`.

---

# API Requirements

## Endpoint 1

GET /health

Returns service health.

Example response

```json
{
    "status": "ok"
}
```

---

## Endpoint 2

GET /symbols

Returns available symbols.

Example

```json
[
    "OGDC",
    "DGKC",
    "LUCK",
    "ENGRO"
]
```

Ordering is not important.

---

## Endpoint 3

GET /ohlcv/<symbol>

Returns adjusted OHLCV ordered oldest → newest.

Example

```json
[
    {
        "date": "2025-01-02",
        "open": 100.2,
        "high": 101.0,
        "low": 99.5,
        "close": 100.8,
        "volume": 1200000
    }
]
```

The endpoint shall return adjusted prices.

Rows without valid adjusted prices shall be excluded.

---

# Tasks

## T1 – Implement Python API

Implement the HTTP service.

### Acceptance

Paste

```bash
curl http://localhost:<port>/health
```

and include the response.

---

## T2 – Expose Symbol List

Implement `/symbols`.

### Acceptance

Paste

```bash
curl http://localhost:<port>/symbols
```

showing at least the first 20 symbols.

---

## T3 – Expose Adjusted OHLCV

Implement `/ohlcv/<symbol>`.

The endpoint shall query SQLite directly.

No intermediate JSON files.

### Acceptance

Run

```bash
curl http://localhost:<port>/ohlcv/OGDC
```

Paste the first five records.

---

## T4 – Integrate Viewer

Modify the React viewer to retrieve data from the API.

The viewer shall continue to display:

- candlesticks
- volume
- MACD
- RSI
- Bollinger Bands
- SMA overlays
- buy/sell markers
- parameter sliders

No functionality regression is permitted.

### Acceptance

Paste

```bash
npm run build
```

Show successful completion.

Attach one screenshot of the running viewer.

---

## T5 – Remove JSON Dependency

The viewer shall no longer require `public/data/OGDC.json`.

Generated JSON files shall not be used during normal operation.

### Acceptance

Demonstrate that:

- the API is running,
- the viewer loads successfully,
- the JSON file is absent (or unused).

Paste

```bash
ls public/data
```

(or equivalent evidence)

and explain how the viewer now obtains its data.

---

# General Requirements

- Use parameterized SQL queries.
- Read-only database access.
- No ORM.
- No database schema modifications.
- Keep the implementation simple.
- Preserve existing JavaScript indicator calculations.
- Preserve existing JavaScript signal generation.

---

# DELIVERY.md Requirements

The executor shall create `DELIVERY.md` alongside this contract.

Each completed task shall include:

- implementation summary
- terminal evidence
- acceptance result
- problems encountered
- resolutions applied

The document shall conclude with:

```
Status

COMPLETE
```

or

```
Status

BLOCKED
```

or

```
Status

FAILED
```

followed by a concise explanation if not COMPLETE.

---

# Success Criteria

At completion:

- The viewer no longer reads exported JSON.
- Market data is retrieved live through HTTP.
- The viewer remains visually unchanged.
- Existing indicators and signal logic behave identically.
- The architecture cleanly separates the Python backend from the React frontend.