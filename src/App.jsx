import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { DEFAULT_SYMBOL, fetchOhlcv, fetchSymbols } from "./api";
import SymbolSelector from "./SymbolSelector";

/*
  PSX Signal Viewer — phase-1 chart + trend-following signal generator (v1)

  WHAT IT IS
  A TradingView-style viewer to SEE your signals against price + indicators,
  so you can audit the generator by eye before trusting any backtest number.

  THE SIGNAL (trend-following, deliberately legible — 3 visible conditions):
    ENTRY (buy) when ALL hold on a bar's close:
      1. close_adj makes a new N-day high   (breakout)
      2. volume > volume SMA(volLen)         (participation)
      3. MACD histogram > 0                  (momentum agrees)
    EXIT (sell) when EITHER holds:
      A. close_adj < highest-close-since-entry − k*ATR   (ATR trailing stop)
      B. close_adj < SMA(exitSMA)                        (trend break)

  Each marker is clickable and tells you in plain words which conditions fired.
  Everything is computed HERE from OHLC, so signals are real, not decorative.

  ── WIRING IN YOUR REAL DATA ────────────────────────────────────────────────
  The viewer loads daily_ohlc through the data API. Expected shape, one row/bar,
  oldest→newest, using ADJUSTED prices (close_adj etc). volume = volume_adj.

    [{ date:"2025-01-02", open:100.2, high:101.0, low:99.5, close:100.8,
       volume:1200000 }, ...]

  SQL to produce it (per symbol):
    SELECT trade_date AS date, open_adj AS open, high_adj AS high,
           low_adj AS low, close_adj AS close, volume_adj AS volume
    FROM daily_ohlc
    WHERE symbol=? AND close_adj IS NOT NULL
    ORDER BY trade_date;

  OHLCV is fetched at runtime. Indicators + signals
  recompute automatically from the bars — you don't precompute them here. If
  later you want to show signals your OFFLINE generator produced (to check the
  two agree), add an optional `signal:"buy"|"sell"` field per row and set
  USE_EXTERNAL_SIGNALS = true.
  ────────────────────────────────────────────────────────────────────────────
*/

const USE_EXTERNAL_SIGNALS = false;
const SYMBOL_STORAGE_KEY = "psx_signal_viewer_symbol";

// ---- indicator math -------------------------------------------------------
const sma = (a, n, i) => {
  if (i < n - 1) return null;
  let s = 0; for (let k = i - n + 1; k <= i; k++) s += a[k];
  return s / n;
};
function ema(vals, n) {
  const k = 2 / (n + 1), out = Array(vals.length).fill(null);
  let prev = null;
  for (let i = 0; i < vals.length; i++) {
    const v = vals[i];
    if (v == null) continue;
    prev = prev == null ? v : v * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}
function computeIndicators(bars, cfg) {
  const close = bars.map(b => b.close);
  const vol = bars.map(b => b.volume);
  const n = bars.length;

  const smaFast = close.map((_, i) => sma(close, cfg.smaFast, i));
  const smaSlow = close.map((_, i) => sma(close, cfg.smaSlow, i));
  const volSma = vol.map((_, i) => sma(vol, cfg.volLen, i));

  // Bollinger
  const bbMid = [], bbUp = [], bbLo = [];
  for (let i = 0; i < n; i++) {
    if (i < cfg.bbLen - 1) { bbMid.push(null); bbUp.push(null); bbLo.push(null); continue; }
    let m = 0; for (let k = i - cfg.bbLen + 1; k <= i; k++) m += close[k];
    m /= cfg.bbLen;
    let v = 0; for (let k = i - cfg.bbLen + 1; k <= i; k++) v += (close[k] - m) ** 2;
    const sd = Math.sqrt(v / cfg.bbLen);
    bbMid.push(m); bbUp.push(m + cfg.bbMult * sd); bbLo.push(m - cfg.bbMult * sd);
  }

  // RSI (Wilder)
  const rsi = Array(n).fill(null);
  let ag = 0, al = 0;
  for (let i = 1; i < n; i++) {
    const ch = close[i] - close[i - 1];
    const g = Math.max(ch, 0), l = Math.max(-ch, 0);
    if (i <= cfg.rsiLen) { ag += g; al += l;
      if (i === cfg.rsiLen) { ag /= cfg.rsiLen; al /= cfg.rsiLen;
        rsi[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); }
    } else {
      ag = (ag * (cfg.rsiLen - 1) + g) / cfg.rsiLen;
      al = (al * (cfg.rsiLen - 1) + l) / cfg.rsiLen;
      rsi[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
    }
  }

  // MACD
  const emaF = ema(close, cfg.macdFast), emaS = ema(close, cfg.macdSlow);
  const macd = close.map((_, i) => (emaF[i] != null && emaS[i] != null) ? emaF[i] - emaS[i] : null);
  const signalLine = ema(macd.map(v => v == null ? null : v), cfg.macdSig);
  const hist = macd.map((v, i) => (v != null && signalLine[i] != null) ? v - signalLine[i] : null);

  // ATR (Wilder)
  const atr = Array(n).fill(null);
  let prevAtr = null;
  for (let i = 1; i < n; i++) {
    const tr = Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - bars[i - 1].close),
      Math.abs(bars[i].low - bars[i - 1].close)
    );
    if (i < cfg.atrLen) { prevAtr = (prevAtr ?? 0) + tr / cfg.atrLen; atr[i] = prevAtr; }
    else { prevAtr = (prevAtr * (cfg.atrLen - 1) + tr) / cfg.atrLen; atr[i] = prevAtr; }
  }

  return { smaFast, smaSlow, volSma, bbMid, bbUp, bbLo, rsi, macd, signalLine, hist, atr };
}

