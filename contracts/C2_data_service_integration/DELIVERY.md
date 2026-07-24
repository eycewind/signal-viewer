# Contract C2 — Data Service Integration Delivery

## Summary

The Signal Viewer now obtains adjusted daily OHLCV directly from SQLite through
a temporary FastAPI service under `api/`. The React client uses the centralized
`VITE_API_URL` configuration and no longer reads a generated JSON asset.

The JavaScript indicator calculations, signal generation, chart layout, and
controls remain unchanged.

## T1 — Implement Python API

### Implementation status

COMPLETE

- Added the FastAPI application in `api/app.py`.
- The database location is supplied through `PSX_DB_PATH`.
- SQLite is opened with URI `mode=ro` and `PRAGMA query_only = ON`.
- Added local-development CORS for `localhost` and `127.0.0.1`.

### Verification status

PASSED

### Acceptance evidence

```text
$ curl http://127.0.0.1:8000/health
{"status":"ok"}
```

## T2 — Expose Symbol List

### Implementation status

COMPLETE

- Added `GET /symbols`.
- The query returns distinct symbols that have usable adjusted OHLCV rows.

### Verification status

PASSED — 821 symbols returned in the final verification. The live source
database changed during the work, so an earlier run returned 804.

### Acceptance evidence

```text
$ curl http://127.0.0.1:8000/symbols
["786","786R","AABS","AATM","ABL","ABOT","ACIETF","ACPL","ADAMS","ADMM",
 "ADOS","AEL","AGHA","AGIC","AGICR2","AGIL","AGL","AGLNCPS","AGP","AGSILSC", ...]
```

## T3 — Expose Adjusted OHLCV

### Implementation status

COMPLETE

- Added `GET /ohlcv/{symbol}`.
- Symbol lookup uses a bound SQL parameter.
- Adjusted rows are returned oldest to newest directly from SQLite.
- No ORM, watcher code import, or intermediate JSON transport is used.

### Verification status

PASSED — OGDC returned 1,615 bars, matching the retained C1 export exactly
before that generated asset was removed.

### Acceptance evidence

```text
$ curl http://127.0.0.1:8000/ohlcv/OGDC
[
  {"date":"2020-01-01","open":142.5,"high":143.75,"low":141.3,"close":142.92,"volume":784400.0},
  {"date":"2020-01-02","open":143.35,"high":148.49,"low":142.65,"close":147.16,"volume":4383500.0},
  {"date":"2020-01-03","open":150.0,"high":150.6,"low":146.75,"close":149.48,"volume":4019800.0},
  {"date":"2020-01-06","open":148.1,"high":151.0,"low":146.6,"close":148.56,"volume":3992300.0},
  {"date":"2020-01-07","open":147.9,"high":149.7,"low":146.25,"close":149.01,"volume":2355100.0}
]

bar_count=1615
oldest=2020-01-01
newest=2026-07-10
matches_C1_export=True
```

## T4 — Integrate Viewer

### Implementation status

COMPLETE

- Added `src/api.js` as the centralized HTTP client.
- `VITE_API_URL` controls the service location and defaults to
  `http://localhost:8000`.
- `src/App.jsx` now requests `GET /ohlcv/OGDC`.
- Existing JavaScript indicator and signal-generation functions were not
  changed.

### Verification status

PASSED

### Acceptance evidence

```text
$ npm run build
vite v8.1.5 building client environment for production...
✓ 17 modules transformed.
dist/index.html                   0.46 kB │ gzip:  0.29 kB
dist/assets/index-nqMpL4T3.css    1.78 kB │ gzip:  0.81 kB
dist/assets/index-DB59Fu8I.js   203.22 kB │ gzip: 64.95 kB
✓ built in 106ms
```

A headless Chrome runtime check against Vite and the API found the rendered
labels `Signal viewer`, `Signals`, and `Closed trades`, with neither the
loading state nor the data-error state present.

Screenshot: [viewer.png](viewer.png)

## T5 — Remove JSON Dependency

### Implementation status

COMPLETE

- Removed `public/data/OGDC.json` only after the endpoints, browser fetch, and
  production build passed.
- Retained `scripts/export_market_data.py` as a C1 diagnostic/manual export
  utility. It is not part of the viewer runtime.

### Verification status

PASSED

### Acceptance evidence

```text
$ find public/data -maxdepth 1 -type f -printf '%f\n'
# no output

$ rg '/data/OGDC|OGDC\.json' src README.md api .env.example
# no output

$ npm run build
✓ built in 106ms
```

After removal, a second headless Chrome check again rendered `Signal viewer`,
`Signals`, and `Closed trades`. The viewer therefore operates without the
generated JSON file.

## Problems encountered and resolutions

- FastAPI was not initially installed in the `psx` Conda environment. With
  approval, FastAPI and Uvicorn were installed from `api/requirements.txt`.
- Port 5173 was occupied, so Vite selected 5174. The API's local CORS rule was
  generalized to allow any localhost or `127.0.0.1` development port.
- The SQLite CLI does not accept a trailing value as a bound query parameter.
  That read-only diagnostic was rerun with a fixed literal; application queries
  use Python SQLite bound parameters.

# Status

COMPLETE
