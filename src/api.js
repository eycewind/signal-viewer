const configuredApiUrl = import.meta.env.VITE_API_URL?.trim();

export const API_BASE_URL = (configuredApiUrl || "http://localhost:8000").replace(/\/+$/, "");

export async function fetchOhlcv(symbol) {
  const response = await fetch(`${API_BASE_URL}/ohlcv/${encodeURIComponent(symbol)}`);
  if (!response.ok) {
    throw new Error(`Data request failed (${response.status})`);
  }
  return response.json();
}
