Status: COMPLETE

# Contract C4 — Chart Viewport Controls Delivery

## Summary

The viewer now has calendar-based range presets, pointer-centered horizontal
wheel zoom, click-and-drag horizontal pan, reset behavior, and visible-range
metadata. A single bounded `[start, end)` viewport controls rendering in the
shared SVG.

The complete OHLCV array remains in memory. Indicators and signals are
calculated from the complete array before the viewport slices bars and the
already-calculated indicator arrays for rendering.

## Marker-Interaction Regression Correction

### Implementation status

COMPLETE

### Verification status

PASSED — automated pointer-event checks and manual screenshot inspection.

### Files changed

- `src/App.jsx`
- `contracts/C4_viewport_controls/marker-buy-selected.png`
- `contracts/C4_viewport_controls/marker-sell-selected.png`

### Cause

C4 initially started chart panning and pointer capture for every primary
pointer-down inside the SVG, including pointer-down on interactive signal
markers. Pointer capture retargeted the gesture to the chart and prevented the
marker's existing click handler from completing normally.

### Fix

- Signal markers retain the existing `setSelected(s)` click behavior.
- Marker pointer-down stops propagation and never starts chart panning.
- The chart also explicitly excludes marker targets from pan initiation.
- Empty-chart movement must cross a 4-pixel threshold before it becomes a pan.
- Pointer capture is used only for empty-chart gestures.
- A click following a real drag is suppressed only for that gesture.
- A small empty-chart click does not change the viewport.

### Acceptance evidence

BUY marker after selecting `1Y`:

```text
BUY
2025-11-27
close 260.28
Fired because:
Broke 20-day high (close 260.28 > prior high 257.32)
Volume 5.91M > avg 3.83M
MACD histogram positive (1.756) — momentum agrees
```

Screenshot: [marker-buy-selected.png](marker-buy-selected.png)

SELL marker after wheel zoom changed the viewport to `Custom`:

```text
SELL
2025-10-09
close 267.53
Fired because:
Closed below SMA50 (269.14) — trend broke
```

Screenshot: [marker-sell-selected.png](marker-sell-selected.png)

Automated pointer regression output:

```json
{
  "smallClickUnchanged": true,
  "noSelectionAfterSmallClick": true,
  "afterDrag": "Visible: 2025-05-22 → 2026-05-20 · Bars: 251 · Mode: Custom",
  "dragChangedViewport": true,
  "noSelectionAfterDrag": true,
  "buyAfterPan": "BUY ... close 170.76 ... Fired because: ...",
  "sellAfterSymbolSwitch": "SELL ... close 267.53 ... Fired because: ...",
  "crosshair": true
}
```

This specifically verifies marker selection after a preset, zoom, pan, and
symbol switch, plus empty-space drag, sub-threshold click, and crosshair
behavior.

### Problems encountered

Manual C4 verification found visible markers no longer responded to clicks.

### Resolutions applied

The pointer-event ownership was corrected without changing marker information,
selection state, viewport calculations, or signal logic.

## T1 — Add Centralized Viewport State

### Implementation status

COMPLETE

### Verification status

PASSED

### Files changed

- `src/chartViewport.js`
- `src/App.jsx`

### Acceptance evidence

`App` stores the single `viewport` state object with `start`, `end`, and
`mode`. `boundedViewport` validates it, `visibleBars` derives the rendered
OHLCV slice, and `visibleInd` slices every full-history indicator array with
the same boundaries.

Signals are generated from full `bars` and full `ind`, then filtered and
re-indexed only for marker rendering. Price, volume, MACD, RSI, overlays,
markers, and crosshair are all rendered inside one SVG using the same
`visibleBars.length`, `cw`, and `xC`.

Browser evidence:

```json
{
  "oneSvg": true,
  "visibleBarsMatch": true,
  "panes": true
}
```

### Problems encountered

None.

### Resolutions applied

Not applicable.

## T2 — Implement Range Presets

### Implementation status

COMPLETE

### Verification status

PASSED

### Files changed

- `src/chartViewport.js`
- `src/App.jsx`

### Acceptance evidence

All required calendar-based presets passed against OGDC:

```json
{
  "1M":  {"start":"2026-06-10","end":"2026-07-10","bars":21,"mode":"1M"},
  "3M":  {"start":"2026-04-10","end":"2026-07-10","bars":60,"mode":"3M"},
  "6M":  {"start":"2026-01-12","end":"2026-07-10","bars":121,"mode":"6M"},
  "1Y":  {"start":"2025-07-10","end":"2026-07-10","bars":251,"mode":"1Y"},
  "3Y":  {"start":"2023-07-10","end":"2026-07-10","bars":744,"mode":"3Y"},
  "5Y":  {"start":"2021-07-12","end":"2026-07-10","bars":1237,"mode":"5Y"},
  "ALL": {"start":"2020-01-01","end":"2026-07-10","bars":1615,"mode":"ALL"}
}
```

Weekend boundaries correctly advance to the first available trading date.

BFBIO has only 429 bars from 2024-10-21. Its `5Y` preset safely displayed all
429 available bars while remaining identified as `5Y`.

Screenshot: [range-presets.png](range-presets.png)

### Problems encountered

The current 1M calendar period contains 21 trading bars, below the general
24-bar manual zoom floor.

### Resolutions applied

Named calendar presets are allowed to contain their natural number of bars.
Manual zoom-in from an already-shorter preset stays at that count rather than
unexpectedly expanding it; zoom-out increases the range normally.

## T3 — Implement Mouse-Wheel Zoom

### Implementation status

COMPLETE

### Verification status

PASSED

### Files changed