// ---- signal generator (trend-following, 3 visible conditions) -------------
function generateSignals(bars, ind, cfg) {
  const n = bars.length;
  const sigs = []; // {i, type, reasons:[]}
  let inPos = false, entryIdx = null, highSinceEntry = -Infinity;

  for (let i = 0; i < n; i++) {
    const c = bars[i].close;
    if (!inPos) {
      // need an N-day high computed on PRIOR bars (exclude today to be a true breakout)
      if (i < cfg.breakoutLen) continue;
      let priorHigh = -Infinity;
      for (let k = i - cfg.breakoutLen; k < i; k++) priorHigh = Math.max(priorHigh, bars[k].close);
      const cond1 = c > priorHigh;
      const cond2 = ind.volSma[i] != null && bars[i].volume > ind.volSma[i];
      const cond3 = ind.hist[i] != null && ind.hist[i] > 0;
      if (cond1 && cond2 && cond3) {
        inPos = true; entryIdx = i; highSinceEntry = c;
        sigs.push({ i, type: "buy", reasons: [
          `Broke ${cfg.breakoutLen}-day high (close ${c.toFixed(2)} > prior high ${priorHigh.toFixed(2)})`,
          `Volume ${(bars[i].volume/1e6).toFixed(2)}M > avg ${(ind.volSma[i]/1e6).toFixed(2)}M`,
          `MACD histogram positive (${ind.hist[i].toFixed(3)}) — momentum agrees`,
        ]});
      }
    } else {
      highSinceEntry = Math.max(highSinceEntry, c);
      const atr = ind.atr[i];
      const trailStop = atr != null ? highSinceEntry - cfg.atrMult * atr : null;
      const condA = trailStop != null && c < trailStop;
      const condB = ind.smaSlow[i] != null && c < ind.smaSlow[i];
      if (condA || condB) {
        const reasons = [];
        if (condA) reasons.push(`Hit ATR trailing stop (close ${c.toFixed(2)} < ${trailStop.toFixed(2)} = peak ${highSinceEntry.toFixed(2)} − ${cfg.atrMult}×ATR)`);
        if (condB) reasons.push(`Closed below SMA${cfg.smaSlow} (${ind.smaSlow[i].toFixed(2)}) — trend broke`);
        sigs.push({ i, type: "sell", reasons, entryIdx });
        inPos = false; entryIdx = null; highSinceEntry = -Infinity;
      }
    }
  }
  return sigs;
}

// ---- external-signal path (optional) --------------------------------------
function externalSignals(bars) {
  const out = [];
  bars.forEach((b, i) => {
    if (b.signal === "buy") out.push({ i, type: "buy", reasons: ["From external generator"] });
    if (b.signal === "sell") out.push({ i, type: "sell", reasons: ["From external generator"] });
  });
  return out;
}

