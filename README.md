# Signal Viewer

The viewer loads adjusted OHLCV data from a temporary local FastAPI service.
The browser only knows the service's HTTP URL, so the API can later move
without changing viewer behavior.

## Activate workspace-local tools

This workspace includes a local Node 22 runtime and local Python packages. In
each new shell, activate them before using `npm`, `uvicorn`, or the API:

```bash
source scripts/activate_local_tools.sh
```

The local runtimes live under the ignored `.tools/` directory and do not
modify the operating-system Python or Node installation.

## Start the data API

Create a Python environment, install the service dependencies, and point the
service at the PSX SQLite database:

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r api/requirements.txt
export PSX_DB_PATH=/path/to/psx_watcher.db
export PSX_ML_C7_ROOT=/home/hassan/psx-ml-research
uvicorn api.app:app --reload --port 8000
```

The service opens SQLite in read-only mode. Its endpoints are:

- `GET /health`
- `GET /symbols`
- `GET /ohlcv/{symbol}`
- `GET /ml/c7/summary`
- `GET /ml/c7/fold-metrics`
- `GET /ml/c7/runtime`
- `GET /ml/c7/feature-importance`

The C7 endpoints open only the accepted manifest, validation predictions, and
feature-importance files beneath `PSX_ML_C7_ROOT`. They verify the manifest
holdout guard, file hashes, schemas, row counts, and validation boundaries
before returning bounded analysis responses.

## Start the viewer

In another shell:

```bash
npm install
VITE_API_URL=http://localhost:8000 npm run dev
```

`VITE_API_URL` is the centralized browser-side service location. It defaults
to `http://localhost:8000` for local development.

## Select a symbol

The viewer retrieves the authoritative ticker list from `GET /symbols`. Type
in the symbol field to search, use the arrow keys and Enter or click a
suggestion, or enter an exact ticker and choose **Load**. Prefix matches appear
first.

The last successfully loaded symbol is saved in browser local storage and
restored after refresh. Invalid input and failed requests leave the current
chart in place so another symbol can be selected or the request retried.

## Navigate the chart

Use `1M`, `3M`, `6M`, `1Y`, `3Y`, `5Y`, or `ALL` to select a calendar-based
visible range. The metadata below the symbol shows the visible dates, bar
count, and current mode.

Place the pointer over the chart and use the mouse wheel to zoom horizontally.
Click and drag horizontally to pan through history. Manual zoom or pan changes
the mode to `Custom`; **Reset View** returns a custom viewport to `ALL`.

All OHLCV remains loaded in the browser. Indicators and signals continue to be
calculated from the full history, while the viewport controls only which
already-calculated values are rendered.

The C1 script at `scripts/export_market_data.py` remains available as a
diagnostic/manual export utility. It is not used by the viewer's runtime path.

## Vite template notes

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and Oxlint's TypeScript related rules in your project.
