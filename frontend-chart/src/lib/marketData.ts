/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ClusterCandle, ClusterCell, OrderBookRow } from "../types";

/**
 * Highly granular ticking real-time flow aggregator using Binance aggTrades.
 * Rebuilds footprints & imbalances manually client-side from 1000s of raw ticks.
 */
export async function fetchBinanceTicksAndAggregate(
  symbol: string,
  isFutures: boolean,
  priceStep: number,
  compressionTicks: number = 50
): Promise<ClusterCandle[]> {
  try {
    const binanceSymbol = symbol.toUpperCase().replace("/", "");
    const res = await fetch(`/api/binance-vision-ticks?symbol=${binanceSymbol}&priceStep=${priceStep}&compression=${compressionTicks}&isFutures=${isFutures}`);
    if (res.ok) {
      const data = await res.json();
      if (data.status === "ok" && Array.isArray(data.candles) && data.candles.length > 0) {
        console.log(`[PROCLUSTER Vision Client] Successfully loaded ${data.candles.length} real 24h aggregated tick candles from server.`);
        return data.candles;
      }
    }
  } catch (err) {
    console.warn("[PROCLUSTER Vision Client] Server API fetch failed, falling back to direct public REST API:", err);
  }

  const binanceSymbol = symbol.toUpperCase().replace("/", "");
  const baseUrl = isFutures ? "https://fapi.binance.com" : "https://api.binance.com";
  
  // Fetch initial batch
  const limit = 1000;
  const initialUrl = isFutures
    ? `${baseUrl}/fapi/v1/aggTrades?symbol=${binanceSymbol}&limit=${limit}`
    : `${baseUrl}/api/v3/aggTrades?symbol=${binanceSymbol}&limit=${limit}`;

  const res = await fetch(initialUrl);
  if (!res.ok) {
    throw new Error(`Binance API response status: ${res.status}`);
  }
  const latestTrades = await res.json();
  if (!Array.isArray(latestTrades) || latestTrades.length === 0) {
    return [];
  }

  let allTrades = [...latestTrades];
  const firstId = latestTrades[0].a;

  // Fetch older trade blocks to get a continuous chain of trades / ticks
  const pages = 3;
  const fetchPromises: Promise<any[]>[] = [];

  for (let i = 1; i <= pages; i++) {
    const targetFromId = Math.max(1, firstId - i * 1000);
    const pageUrl = isFutures
      ? `${baseUrl}/fapi/v1/aggTrades?symbol=${binanceSymbol}&limit=1000&fromId=${targetFromId}`
      : `${baseUrl}/api/v3/aggTrades?symbol=${binanceSymbol}&limit=1000&fromId=${targetFromId}`;

    fetchPromises.push(
      fetch(pageUrl)
        .then(async (r) => {
          if (!r.ok) return [];
          const data = await r.json();
          return Array.isArray(data) ? data : [];
        })
        .catch(() => [])
    );
  }

  const results = await Promise.all(fetchPromises);
  results.forEach(batch => {
    allTrades = [...allTrades, ...batch];
  });

  // Sort chronologically by trade agg ID
  allTrades.sort((a, b) => a.a - b.a);

  // Split into chunks of exactly 50 ticks and aggregate volumes
  const candles: ClusterCandle[] = [];
  
  for (let i = 0; i < allTrades.length; i += compressionTicks) {
    const chunk = allTrades.slice(i, i + compressionTicks);
    if (chunk.length < 5) continue; // Skip trailing fragments

    const prices = chunk.map(t => parseFloat(t.p));
    const open = prices[0];
    const close = prices[prices.length - 1];
    const high = Math.max(...prices);
    const low = Math.min(...prices);
    const timestamp = chunk[chunk.length - 1].T;

    const totalVolume = chunk.reduce((sum, t) => sum + parseFloat(t.q), 0);
    const cellMap: { [price: number]: { bid: number; ask: number; volume: number } } = {};

    chunk.forEach(t => {
      const pVal = parseFloat(t.p);
      const stepPrice = Math.floor(pVal / priceStep) * priceStep;
      const roundedPrice = parseFloat(stepPrice.toFixed(4));

      if (!cellMap[roundedPrice]) {
        cellMap[roundedPrice] = { bid: 0, ask: 0, volume: 0 };
      }

      const qty = parseFloat(t.q);
      // t.m represents buy/sell side logic (isBuyerMaker)
      if (t.m) {
        cellMap[roundedPrice].bid += qty;
      } else {
        cellMap[roundedPrice].ask += qty;
      }
      cellMap[roundedPrice].volume += qty;
    });

    const cells: ClusterCell[] = [];
    let maxCellVol = 0;
    let pocPrice = (open + close) / 2;

    Object.keys(cellMap).forEach(pStr => {
      const pNum = parseFloat(pStr);
      const data = cellMap[pNum];

      cells.push({
        price: pNum,
        bid: parseFloat(data.bid.toFixed(4)),
        ask: parseFloat(data.ask.toFixed(4)),
        volume: parseFloat(data.volume.toFixed(4)),
        isPoc: false,
        isBuyImbalance: false,
        isSellImbalance: false
      });
    });

    cells.forEach(c => {
      if (c.volume > maxCellVol) {
        maxCellVol = c.volume;
        pocPrice = c.price;
      }
    });

    cells.forEach(c => {
      if (c.price === pocPrice) {
        c.isPoc = true;
      }
      c.isBuyImbalance = c.ask > c.bid * 1.8 && c.volume > (totalVolume / cells.length) * 0.4;
      c.isSellImbalance = c.bid > c.ask * 1.8 && c.volume > (totalVolume / cells.length) * 0.4;
    });

    cells.sort((a, b) => b.price - a.price);

    const sortedByVol = [...cells].sort((a, b) => b.volume - a.volume);
    const targetVol = totalVolume * 0.7;
    let runningSum = 0;
    const vaPrices: number[] = [];
    for (const itemC of sortedByVol) {
      runningSum += itemC.volume;
      vaPrices.push(itemC.price);
      if (runningSum >= targetVol) break;
    }

    const val = vaPrices.length > 0 ? Math.min(...vaPrices) : low;
    const vah = vaPrices.length > 0 ? Math.max(...vaPrices) : high;

    const totalBid = cells.reduce((sum, c) => sum + c.bid, 0);
    const totalAsk = cells.reduce((sum, c) => sum + c.ask, 0);

    candles.push({
      timestamp,
      open: parseFloat(open.toFixed(4)),
      high: parseFloat(high.toFixed(4)),
      low: parseFloat(low.toFixed(4)),
      close: parseFloat(close.toFixed(4)),
      volume: parseFloat(totalVolume.toFixed(4)),
      delta: parseFloat((totalAsk - totalBid).toFixed(4)),
      pocPrice: parseFloat(pocPrice.toFixed(4)),
      cells,
      vah: parseFloat(vah.toFixed(4)),
      val: parseFloat(val.toFixed(4)),
      tickCount: chunk.length
    });
  }

  return candles;
}