const DEFAULT_CFG = {
  smaFast: 20, smaSlow: 50, volLen: 20,
  bbLen: 20, bbMult: 2,
  rsiLen: 14, macdFast: 12, macdSlow: 26, macdSig: 9, atrLen: 14,
  breakoutLen: 20, atrMult: 3,
};

const COL = {
  bg: "#0e1116", grid: "#1c2230", axis: "#3a4457", text: "#8b97a8",
  textHi: "#d6dde8", up: "#26a69a", down: "#ef5350",
  smaFast: "#e0a030", smaSlow: "#5b8def", bb: "#4a5568",
  buy: "#26c281", sell: "#e2504a", macdHistUp: "#26a69a55", macdHistDn: "#ef535055",
  macdLine: "#5b8def", macdSig: "#e0a030", rsi: "#b07cf0", panel: "#151a22",
};

export default function App() {
  const [cfg, setCfg] = useState(DEFAULT_CFG);
  const [bars, setBars] = useState(null);
  const [symbols, setSymbols] = useState([]);
  const [symbolsLoading, setSymbolsLoading] = useState(true);
  const [symbolsError, setSymbolsError] = useState(null);
  const [typedSymbol, setTypedSymbol] = useState("");
  const [selectedSymbol, setSelectedSymbol] = useState(null);
  const [loadedSymbol, setLoadedSymbol] = useState(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState(null);
  const [validationError, setValidationError] = useState(null);
  const [show, setShow] = useState({ smaFast: true, smaSlow: true, bb: false });
  const [selected, setSelected] = useState(null);
  const [hover, setHover] = useState(null);
  const wrapRef = useRef(null);
  const symbolsRequestRef = useRef(null);
  const dataRequestRef = useRef(null);
  const [w, setW] = useState(900);

  const loadSymbol = useCallback(symbol => {
    dataRequestRef.current?.abort();
    const controller = new AbortController();
    dataRequestRef.current = controller;
    setSelectedSymbol(symbol);
    setDataLoading(true);
    setDataError(null);
    setValidationError(null);

    fetchOhlcv(symbol, { signal: controller.signal })
      .then(payload => {
        if (!Array.isArray(payload) || payload.length === 0) {
          throw new Error(`No historical market data is available for ${symbol}.`);
        }
        setBars(payload);
        setLoadedSymbol(symbol);
        setTypedSymbol(symbol);
        setSelected(null);
        setHover(null);
        try {
          localStorage.setItem(SYMBOL_STORAGE_KEY, symbol);
        } catch {
          // Storage may be unavailable in privacy-restricted browser contexts.
        }
      })
      .catch(error => {
        if (error.name !== "AbortError") {
          setDataError(`Unable to load ${symbol}: ${error.message}`);
        }
      })
      .finally(() => {
        if (dataRequestRef.current === controller) {
          setDataLoading(false);
        }
      });
  }, []);

  const loadSymbols = useCallback(() => {
    symbolsRequestRef.current?.abort();
    const controller = new AbortController();
    symbolsRequestRef.current = controller;
    setSymbolsLoading(true);
    setSymbolsError(null);

    fetchSymbols({ signal: controller.signal })
      .then(available => {
        if (available.length === 0) {
          throw new Error("The symbol API returned no symbols.");
        }
        setSymbols(available);
        let storedSymbol = "";
        try {
          storedSymbol = (localStorage.getItem(SYMBOL_STORAGE_KEY) || "").trim().toUpperCase();
        } catch {
          // Continue with the configured default when storage is unavailable.
        }
        const initialSymbol = available.includes(storedSymbol)
          ? storedSymbol
          : available.includes(DEFAULT_SYMBOL) ? DEFAULT_SYMBOL : available[0];
        setTypedSymbol(initialSymbol);
        loadSymbol(initialSymbol);
      })
      .catch(error => {
        if (error.name !== "AbortError") {
          setSymbolsError(`Unable to load symbols: ${error.message}`);
        }
      })
      .finally(() => {
        if (symbolsRequestRef.current === controller) {
          setSymbolsLoading(false);
        }
      });
  }, [loadSymbol]);

  useEffect(() => {
    loadSymbols();
    return () => {
      symbolsRequestRef.current?.abort();
      dataRequestRef.current?.abort();
    };
  }, [loadSymbols]);

  const confirmSymbol = symbol => {
    const normalized = symbol.trim().toUpperCase();
    setTypedSymbol(normalized);
    if (!symbols.includes(normalized)) {
      setValidationError(`"${normalized || "Empty ticker"}" is not an available symbol.`);
      return;
    }
    loadSymbol(normalized);
  };

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(e => setW(e[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [bars]);

  const ind = useMemo(() => bars ? computeIndicators(bars, cfg) : null, [bars, cfg]);
  const signals = useMemo(
    () => bars && ind ? (USE_EXTERNAL_SIGNALS ? externalSignals(bars) : generateSignals(bars, ind, cfg)) : [],
    [bars, ind, cfg]
  );

  const selector = (
    <SymbolSelector
      symbols={symbols}
      value={typedSymbol}
      onValueChange={value => {
        setTypedSymbol(value);
        setValidationError(null);
      }}
      onConfirm={confirmSymbol}
      loading={symbolsLoading}
      disabled={symbols.length === 0}
    />
  );

  const statusMessage = validationError || dataError || symbolsError;
  const header = (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10, marginBottom: 10 }}>
        <div style={{ textAlign: "left" }}>
          <div>
            <span style={{ color: COL.textHi, fontSize: 17, fontWeight: 500 }}>
              Signal viewer{loadedSymbol ? ` · ${loadedSymbol}` : ""}
            </span>
            <span style={{ marginLeft: 10, fontSize: 12 }}>trend-following · {cfg.breakoutLen}-day breakout + volume + MACD</span>
          </div>
          {loadedSymbol && bars && (
            <div style={{ marginTop: 4, fontSize: 10.5 }}>
              Symbol: <span style={{ color: COL.textHi }}>{loadedSymbol}</span>
              {" · "}Bars: {bars.length.toLocaleString()}
              {" · "}Range: {bars[0].date} → {bars[bars.length - 1].date}
              {" · "}Source: HTTP API
            </div>
          )}
        </div>
        {selector}
      </div>
      {symbolsError && (
        <div style={{ color: COL.down, fontSize: 12, marginBottom: 8 }}>
          {symbolsError}{" "}
          <button type="button" onClick={loadSymbols} style={{ color: COL.textHi, background: "transparent", border: `1px solid ${COL.axis}`, borderRadius: 5, cursor: "pointer" }}>
            Retry symbols
          </button>
        </div>
      )}
      {(validationError || dataError) && (
        <div role="alert" style={{ color: validationError ? COL.smaFast : COL.down, fontSize: 12, marginBottom: 8 }}>
          {validationError || dataError}
          {dataError && selectedSymbol && (
            <button type="button" onClick={() => loadSymbol(selectedSymbol)} style={{ marginLeft: 8, color: COL.textHi, background: "transparent", border: `1px solid ${COL.axis}`, borderRadius: 5, cursor: "pointer" }}>
              Retry
            </button>
          )}
        </div>
      )}
      {dataLoading && (
        <div style={{ color: COL.text, fontSize: 11, marginBottom: 8 }}>
          Loading {selectedSymbol}…
        </div>
      )}
    </>
  );

  if (!bars) {
    return (
      <div style={{ background: COL.bg, color: COL.text, fontFamily: "ui-sans-serif, system-ui, sans-serif", padding: 14, borderRadius: 10, minHeight: 120 }}>
        {header}
        {!statusMessage && <div style={{ padding: "12px 0" }}>Loading historical market data…</div>}
      </div>
    );
  }

  // layout
  const padL = 8, padR = 56, padT = 10;
  const priceH = 300, volH = 70, macdH = 90, rsiH = 80, gap = 8;
  const plotW = Math.max(320, w - padL - padR);
  const n = bars.length;
  const cw = plotW / n;                 // column width
  const bw = Math.max(1.5, cw * 0.62);  // candle body width

  const priceMin = Math.min(...bars.map(b => b.low));
  const priceMax = Math.max(...bars.map(b => b.high));
  const pPad = (priceMax - priceMin) * 0.06;
  const yP = v => padT + priceH - ((v - (priceMin - pPad)) / ((priceMax + pPad) - (priceMin - pPad))) * priceH;
  const xC = i => padL + i * cw + cw / 2;

  const volMax = Math.max(...bars.map(b => b.volume));
  const volTop = padT + priceH + gap;
  const yV = v => volTop + volH - (v / volMax) * volH;

  const macdVals = ind.macd.filter(v => v != null).concat(ind.signalLine.filter(v => v != null), ind.hist.filter(v => v != null));
  const macdAbs = Math.max(0.001, ...macdVals.map(Math.abs));
  const macdTop = volTop + volH + gap;
  const yM = v => macdTop + macdH / 2 - (v / macdAbs) * (macdH / 2 - 4);

  const rsiTop = macdTop + macdH + gap;
  const yR = v => rsiTop + rsiH - (v / 100) * rsiH;

  const totalH = rsiTop + rsiH + 20;

  const line = (arr, y, color, wd = 1.4) => {
    let d = "", started = false;
    for (let i = 0; i < n; i++) {
      if (arr[i] == null) { started = false; continue; }
      d += `${started ? "L" : "M"}${xC(i).toFixed(1)},${y(arr[i]).toFixed(1)} `;
      started = true;
    }
    return <path d={d} fill="none" stroke={color} strokeWidth={wd} opacity={0.9} />;
  };

  const priceTicks = 5, rsiTicks = [30, 50, 70];
  const openPos = signals.reduce((acc, s) => { // for stat: pair trades
    return acc;
  }, null);

  // simple trade stats
  const trades = [];
  let open = null;
  signals.forEach(s => {
    if (s.type === "buy") open = s;
    else if (s.type === "sell" && open) {
      const ret = (bars[s.i].close - bars[open.i].close) / bars[open.i].close;
      trades.push({ in: open.i, out: s.i, ret });
      open = null;
    }
  });
  const wins = trades.filter(t => t.ret > 0).length;
  const avgRet = trades.length ? trades.reduce((a, t) => a + t.ret, 0) / trades.length : 0;

  const num = (v, d = 0) => v.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });

  return (
    <div style={{ background: COL.bg, color: COL.text, fontFamily: "ui-sans-serif, system-ui, sans-serif", padding: 14, borderRadius: 10 }}>
      {header}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {[["smaFast", `SMA${cfg.smaFast}`], ["smaSlow", `SMA${cfg.smaSlow}`], ["bb", "Bollinger"]].map(([k, lbl]) => (
            <button key={k} onClick={() => setShow(s => ({ ...s, [k]: !s[k] }))}
              style={{ background: show[k] ? "#233043" : "transparent", color: show[k] ? COL.textHi : COL.text,
                border: `1px solid ${COL.axis}`, borderRadius: 6, padding: "3px 9px", fontSize: 12, cursor: "pointer" }}>
              {lbl}
            </button>
          ))}
        </div>
      </div>

      {/* stat row */}
      <div style={{ display: "flex", gap: 18, marginBottom: 10, flexWrap: "wrap", fontSize: 12 }}>
        <Stat label="Signals" value={`${signals.filter(s=>s.type==="buy").length} buy / ${signals.filter(s=>s.type==="sell").length} sell`} />
        <Stat label="Closed trades" value={trades.length} />
        <Stat label="Win rate" value={trades.length ? `${Math.round(100*wins/trades.length)}%` : "—"} />
        <Stat label="Avg return / trade" value={`${(avgRet*100).toFixed(2)}%`} note="pre-cost, historical data" />
      </div>

      <div ref={wrapRef} style={{ width: "100%", position: "relative" }}>
        <svg width="100%" height={totalH} viewBox={`0 0 ${w} ${totalH}`} style={{ display: "block" }}
          onMouseMove={e => {
            const r = e.currentTarget.getBoundingClientRect();
            const x = (e.clientX - r.left) * (w / r.width);
            const i = Math.round((x - padL - cw / 2) / cw);
            setHover(i >= 0 && i < n ? i : null);
          }}
          onMouseLeave={() => setHover(null)}>

          {/* price gridlines + axis labels */}
          {Array.from({ length: priceTicks + 1 }).map((_, k) => {
            const v = (priceMin - pPad) + (k / priceTicks) * ((priceMax + pPad) - (priceMin - pPad));
            const y = yP(v);
            return <g key={k}>
              <line x1={padL} x2={padL + plotW} y1={y} y2={y} stroke={COL.grid} strokeWidth={1} />
              <text x={padL + plotW + 5} y={y + 3} fill={COL.text} fontSize={10}>{v.toFixed(1)}</text>
            </g>;
          })}

          {/* Bollinger */}
          {show.bb && <>
            {line(ind.bbUp, yP, COL.bb, 1)}
            {line(ind.bbLo, yP, COL.bb, 1)}
            {line(ind.bbMid, yP, COL.bb + "aa", 1)}
          </>}

          {/* candles */}
          {bars.map((b, i) => {
            const up = b.close >= b.open;
            const col = up ? COL.up : COL.down;
            const x = xC(i);
            const yO = yP(b.open), yCl = yP(b.close);
            const bodyTop = Math.min(yO, yCl), bodyH = Math.max(1, Math.abs(yO - yCl));
            return <g key={i}>
              <line x1={x} x2={x} y1={yP(b.high)} y2={yP(b.low)} stroke={col} strokeWidth={1} />
              <rect x={x - bw / 2} y={bodyTop} width={bw} height={bodyH} fill={col} />
            </g>;
          })}

          {/* SMAs */}
          {show.smaFast && line(ind.smaFast, yP, COL.smaFast, 1.4)}
          {show.smaSlow && line(ind.smaSlow, yP, COL.smaSlow, 1.4)}

          {/* signal markers */}
          {signals.map((s, k) => {
            const x = xC(s.i);
            const isBuy = s.type === "buy";
            const y = isBuy ? yP(bars[s.i].low) + 16 : yP(bars[s.i].high) - 16;
            const col = isBuy ? COL.buy : COL.sell;
            const sel = selected && selected.i === s.i && selected.type === s.type;
            return <g key={k} style={{ cursor: "pointer" }} onClick={() => setSelected(s)}>
              <path d={isBuy
                ? `M${x},${y-7} L${x-6},${y+5} L${x+6},${y+5} Z`
                : `M${x},${y+7} L${x-6},${y-5} L${x+6},${y-5} Z`}
                fill={col} stroke={sel ? "#fff" : "none"} strokeWidth={sel ? 1.5 : 0} />
            </g>;
          })}

          {/* crosshair */}
          {hover != null && <>
            <line x1={xC(hover)} x2={xC(hover)} y1={padT} y2={rsiTop + rsiH} stroke={COL.axis} strokeWidth={1} strokeDasharray="3 3" />
          </>}

          {/* volume pane */}
          <text x={padL} y={volTop + 10} fill={COL.text} fontSize={10}>Volume</text>
          {bars.map((b, i) => {
            const up = b.close >= b.open;
            return <rect key={i} x={xC(i) - bw / 2} y={yV(b.volume)} width={bw} height={volTop + volH - yV(b.volume)}
              fill={up ? COL.up + "77" : COL.down + "77"} />;
          })}
          {line(ind.volSma, yV, COL.smaFast, 1)}

          {/* MACD pane */}
          <text x={padL} y={macdTop + 10} fill={COL.text} fontSize={10}>MACD {cfg.macdFast},{cfg.macdSlow},{cfg.macdSig}</text>
          <line x1={padL} x2={padL + plotW} y1={yM(0)} y2={yM(0)} stroke={COL.axis} strokeWidth={1} />
          {bars.map((b, i) => ind.hist[i] == null ? null : (
            <rect key={i} x={xC(i) - bw / 2} y={Math.min(yM(0), yM(ind.hist[i]))}
              width={bw} height={Math.abs(yM(ind.hist[i]) - yM(0))}
              fill={ind.hist[i] >= 0 ? COL.macdHistUp : COL.macdHistDn} />
          ))}
          {line(ind.macd, yM, COL.macdLine, 1.3)}
          {line(ind.signalLine, yM, COL.macdSig, 1.3)}

          {/* RSI pane */}
          <text x={padL} y={rsiTop + 10} fill={COL.text} fontSize={10}>RSI {cfg.rsiLen}</text>
          {rsiTicks.map(t => (
            <g key={t}>
              <line x1={padL} x2={padL + plotW} y1={yR(t)} y2={yR(t)} stroke={COL.grid} strokeWidth={1} strokeDasharray={t===50?"":"2 3"} />
              <text x={padL + plotW + 5} y={yR(t) + 3} fill={COL.text} fontSize={9}>{t}</text>
            </g>
          ))}
          {line(ind.rsi, yR, COL.rsi, 1.3)}
        </svg>

        {/* hover readout */}
        {hover != null && (
          <div style={{ position: "absolute", top: 4, left: 12, background: COL.panel, border: `1px solid ${COL.axis}`,
            borderRadius: 6, padding: "6px 9px", fontSize: 11, pointerEvents: "none", color: COL.textHi, lineHeight: 1.5 }}>
            <div style={{ color: COL.text }}>{bars[hover].date}</div>
            <div>O {bars[hover].open.toFixed(2)}  H {bars[hover].high.toFixed(2)}  L {bars[hover].low.toFixed(2)}  C {bars[hover].close.toFixed(2)}</div>
            <div style={{ color: COL.text }}>Vol {(bars[hover].volume/1e6).toFixed(2)}M
              {ind.rsi[hover]!=null && `  ·  RSI ${ind.rsi[hover].toFixed(0)}`}
              {ind.hist[hover]!=null && `  ·  MACDh ${ind.hist[hover].toFixed(2)}`}</div>
          </div>
        )}
      </div>

      {/* selected signal explanation */}
      <div style={{ marginTop: 12, background: COL.panel, border: `1px solid ${COL.axis}`, borderRadius: 8, padding: "12px 14px", minHeight: 62 }}>
        {selected ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span style={{ background: selected.type === "buy" ? COL.buy : COL.sell, color: "#06121a",
                fontWeight: 600, fontSize: 11, padding: "2px 8px", borderRadius: 5 }}>
                {selected.type.toUpperCase()}
              </span>
              <span style={{ color: COL.textHi, fontSize: 13 }}>{bars[selected.i].date}</span>
              <span style={{ fontSize: 12 }}>close {bars[selected.i].close.toFixed(2)}</span>
            </div>
            <div style={{ fontSize: 12.5, lineHeight: 1.7 }}>
              <span style={{ color: COL.text }}>Fired because:</span>
              <ul style={{ margin: "4px 0 0", paddingLeft: 18, color: COL.textHi }}>
                {selected.reasons.map((r, k) => <li key={k}>{r}</li>)}
              </ul>
            </div>
          </>
        ) : (
          <span style={{ fontSize: 12.5 }}>Click any ▲ buy or ▼ sell marker to see exactly which conditions fired.</span>
        )}
      </div>

      {/* param controls */}
      <details style={{ marginTop: 10 }}>
        <summary style={{ cursor: "pointer", fontSize: 12, color: COL.text }}>Tune signal parameters</summary>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginTop: 10 }}>
          <Slider label="Breakout window" v={cfg.breakoutLen} min={5} max={60} onChange={v => setCfg(c => ({ ...c, breakoutLen: v }))} />
          <Slider label="ATR stop ×" v={cfg.atrMult} min={1} max={6} step={0.5} onChange={v => setCfg(c => ({ ...c, atrMult: v }))} />
          <Slider label="Exit SMA" v={cfg.smaSlow} min={10} max={100} onChange={v => setCfg(c => ({ ...c, smaSlow: v }))} />
          <Slider label="Vol avg window" v={cfg.volLen} min={5} max={50} onChange={v => setCfg(c => ({ ...c, volLen: v }))} />
        </div>
        <div style={{ fontSize: 11, color: COL.text, marginTop: 8, lineHeight: 1.6 }}>
          Data source: adjusted {loadedSymbol} daily OHLCV from the PSX data API. Returns shown are pre-cost; the real cost gate lives in the C5 harness.
        </div>
      </details>
    </div>
  );
}

function Stat({ label, value, note }) {
  return (
    <div>
      <div style={{ color: "#6b7688", fontSize: 11 }}>{label}</div>
      <div style={{ color: "#d6dde8", fontSize: 15, fontWeight: 500 }}>{value}</div>
      {note && <div style={{ color: "#556", fontSize: 10 }}>{note}</div>}
    </div>
  );
}

function Slider({ label, v, min, max, step = 1, onChange }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 4 }}>
        <span>{label}</span><span style={{ color: "#d6dde8" }}>{v}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={v}
        onChange={e => onChange(+e.target.value)} style={{ width: "100%" }} />
    </div>
  );
}
