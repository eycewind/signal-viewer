# Signal Viewer – Contract C3: Symbol Selection

## Background

Contract C2 replaced the generated JSON transport with a temporary FastAPI service under `api/`.

The viewer now retrieves adjusted OHLCV data through:

```text
GET /symbols
GET /ohlcv/{symbol}
```

The viewer still loads a fixed symbol, currently `OGDC`.

The next step is to allow the user to select any available symbol without changing the charting, indicator, or signal logic.

---

# Objective

Add a searchable symbol selector to the Signal Viewer.

The user shall be able to:

- search available PSX symbols,
- select a symbol from matching suggestions,
- manually enter a valid ticker such as `DGKC`,
- load that symbol's OHLCV data from the existing API,
- see which symbol is currently displayed,
- retain the selected symbol after a page refresh.

The implementation shall preserve all existing indicators, signals, controls, and chart behavior.

---

# Scope

## In Scope

- Retrieve available symbols from `GET /symbols`.
- Add a searchable symbol input with autocomplete suggestions.
- Support keyboard and mouse selection.
- Support direct ticker entry.
- Load OHLCV from `GET /ohlcv/{symbol}`.
- Replace the hardcoded `OGDC` data request with configurable symbol state.
- Display the currently loaded symbol clearly.
- Preserve the selected symbol across page refreshes.
- Add clear loading and error states.
- Update documentation and delivery evidence.

---

## Out of Scope

The following are explicitly not part of this contract:

- date-range selection,
- chart zoom changes,
- chart pan changes,
- watchlists,
- favourites,
- sector filters,
- company-name search,
- multiple-symbol comparison,
- backend database changes,
- new API endpoints,
- Python-generated indicators,
- Python-generated signals,
- strategy changes,
- chart redesign,
- mobile layout redesign,
- performance optimization unrelated to symbol selection.

---

# Architectural Constraints

- Continue using the existing FastAPI service.
- Use `GET /symbols` as the authoritative list of selectable symbols.
- Use `GET /ohlcv/{symbol}` for historical adjusted OHLCV.
- Do not read SQLite directly from React.
- Do not reintroduce generated JSON files.
- Do not hardcode workstation-specific paths.
- Keep API access centralized through `src/api.js`.
- Preserve `VITE_API_URL`.
- Preserve existing JavaScript indicator calculations.
- Preserve existing JavaScript signal generation.
- Do not import code from the `stock-watcher` repository.
- Avoid unrelated refactoring.

---

# Default Symbol

The default symbol shall be defined in one centralized location.

Recommended behavior:

1. Use a symbol stored in browser local storage, if present and valid.
2. Otherwise use the configured default symbol.
3. The initial configured default shall be:

```text
OGDC
```

The default symbol shall not remain scattered or hardcoded in multiple React components.

---

# Symbol Selector Requirements

The selector shall be implemented as a searchable text input with autocomplete.

A large static dropdown is not acceptable because the API may return hundreds of symbols.

## Required behavior

The selector shall:

- accept typed ticker text,
- normalize input to uppercase,
- filter available symbols,
- show matching suggestions,
- support mouse selection,
- support keyboard navigation,
- load the selected symbol when confirmed,
- allow exact manual ticker entry,
- close suggestions after selection,
- retain the current chart until a new valid symbol begins loading.

## Keyboard behavior

At minimum:

- `ArrowDown` moves to the next suggestion.
- `ArrowUp` moves to the previous suggestion.
- `Enter` selects the highlighted suggestion or submits an exact typed symbol.
- `Escape` closes the suggestion list.

## Matching behavior

Matching shall be case-insensitive.

Prefix matches should appear before broader substring matches.

Example:

```text
Input: DG
Preferred ordering:
DGKC
DGL
other symbols containing DG
```

The implementation does not need fuzzy search.

---

# State Requirements

The implementation shall distinguish between:

- typed input value,
- selected symbol,
- loaded symbol,
- symbol-list loading state,
- OHLCV loading state,
- invalid-symbol state,
- empty-data state,
- API-error state.

Typing into the input shall not immediately replace the loaded chart on every keystroke.

A new OHLCV request shall occur only after the user confirms a symbol.

---