/**
 * Fetches standard historical klines / candlesticks from Binance and extends
 * them with a synthetic mathematical clustering distribution.
 */
export async function fetchBinanceKlines(
  symbol: string,
  interval: string,
  isFutures: boolean,
  priceStep: number
): Promise<ClusterCandle[]> {
  const binanceSymbol = symbol.toUpperCase().replace("/", "");
  
  // Try server proxy first to bypass browser CORS in iframe previews
  try {
    const proxyUrl = `/api/binance-klines?symbol=${binanceSymbol}&interval=${interval}&isFutures=${isFutures}&priceStep=${priceStep}`;
    const proxyRes = await fetch(proxyUrl);
    if (proxyRes.ok) {
      const resultObj = await proxyRes.json();
      if (resultObj.status === "ok" && Array.isArray(resultObj.candles) && resultObj.candles.length > 0) {
        console.log(`[PROCLUSTER REST] Successfully fetched ${resultObj.candles.length} klines via server-side proxy.`);
        return resultObj.candles;
      }
    }
  } catch (proxyErr) {
    console.warn("[PROCLUSTER Client] Server proxy kline fetch failed, attempting direct public API fallback:", proxyErr);
  }

  const endpoint = isFutures
    ? `https://fapi.binance.com/fapi/v1/klines?symbol=${binanceSymbol}&interval=${interval}&limit=1000`
    : `https://api.binance.com/api/v3/klines?symbol=${binanceSymbol}&interval=${interval}&limit=1000`;

  try {
    const res = await fetch(endpoint);
    if (!res.ok) {
      throw new Error(`STATUS ${res.status}`);
    }
    const data = await res.json();
    if (!Array.isArray(data)) {
      throw new Error("Invalid format from Binance");
    }

    const candles: ClusterCandle[] = data.map((item: any) => {
      const timestamp = Number(item[0]);
      const open = parseFloat(item[1]);
      const high = parseFloat(item[2]);
      const low = parseFloat(item[3]);
      const close = parseFloat(item[4]);
      const volume = parseFloat(item[5]);
      // Taker buy base asset volume is element 9 in the kline array
      const takerBuyVol = parseFloat(item[9]);
      const takerSellVol = Math.max(0, volume - takerBuyVol);

      // Create cells based on high/low and priceStep
      const cells: ClusterCell[] = [];
      const startPrice = Math.floor(low / priceStep) * priceStep;
      const endPrice = Math.ceil(high / priceStep) * priceStep;

      // Centered Gaussian approximation to distribute volumes across price levels
      const centerPrice = (open + close) / 2;
      const maxPriceDistance = Math.max(endPrice - startPrice, priceStep);

      const tempCells: { price: number; bid: number; ask: number; volume: number }[] = [];
      let maxCellVol = 0;
      let pocIndex = -1;

      // Safe guard against cell count exploding on bad precision parameters
      let activePriceStep = priceStep;
      let rangeUnits = Math.round((endPrice - startPrice) / activePriceStep);
      if (rangeUnits > 250) {
        const scaleFactor = Math.ceil(rangeUnits / 250);
        activePriceStep = priceStep * scaleFactor;
      }

      let cellCount = 0;
      for (let price = startPrice; price <= endPrice; price += activePriceStep) {
        cellCount++;
        if (cellCount > 250) break;
      }

      let currentPriceLevel = startPrice;
      const parsedLevels: number[] = [];
      for (let i = 0; i < cellCount; i++) {
        parsedLevels.push(parseFloat(currentPriceLevel.toFixed(4)));
        currentPriceLevel += activePriceStep;
      }

      const weights = parsedLevels.map(p => {
        const dist = Math.abs(p - centerPrice);
        return Math.max(0.01, Math.exp(-Math.pow(dist / (maxPriceDistance * 0.45), 2)));
      });
      const sumWeights = weights.reduce((s, w) => s + w, 0) || 1;

      parsedLevels.forEach((priceLevel, idx) => {
        const weight = weights[idx] / sumWeights;
        const levelVol = volume * weight;
        const takerRatio = volume > 0 ? takerBuyVol / volume : 0.5;
        const ask = levelVol * takerRatio;
        const bid = levelVol * (1 - takerRatio);

        tempCells.push({
          price: priceLevel,
          bid,
          ask,
          volume: levelVol
        });
      });

      // Locate Point of Control (POC) index
      tempCells.forEach((c, idx) => {
        if (c.volume > maxCellVol) {
          maxCellVol = c.volume;
          pocIndex = idx;
        }
      });

      const finalCells: ClusterCell[] = tempCells.map((c, idx) => {
        const isPoc = idx === pocIndex;
        // Standard high ratio diagonal/direct cell imbalances
        const isBuyImbalance = c.ask > c.bid * 1.8 && c.volume > (volume / tempCells.length) * 0.4;
        const isSellImbalance = c.bid > c.ask * 1.8 && c.volume > (volume / tempCells.length) * 0.4;

        return {
          price: c.price,
          bid: parseFloat(c.bid.toFixed(4)),
          ask: parseFloat(c.ask.toFixed(4)),
          volume: parseFloat(c.volume.toFixed(4)),
          isPoc,
          isBuyImbalance,
          isSellImbalance
        };
      });

      const sortedCells = finalCells.sort((a, b) => b.price - a.price);
      const pocCell = sortedCells.find(c => c.isPoc);

      // Estimate Value Area (vah, val) and return candle
      const sortedByVol = [...sortedCells].sort((a, b) => b.volume - a.volume);
      const targetVolSurround = volume * 0.7;
      let runningSum = 0;
      const vahValPrices: number[] = [];
      for (const itemC of sortedByVol) {
        runningSum += itemC.volume;
        vahValPrices.push(itemC.price);
        if (runningSum >= targetVolSurround) break;
      }

      return {
        timestamp,
        open: parseFloat(open.toFixed(4)),
        high: parseFloat(high.toFixed(4)),
        low: parseFloat(low.toFixed(4)),
        close: parseFloat(close.toFixed(4)),
        volume: parseFloat(volume.toFixed(4)),
        delta: parseFloat((takerBuyVol - takerSellVol).toFixed(4)),
        pocPrice: pocCell ? pocCell.price : parseFloat(((open + close) / 2).toFixed(4)),
        cells: sortedCells,
        vah: vahValPrices.length > 0 ? parseFloat(Math.max(...vahValPrices).toFixed(4)) : parseFloat(high.toFixed(4)),
        val: vahValPrices.length > 0 ? parseFloat(Math.min(...vahValPrices).toFixed(4)) : parseFloat(low.toFixed(4))
      };
    });

    return candles;
  } catch (err) {
    console.error("[Binance REST] Fetching historical klines failed! Falling back to simulation.", err);
    throw err;
  }
}

