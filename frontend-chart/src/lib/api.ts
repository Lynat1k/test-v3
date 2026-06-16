import { ClusterCandle } from "../types";

export interface GetClusterCandlesParams {
  symbol: string;
  market: string;
  tf: string;
  compression: number;
  before?: number;
  limit?: number;
}

export interface CandlesResponse {
  candles: ClusterCandle[];
  historyLimited: boolean;
}

interface BackendCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  delta: number;
  cells: Array<{
    price: number;
    bid: number;
    ask: number;
    volume: number;
    isPoc: boolean;
    isBuyImbalance: boolean;
    isSellImbalance: boolean;
  }>;
}

function mapBackendCandle(bc: BackendCandle): ClusterCandle {
  let pocPrice = bc.open;
  let maxVol = 0;
  let vah = bc.high;
  let val = bc.low;

  for (const cell of bc.cells) {
    if (cell.volume > maxVol) {
      maxVol = cell.volume;
      pocPrice = cell.price;
    }
  }

  const sortedByVol = [...bc.cells].sort((a, b) => b.volume - a.volume);
  const targetVol = bc.volume * 0.7;
  let runningVol = 0;
  const vaPrices: number[] = [];
  for (const c of sortedByVol) {
    runningVol += c.volume;
    vaPrices.push(c.price);
    if (runningVol >= targetVol) break;
  }
  if (vaPrices.length > 0) {
    val = Math.min(...vaPrices);
    vah = Math.max(...vaPrices);
  }

  return {
    timestamp: bc.time * 1000,
    open: bc.open,
    high: bc.high,
    low: bc.low,
    close: bc.close,
    volume: bc.volume,
    delta: bc.delta,
    pocPrice,
    cells: bc.cells.map(c => ({
      price: c.price,
      bid: c.bid,
      ask: c.ask,
      volume: c.volume,
      isPoc: c.isPoc,
      isBuyImbalance: c.isBuyImbalance,
      isSellImbalance: c.isSellImbalance,
    })),
    vah,
    val,
  };
}

export async function getClusterCandles(
  params: GetClusterCandlesParams
): Promise<CandlesResponse> {
  const queryParams = new URLSearchParams({
    symbol: params.symbol,
    market: params.market,
    tf: params.tf,
    compression: String(params.compression),
  });

  if (params.before) {
    queryParams.set("before", String(params.before));
  }
  if (params.limit) {
    queryParams.set("limit", String(params.limit));
  }

  const url = `/api/candles?${queryParams.toString()}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch candles: ${response.status} ${response.statusText}`);
  }

  const json = await response.json();
  if (!json.ok) {
    throw new Error(json.error?.message || "API error");
  }

  const data = json.data;
  return {
    candles: (data.candles || []).map(mapBackendCandle),
    historyLimited: !!data.history_limited,
  };
}
