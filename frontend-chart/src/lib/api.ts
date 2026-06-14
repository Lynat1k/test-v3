import { ClusterCandle } from "../types";

export interface GetClusterCandlesParams {
  symbol: string;
  interval: string;
  isFutures: boolean;
  priceStep: number;
  compressionTicks?: number;
}

/**
 * Fetch ClusterCandles directly from the backend API.
 * No Binance calls, no client-side aggregation, and no fallbacks.
 */
export async function getClusterCandles(
  paramsOrSymbol: GetClusterCandlesParams | string,
  interval?: string,
  isFutures?: boolean,
  priceStep?: number
): Promise<ClusterCandle[]> {
  let symbol: string;
  let actualInterval: string;
  let actualIsFutures: boolean;
  let actualPriceStep: number;

  if (typeof paramsOrSymbol === "object" && paramsOrSymbol !== null) {
    symbol = paramsOrSymbol.symbol;
    actualInterval = paramsOrSymbol.interval;
    actualIsFutures = paramsOrSymbol.isFutures;
    actualPriceStep = paramsOrSymbol.priceStep;
  } else {
    symbol = paramsOrSymbol as string;
    actualInterval = interval!;
    actualIsFutures = isFutures!;
    actualPriceStep = priceStep!;
  }

  // Read backend base URL from environment variable VITE_API_BASE
  const apiBase = (import.meta as any).env?.VITE_API_BASE || "";
  
  const queryParams = new URLSearchParams({
    symbol,
    interval: actualInterval,
    isFutures: String(actualIsFutures),
    priceStep: String(actualPriceStep)
  });

  const url = `${apiBase}/api/cluster-candles?${queryParams.toString()}`;
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch cluster candles: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data as ClusterCandle[];
}
