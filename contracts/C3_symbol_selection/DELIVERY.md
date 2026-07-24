Status: COMPLETE

# Contract C3 — Symbol Selection Delivery

## Summary

The viewer now loads the authoritative ticker list from `GET /symbols` and
provides a searchable, keyboard- and mouse-accessible autocomplete selector.
Confirmed symbols load through `GET /ohlcv/{symbol}`, successful selections
persist in local storage, and failed or invalid selections preserve the
currently displayed chart.

The indicator calculations, signal generator, chart panes, and strategy
controls were not changed.

## T1 — Centralize Symbol Configuration

### Implementation status

COMPLETE

### Verification status

PASSED

### Files changed

- `src/api.js`
- `src/App.jsx`

### Acceptance evidence

```text
$ rg -n "OGDC" src
src/api.js:4:export const DEFAULT_SYMBOL = "OGDC";
```

`OGDC` remains only as the centralized `DEFAULT_SYMBOL`. All OHLCV requests
use confirmed symbol state.

### Problems encountered

None.

### Resolutions applied

Not applicable.

## T2 — Load Available Symbols

### Implementation status

COMPLETE

`fetchSymbols` is centralized in `src/api.js`. It validates the array,
normalizes tickers to uppercase, removes invalid/duplicate entries, and does
not use a static fallback list.

### Verification status

PASSED

### Files changed

- `src/api.js`
- `src/App.jsx`

### Acceptance evidence

```text
$ curl http://127.0.0.1:8000/health
{"status":"ok"}

$ curl http://127.0.0.1:8000/symbols
821 symbols received
DG prefix matches: ["DGKC"]
```

The browser loaded the symbol list and populated the autocomplete with `DGKC`
after `DG` was typed.

### Problems encountered

Port 8000 was already occupied during verification.

### Resolutions applied

The existing listener was checked through `/health` and `/symbols`, confirmed
as the Signal Viewer API, and used without interruption.

## T3 — Implement Searchable Autocomplete

### Implementation status

COMPLETE

The focused `SymbolSelector` component:

- normalizes input to uppercase,
- places prefix matches before substring matches,
- limits the list to 12 results,
- supports mouse selection,
- supports ArrowDown, ArrowUp, Enter, and Escape,
- supports exact direct entry.

### Verification status

PASSED

### Files changed

- `src/SymbolSelector.jsx`
- `src/App.jsx`

### Acceptance evidence

Automated headless Chrome output:

```json
{
  "dgSuggestions": ["DGKC"],
  "highlighted": "DGKC",
  "mouseSelected": true,
  "directEntry": true
}
```

The test typed `DG`, pressed ArrowDown, verified `DGKC` was highlighted, and
pressed Enter to load it. A separate test selected `OGDC` with a mouse event,
and exact direct entry loaded `DGKC`.

Screenshot: [autocomplete.png](autocomplete.png)

### Problems encountered

The source symbol list currently has only one `DG` prefix match.

### Resolutions applied

The acceptance case still demonstrates that suggestions are sourced from the
API and that keyboard highlighting and selection work. The general ordering
logic covers additional prefix and substring matches.

## T4 — Load the Selected Symbol

### Implementation status

COMPLETE

The typed value, confirmed selection, and successfully loaded symbol are
separate state values. Each confirmed load receives an `AbortController`;
starting another load aborts the older request so stale data cannot overwrite
the new selection.

### Verification status

PASSED

### Files changed

- `src/App.jsx`
- `src/api.js`

### Acceptance evidence

```json
{
  "initial": ["OGDC", "1,615", "2020-01-01", "2026-07-10"],
  "dgkcMeta": "Symbol: DGKC · Bars: 1,615 · Range: 2020-01-01 → 2026-07-10 · Source: HTTP API"
}
```

The runtime screenshots show visibly different OGDC and DGKC price histories
and signal summaries.

Non-default screenshot: [non-default-symbol.png](non-default-symbol.png)

### Problems encountered

None.

### Resolutions applied

Not applicable.

## T5 — Implement Validation and Error States

### Implementation status

COMPLETE

The UI distinguishes symbol-list loading/failure, OHLCV loading/failure,
invalid input, and empty data. Invalid and failed OHLCV selections do not
replace the loaded chart. Symbol-list and OHLCV failures expose retry actions.

### Verification status

PASSED

### Files changed

- `src/App.jsx`
- `src/SymbolSelector.jsx`
- `src/api.js`

### Acceptance evidence

Automated headless Chrome output:

```json
{
  "invalidPreserved": true,
  "failurePreserved": true,
  "recovered": true,
  "symbolListRecovered": true
}
```

The test:

1. submitted `NOTREAL` and observed `"NOTREAL" is not an available symbol`,
2. confirmed the DGKC chart remained displayed,
3. blocked an OGDC OHLCV request and observed the recoverable load error,
4. restored API access and successfully loaded OGDC,
5. blocked `/symbols`, observed the symbol-list error and retry control, then
   restored access and recovered through Retry.

Screenshot: [invalid-symbol.png](invalid-symbol.png)

### Problems encountered

One Chrome DevTools reload produced a normal target-navigation race in the
external test harness.

### Resolutions applied

The harness was made tolerant of that navigation event and the full suite was
rerun successfully. Application code was unaffected.

## T6 — Persist the Selected Symbol

### Implementation status

COMPLETE

Successful loads store the ticker under `psx_signal_viewer_symbol`. Startup
validates the stored value against the API list before using it; an invalid
stored value falls back to the centralized default.

### Verification status

PASSED

### Files changed

- `src/App.jsx`

### Acceptance evidence

```json
{
  "persisted": true,
  "invalidStorageFallback": true
}
```

The browser test loaded DGKC, refreshed, and confirmed DGKC loaded again. It
then stored `NOTREAL`, refreshed, and confirmed the viewer safely loaded OGDC.

### Problems encountered

None.

### Resolutions applied

Not applicable.

## T7 — Regression Verification

### Implementation status

COMPLETE

### Verification status

PASSED

### Files changed

- `README.md`
- `contracts/C3_symbol_selection/DELIVERY.md`
- `contracts/C3_symbol_selection/autocomplete.png`
- `contracts/C3_symbol_selection/non-default-symbol.png`
- `contracts/C3_symbol_selection/invalid-symbol.png`

### Acceptance evidence

```text
$ npm run build
vite v8.1.5 building client environment for production...
✓ 18 modules transformed.
dist/index.html                   0.46 kB │ gzip:  0.29 kB
dist/assets/index-nqMpL4T3.css    1.78 kB │ gzip:  0.81 kB
dist/assets/index-DtJ6yNKF.js   208.58 kB │ gzip: 66.55 kB
✓ built in 133ms
```

The non-default DGKC screenshot visibly includes candlesticks, volume, MACD,
RSI, SMA overlays, buy/sell markers, signal summaries, and the existing
parameter-controls section. Bollinger remains available through its existing
toggle.

`npm run lint` completed with only three pre-existing unused-variable warnings
in the unchanged chart/stat section.

### Problems encountered

None affecting the implementation.

### Resolutions applied

Not applicable.

## Documentation

`README.md` now explains searching, keyboard/mouse selection, direct entry,
persistence, and recoverable validation/request failures.

## Contract Verdict

- Implementation result: all C3 tasks implemented.
- Verification result: mandatory API, browser interaction, persistence,
  recovery, screenshot, lint, and production-build checks passed.
- Unresolved issues: none.
- Deviations from the contract: none.
- Overall contract status: COMPLETE.