- `src/chartViewport.js`
- `src/App.jsx`

### Acceptance evidence

Headless Chrome dispatched real wheel input over the chart center:

```json
{
  "beforeZoom": {"start":"2025-07-10","end":"2026-07-10","bars":251,"mode":"1Y"},
  "zoomedIn":   {"start":"2025-08-18","end":"2026-06-04","bars":201,"mode":"Custom"},
  "zoomedOut":  {"start":"2025-07-10","end":"2026-07-10","bars":251,"mode":"Custom"},
  "minimumZoom":{"start":"2025-12-29","end":"2026-01-29","bars":24,"mode":"Custom"}
}
```

The pointer position determines the preserved zoom anchor. Wheel handling
prevents page scrolling while the pointer is over the chart.

Screenshot: [custom-viewport.png](custom-viewport.png)

### Problems encountered

None in application behavior.

### Resolutions applied

Not applicable.

## T4 — Implement Horizontal Pan

### Implementation status

COMPLETE

### Verification status

PASSED

### Files changed

- `src/chartViewport.js`
- `src/App.jsx`

### Acceptance evidence

The 251-bar count stayed constant through older/newer drags and both boundary
clamps:

```json
{
  "initial": {"start":"2025-07-10","end":"2026-07-10","bars":251,"mode":"1Y"},
  "older":   {"start":"2025-03-10","end":"2026-03-10","bars":251,"mode":"Custom"},
  "newer":   {"start":"2025-07-10","end":"2026-07-10","bars":251,"mode":"Custom"},
  "oldestClamp":{"start":"2020-01-01","end":"2020-12-31","bars":251,"mode":"Custom"},
  "newestClamp":{"start":"2025-07-10","end":"2026-07-10","bars":251,"mode":"Custom"}
}
```

Pointer capture keeps the drag active outside the SVG and pointer up/cancel
clears the drag state.

### Problems encountered

None.

### Resolutions applied

Not applicable.

## T5 — Add Reset and Visible-Range Metadata

### Implementation status

COMPLETE

### Verification status

PASSED

### Files changed

- `src/App.jsx`

### Acceptance evidence

The metadata displays visible start, visible end, bar count, and mode. After
selecting `1Y`, manually zooming to `Custom`, and clicking Reset View:

```json
{
  "start":"2020-01-01",
  "end":"2026-07-10",
  "bars":1615,
  "mode":"ALL"
}
```

Named-preset reset reapplies that preset; custom reset returns to `ALL`.

Visible metadata appears in all three screenshots.

### Problems encountered

None.

### Resolutions applied

Not applicable.

## T6 — Handle Symbol Changes

### Implementation status

COMPLETE

### Verification status

PASSED

### Files changed

- `src/App.jsx`

### Acceptance evidence

With OGDC in `1Y`, switching to DGKC recomputed DGKC's own calendar viewport:

```json
{"start":"2025-07-10","end":"2026-07-10","bars":251,"mode":"1Y"}
```

After manually zooming to `Custom`, switching back to OGDC produced:

```json
{"start":"2020-01-01","end":"2026-07-10","bars":1615,"mode":"ALL"}
```

No raw viewport indexes are reused between symbols.

Screenshot: [non-default-synchronized.png](non-default-synchronized.png)

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
- `contracts/C4_viewport_controls/DELIVERY.md`
- `contracts/C4_viewport_controls/range-presets.png`
- `contracts/C4_viewport_controls/custom-viewport.png`
- `contracts/C4_viewport_controls/non-default-synchronized.png`
- `contracts/C4_viewport_controls/marker-buy-selected.png`
- `contracts/C4_viewport_controls/marker-sell-selected.png`

### Acceptance evidence

Browser regression output:

```json
{
  "invalidPreserved": true,
  "persistence": true,
  "regression": {
    "oneSvg": true,
    "visibleBarsMatch": true,
    "crosshair": true,
    "sliders": 4,
    "panes": true,
    "signalSummary": true
  }
}
```

The non-default DGKC screenshot shows the `1Y` preset, synchronized price,
volume, MACD, and RSI panes, SMA overlays, Bollinger Bands, markers, summary
statistics, symbol selector, and parameter-control section.

Production build:

```text
$ npm run build
vite v8.1.5 building client environment for production...
✓ 19 modules transformed.
dist/index.html                   0.46 kB │ gzip:  0.29 kB
dist/assets/index-nqMpL4T3.css    1.78 kB │ gzip:  0.81 kB
dist/assets/index-CcIbfxd_.js   212.73 kB │ gzip: 67.84 kB
✓ built in 129ms
```

`npm run lint` completed with only the same three pre-existing unused-variable
warnings in the untouched chart-stat section.

### Problems encountered

The external Chrome DevTools test harness initially attempted to serialize a
DOM element and later accepted symbol metadata just before the SVG mounted.

### Resolutions applied

The harness assertions were corrected to return booleans and wait for the
chart surface. The complete suite then passed. No application workaround was
required.

## Documentation

`README.md` now documents the presets, visible metadata, wheel zoom, drag pan,
reset semantics, and the full-history calculation architecture.

## Contract Verdict

- Implementation result: all C4 viewport tasks implemented.
- Verification result: presets, zoom, minimum limit, pan directions,
  boundaries, reset, symbol changes, short history, C3 regression, visual
  alignment, BUY/SELL marker interaction, click-versus-drag classification,
  lint, and production build passed.
- Unresolved issues: none.
- Deviations from the contract: the delivery is alongside the uploaded
  `contracts/C4_viewport_controls/CONTRACT.md`; the contract text mentions a
  different example directory name.
- Overall contract status: COMPLETE.