# Persistence Requirements

The selected symbol shall persist across page refreshes using browser local storage.

Recommended key:

```text
psx_signal_viewer_symbol
```

On startup:

- read the stored symbol,
- validate it against the available symbol list,
- use it if valid,
- otherwise fall back to the configured default symbol.

An invalid stored value shall not prevent the viewer from loading.

---

# API Error Handling

## Symbol-list failure

If `GET /symbols` fails:

- display a clear error,
- keep the page usable,
- allow retrying,
- do not silently fall back to an outdated hardcoded symbol list.

## Invalid symbol

If the user submits a symbol that is not present in the loaded symbol list:

- do not replace the current chart,
- show a clear validation message,
- do not issue an OHLCV request for the invalid value.

## OHLCV request failure

If `GET /ohlcv/{symbol}` fails:

- preserve the previously loaded chart where practical,
- show a visible error message,
- allow retrying or selecting another symbol.

## Empty response

If the API returns no OHLCV rows:

- show an empty-data message,
- do not crash the chart,
- do not treat the request as a successful chart load.

---

# UI Requirements

The selector should fit into the existing viewer layout without redesigning the page.

At minimum, display:

- searchable ticker input,
- current loaded symbol,
- autocomplete suggestion list,
- loading state,
- validation or API error message.

A compact information label is acceptable, for example:

```text
Symbol: DGKC
Bars: 1,524
Range: 2020-01-01 → 2026-07-10
Source: HTTP API
```

The information label is optional unless already easy to derive from existing state.

The chart title or header shall clearly reflect the currently loaded symbol.

---

# Tasks

## T1 – Centralize Symbol Configuration

### Objective

Remove the fixed `OGDC` request from the viewer's data-loading flow.

### Requirements

- Define the default symbol in one centralized location.
- Add selected-symbol state.
- Ensure OHLCV requests use the selected symbol.
- Keep all API access inside `src/api.js` or an equivalent centralized API module.

### Acceptance Evidence

Provide:

```bash
rg "OGDC" src
```

Explain any remaining references.

A remaining `OGDC` value is acceptable only as the centralized default symbol or test fixture.

---

## T2 – Load Available Symbols

### Objective

Retrieve the authoritative symbol list from the API.

### Requirements

- Call `GET /symbols`.
- Normalize or validate the response.
- Store the available symbols in React state.
- Handle loading and API failure.
- Do not embed a static fallback symbol list.

### Acceptance Evidence

Provide browser or terminal evidence showing:

- the `/symbols` request succeeds,
- the viewer receives the symbol count,
- autocomplete is populated from the API response.

Example terminal evidence:

```bash
curl http://127.0.0.1:8000/symbols
```

---

## T3 – Implement Searchable Autocomplete

### Objective

Add a scalable symbol selector.

### Requirements

- Add a text input.
- Filter symbols case-insensitively.
- Prefer prefix matches.
- Show matching suggestions.
- Support mouse selection.
- Support `ArrowUp`, `ArrowDown`, `Enter`, and `Escape`.
- Limit the number of visible suggestions to a reasonable number.

Recommended visible maximum:

```text
10–20 suggestions
```

### Acceptance Evidence

Provide evidence demonstrating:

- typing `DG` shows relevant symbols,
- keyboard navigation changes the highlighted result,
- pressing `Enter` selects the symbol,
- mouse selection works.

Attach at least one screenshot showing the open autocomplete list.

---

## T4 – Load the Selected Symbol

### Objective

Load adjusted OHLCV for the confirmed symbol.

### Requirements

- Request `GET /ohlcv/{symbol}`.
- Update the chart only after valid data is received.
- Update the displayed symbol.
- Recalculate existing JavaScript indicators and signals using the new data.
- Do not modify the indicator or signal algorithms.
- Prevent stale requests from overwriting a newer symbol selection.

The implementation should handle rapid symbol changes safely.

Using an `AbortController`, request identifier, or equivalent approach is acceptable.

### Acceptance Evidence

Demonstrate successful loading of at least:

```text
OGDC
DGKC
```

For each symbol, provide evidence showing:

- the OHLCV request,
- the displayed symbol,
- a visibly different chart or date/bar metadata.

