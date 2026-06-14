import { CryptoPair, ClusterCandle, OrderBook, LiveTrade } from "../types";

export const EMPTY_PAIRS: CryptoPair[] = [
  {
    symbol: "BTCUSDT",
    name: "Bitcoin",
    price: 0,
    change24h: 0,
    volume24h: 0,
    delta24h: 0,
    priceStep: 2.5
  }
];

export const EMPTY_CANDLES: ClusterCandle[] = [];

export const EMPTY_ORDER_BOOK: OrderBook = { bids: [], asks: [] };

export const EMPTY_TRADES: LiveTrade[] = [];