/**
 * Fetches order book depth from Binance.
 */
export async function fetchBinanceDepth(
  symbol: string,
  isFutures: boolean,
  priceStep: number
): Promise<{ bids: OrderBookRow[]; asks: OrderBookRow[] } | null> {
  const binanceSymbol = symbol.toUpperCase().replace("/", "");
  const endpoint = isFutures
    ? `https://fapi.binance.com/fapi/v1/depth?symbol=${binanceSymbol}&limit=1000`
    : `https://api.binance.com/api/v3/depth?symbol=${binanceSymbol}&limit=1000`;

  try {
    const res = await fetch(endpoint);
    if (!res.ok) throw new Error(`depth status ${res.status}`);
    const data = await res.json();
    if (!data || !Array.isArray(data.bids) || !Array.isArray(data.asks)) {
      throw new Error("Invalid raw depth");
    }

    // Since Binance depth has narrow micro-price ticks, bucket them into 25-tick priceStep
    const aggBids: Record<number, number> = {};
    const aggAsks: Record<number, number> = {};

    data.bids.forEach((item: any) => {
      const p = parseFloat(item[0]);
      const q = parseFloat(item[1]);
      const bucketPrice = parseFloat((Math.floor(p / priceStep) * priceStep).toFixed(4));
      aggBids[bucketPrice] = (aggBids[bucketPrice] || 0) + q;
    });

    data.asks.forEach((item: any) => {
      const p = parseFloat(item[0]);
      const q = parseFloat(item[1]);
      const bucketPrice = parseFloat((Math.ceil(p / priceStep) * priceStep).toFixed(4));
      aggAsks[bucketPrice] = (aggAsks[bucketPrice] || 0) + q;
    });

    const bidsArr: OrderBookRow[] = [];
    let cumulativeBid = 0;
    Object.keys(aggBids)
      .map(Number)
      .sort((a, b) => b - a)
      .slice(0, 250)
      .forEach((price) => {
        const amount = aggBids[price];
        cumulativeBid += amount;
        bidsArr.push({
          price,
          amount,
          total: cumulativeBid,
          percentage: 0
        });
      });

    const asksArr: OrderBookRow[] = [];
    let cumulativeAsk = 0;
    Object.keys(aggAsks)
      .map(Number)
      .sort((a, b) => a - b)
      .slice(0, 250)
      .forEach((price) => {
        const amount = aggAsks[price];
        cumulativeAsk += amount;
        asksArr.push({
          price,
          amount,
          total: cumulativeAsk,
          percentage: 0
        });
      });

    const maxTotal = Math.max(
      bidsArr.length > 0 ? bidsArr[bidsArr.length - 1].total : 1,
      asksArr.length > 0 ? asksArr[asksArr.length - 1].total : 1
    );

    bidsArr.forEach(b => b.percentage = (b.total / maxTotal) * 100);
    asksArr.forEach(a => a.percentage = (a.total / maxTotal) * 100);

    return { bids: bidsArr, asks: asksArr };
  } catch (err) {
    console.error("[Binance Depth] Failed to fetch. Falling back.", err);
    return null;
  }
}

export interface GetClusterCandlesParams {
  symbol: string;
  interval: string;
  isFutures: boolean;
  priceStep: number;
  compressionTicks?: number;
}

/**
 * Only data entry point exposing candle/cluster aggregation logic.
 */
export async function getClusterCandles({
  symbol,
  interval,
  isFutures,
  priceStep,
  compressionTicks = 50
}: GetClusterCandlesParams): Promise<ClusterCandle[]> {
  if (interval === "50t") {
    return fetchBinanceTicksAndAggregate(symbol, isFutures, priceStep, compressionTicks);
  } else {
    return fetchBinanceKlines(symbol, interval, isFutures, priceStep);
  }
}