---

## T5 – Implement Validation and Error States

### Objective

Prevent invalid input and API failures from breaking the viewer.

### Requirements

Handle:

- unavailable symbol list,
- invalid manual ticker,
- failed OHLCV request,
- empty OHLCV response,
- loading state.

The existing chart should not disappear merely because the user typed an invalid value.

### Acceptance Evidence

Demonstrate:

1. an invalid ticker such as `NOTREAL`,
2. a failed or unavailable API request,
3. recovery by selecting a valid symbol.

Include screenshots or browser-test output.

---

## T6 – Persist the Selected Symbol

### Objective

Restore the last valid selection after a refresh.

### Requirements

- Store the selected symbol in local storage after successful loading.
- Read it during startup.
- Validate it against `GET /symbols`.
- Fall back to the default symbol if invalid or unavailable.

### Acceptance Evidence

Demonstrate:

1. select `DGKC`,
2. refresh the page,
3. confirm that `DGKC` loads again.

Also demonstrate that an invalid stored value falls back safely.

---

## T7 – Regression Verification

### Objective

Confirm that symbol selection does not change existing viewer behavior.

### Requirements

Verify that the viewer still supports:

- candlesticks,
- volume,
- MACD,
- RSI,
- Bollinger Bands,
- SMA overlays,
- buy/sell markers,
- parameter sliders,
- existing trade or signal summaries.

### Acceptance Evidence

Run:

```bash
npm run build
```

Provide successful output.

Also provide one runtime screenshot of a non-default symbol with the existing chart panes and controls visible.

---

# Files and Project Structure

Likely files to modify:

```text
src/App.jsx
src/api.js
src/App.css
.env.example
README.md
contracts/C3_symbol_selection/DELIVERY.md
```

Additional small components are acceptable, for example:

```text
src/components/SymbolSelector.jsx
```

Do not split the application into many new files unless the separation is clearly useful.

No changes should be required inside:

```text
stock-watcher/
```

The API may receive small corrections only if needed to return appropriate HTTP errors. Any such change must be documented and kept within C3 scope.

---

# Testing Requirements

At minimum, verify:

- API service starts,
- viewer starts,
- symbol list loads,
- autocomplete filters correctly,
- keyboard selection works,
- mouse selection works,
- direct valid entry works,
- invalid entry is rejected,
- two different symbols load,
- page refresh restores the last valid symbol,
- failed requests show a recoverable error,
- production build succeeds.

Automated browser checks are encouraged but not mandatory if strong manual evidence is provided.

---

# DELIVERY.md Requirements

Create:

```text
contracts/C3_symbol_selection/DELIVERY.md
```

The delivery shall begin with:

```text
Status: COMPLETE
```

or:

```text
Status: BLOCKED
```

or:

```text
Status: FAILED
```

For every task, report separately:

- implementation status,
- verification status,
- files changed,
- acceptance evidence,
- problems encountered,
- resolutions applied.

Raw terminal output should be included where practical.

Screenshots shall include:

- autocomplete suggestions,
- a non-default loaded symbol,
- an invalid-symbol or error state.

The delivery shall conclude with:

## Contract Verdict

Include:

- implementation result,
- verification result,
- unresolved issues,
- deviations from the contract,
- overall contract status.

Do not mark the contract `COMPLETE` unless all mandatory acceptance criteria have been verified.

---

# Completion Criteria

C3 is complete only when:

- symbols are loaded from `GET /symbols`,
- the user can search and select symbols,
- keyboard and mouse selection work,
- direct valid ticker entry works,
- invalid symbols are rejected clearly,
- selected symbols load through `GET /ohlcv/{symbol}`,
- the loaded symbol is visible,
- the selection persists across refreshes,
- error states are recoverable,
- existing chart and signal behavior remains intact,
- `npm run build` succeeds,
- no generated JSON dependency is reintroduced.

---

# Executor Notes

- Read the existing C2 implementation and delivery before coding.
- Inspect the current component structure before proposing changes.
- Keep the implementation focused.
- Do not redesign the viewer.
- Do not add range, zoom, watchlist, or backend-business-logic features.
- Stop and report clearly if the existing API cannot support the required behavior.