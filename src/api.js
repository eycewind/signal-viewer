const configuredApiUrl = import.meta.env.VITE_API_URL?.trim();

export const API_BASE_URL = (configuredApiUrl || "http://localhost:8000").replace(/\/+$/, "");
export const DEFAULT_SYMBOL = "OGDC";

async function fetchJson(path, options) {
  const response = await fetch(`${API_BASE_URL}${path}`, options);
  if (!response.ok) {
    throw new Error(`API request failed (${response.status})`);
  }
  return response.json();
}

export async function fetchSymbols(options) {
  const payload = await fetchJson("/symbols", options);
  if (!Array.isArray(payload)) {
    throw new Error("The symbol API returned an invalid response.");
  }

  return [...new Set(
    payload
      .filter(symbol => typeof symbol === "string")
      .map(symbol => symbol.trim().toUpperCase())
      .filter(Boolean)
  )];
}

export function fetchOhlcv(symbol, options) {
  return fetchJson(`/ohlcv/${encodeURIComponent(symbol)}`, options);
}
