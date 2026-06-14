/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ClusterCell {
  price: number;
  bid: number;      // Market selling volume (hitting bid)
  ask: number;      // Market buying volume (hitting ask)
  volume: number;   // Total volume at this level
  isPoc: boolean;   // Point of Control (Highest volume cell in candle)
  isBuyImbalance: boolean;  // Buying pressure is high
  isSellImbalance: boolean; // Selling pressure is high
}

export interface ClusterCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  delta: number;      // Net buying minus selling volume
  pocPrice: number;   // Price level of maximum volume
  cells: ClusterCell[];
  vah: number;        // Value Area High (70% volume cap)
  val: number;        // Value Area Low (70% volume floor)
  tickCount?: number; // Count of aggregated trades inside this candle if in tick mode
}

export interface OrderBookRow {
  price: number;
  amount: number;
  total: number;
  percentage: number; // Relative to max total
}

export interface OrderBook {
  bids: OrderBookRow[];
  asks: OrderBookRow[];
}

export interface LiveTrade {
  id: string;
  timestamp: number;
  price: number;
  amount: number;
  side: "buy" | "sell";
  isWhale: boolean;
}

export interface CryptoPair {
  symbol: string;
  name: string;
  price: number;
  change24h: number;
  volume24h: number;
  delta24h: number;
  priceStep: number;  // Price clustering interval (e.g., $10 for BTC, $1 for ETH)
  compressionSpot?: number;
  compressionFutures?: number;
  minTickStep?: number;
  minTickStepSpot?: number;
  minTickStepFutures?: number;
}

export interface AIAnalysis {
  timestamp: number;
  summary: string;
  sentiment: "bullish" | "bearish" | "neutral";
  details: string;
  support: number;
  resistance: number;
  recommendation: string;
}

export interface IndicatorSettings {
  mode?: string;         // e.g. "Volume" | "Delta" | "Both"
  direction?: string;    // e.g. "Both" | "Buy" | "Sell"
  location?: string;     // e.g. "Any" | "Body" | "Wick"
  sensitivity?: number;  // 1 to 10
  useMinMax?: boolean;   // checkbox
  opacity?: number;      // opacity slider
  showLabels?: boolean;  // toggle text values
  smoothing?: number;    // period logic
  ratio?: number;        // stacked imbalance ratio
  
  // Cluster Search Medium Filter Settings
  csMedEnabled?: boolean;
  csMedMinVolume?: number;
  csMedMaxVolume?: number;
  csMedMinSize?: number;
  csMedMaxSize?: number;
  csMedShape?: "circle" | "square" | "rhombus";
  csMedColorBid?: string;
  csMedColorAsk?: string;
  csMedOpacity?: number;
  csMedTgAlert?: boolean;
  csMedMergeLevels?: number;
  csMedImbalancePercent?: number;
  csMedMinDelta?: number;
  csMedLocation?: "any" | "body" | "lowerWick" | "upperWick";

  // Cluster Search Large Filter Settings
  csLargeEnabled?: boolean;
  csLargeMinVolume?: number;
  csLargeMinSize?: number;
  csLargeMaxSize?: number;
  csLargeShape?: "circle" | "square" | "rhombus";
  csLargeColorBid?: string;
  csLargeColorAsk?: string;
  csLargeOpacity?: number;
  csLargeTgAlert?: boolean;
  csLargeMergeLevels?: number;
  csLargeImbalancePercent?: number;
  csLargeMinDelta?: number;
  csLargeLocation?: "any" | "body" | "lowerWick" | "upperWick";

  // Cluster Search Common Settings
  csMergeLevels?: number;
  csImbalancePercent?: number;

  // Volume on Chart specific settings
  volumeOnChartDeltaThreshold?: number;
  volumeOnChartMaxHeightPercent?: number;
}

export interface Indicator {
  id: string;
  label: string;
  category: "Все индикаторы" | "Избранные" | "Сообщество";
  type: "Оверлей" | "Подвальный" | "Глобальный";
  isFavorite: boolean;
  isActive: boolean;
  isVisible?: boolean;
  settings: IndicatorSettings;
}

export interface ProfileUser {
  name: string;
  email: string;
  avatar: string;
  regDate: string;
  tier: "Free" | "Pro" | "VIP";
}

