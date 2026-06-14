/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { OrderBook as OrderBookType, CryptoPair } from "../types";
import { Layers3, Flame } from "lucide-react";

interface OrderBookProps {
  orderBook: OrderBookType;
  activePair: CryptoPair;
}

export default function OrderBook({ orderBook, activePair }: OrderBookProps) {
  const sumBids = orderBook.bids.reduce((acc, b) => acc + b.amount, 0);
  const sumAsks = orderBook.asks.reduce((acc, a) => acc + a.amount, 0);
  const totalBookVolume = sumBids + sumAsks;
  const bidRatio = totalBookVolume > 0 ? (sumBids / totalBookVolume) * 100 : 50;
  const askRatio = 100 - bidRatio;

  return (
    <div className="liquid-glass-card rounded-2xl p-5 flex flex-col h-full shadow-2xl relative">
      <div className="flex justify-between items-center border-b border-white/5 pb-2.5 mb-3.5">
        <h3 className="text-xs font-bold text-slate-300 font-display flex items-center gap-1.5 uppercase">
          <Layers3 className="w-3.5 h-3.5 text-yellow-500" /> Order Book L2
        </h3>
        <span className="text-[10px] font-mono text-slate-400 font-bold bg-slate-950/60 border border-white/5 px-2.5 py-0.5 rounded-md shadow-inner">
          DEEP SPREAD
        </span>
      </div>

      {/* Liquidity Imbalance Meter */}
      <div className="mb-4">
        <div className="flex justify-between text-[10px] font-mono text-slate-405 font-bold mb-1 uppercase tracking-wider">
          <span className="text-emerald-400">Bids: {bidRatio.toFixed(1)}%</span>
          <span className="text-slate-500">Order Balance</span>
          <span className="text-rose-450">Asks: {askRatio.toFixed(1)}%</span>
        </div>
        <div className="h-1.5 w-full bg-slate-950/60 border border-white/5 rounded-full overflow-hidden flex shadow-inner">
          <div
            className="h-full bg-emerald-500 transition-all duration-300"
            style={{ width: `${bidRatio}%` }}
          />
          <div
            className="h-full bg-rose-500 transition-all duration-300"
            style={{ width: `${askRatio}%` }}
          />
        </div>
      </div>

      {/* Depth Ladder */}
      <div className="flex-1 overflow-y-auto grid grid-cols-2 gap-4 divide-x divide-white/10 pr-1 text-xs">
        
        {/* BUY BIDS COLUMN */}
        <div className="flex flex-col gap-[1.5px]">
          <div className="grid grid-cols-3 text-[10px] font-mono text-slate-500 uppercase tracking-wider font-semibold border-b border-white/5 pb-1 mb-1">
            <span>Price</span>
            <span className="text-right">Size</span>
            <span className="text-right">Total</span>
          </div>

          <div className="flex flex-col gap-[2px]">
            {orderBook.bids.map((row, i) => {
              // Highlight heavy liquidity walls (whale block)
              const isHeavy = row.amount > 15;
              return (
                <div
                  key={`bid-${i}`}
                  className="relative group grid grid-cols-3 py-1 font-mono text-[11px] items-center text-slate-300"
                >
                  {/* Horizontal bar fill mimicking market depth */}
                  <div
                    className="absolute right-0 top-0 bottom-0 bg-emerald-500/10 rounded-l transition-all duration-300"
                    style={{ width: `${row.percentage}%` }}
                  />

                  {/* Price */}
                  <span className={`z-10 font-bold flex items-center gap-1 ${isHeavy ? "text-emerald-400" : "text-emerald-500/90"}`}>
                    {isHeavy && <Flame className="w-2.5 h-2.5 text-yellow-500 fill-yellow-500/10 animate-pulse shrink-0" />}
                    {row.price.toLocaleString(undefined, { minimumFractionDigits: activePair.priceStep < 0.1 ? 3 : 1 })}
                  </span>

                  {/* Size */}
                  <span className={`text-right z-10 transition-all ${isHeavy ? "font-black text-emerald-300 text-xs" : ""}`}>
                    {row.amount.toFixed(isActiveFormat(activePair) ? 3 : 1)}
                  </span>

                  {/* Cumulative size */}
                  <span className="text-right z-10 text-slate-500 text-[10px]">
                    {row.total.toFixed(isActiveFormat(activePair) ? 2 : 1)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* SELL ASKS COLUMN */}
        <div className="flex flex-col gap-[1.5px] pl-4">
          <div className="grid grid-cols-3 text-[10px] font-mono text-slate-500 uppercase tracking-wider font-semibold border-b border-white/5 pb-1 mb-1">
            <span>Price</span>
            <span className="text-right">Size</span>
            <span className="text-right">Total</span>
          </div>

          <div className="flex flex-col gap-[2px]">
            {orderBook.asks.map((row, i) => {
              const isHeavy = row.amount > 15;
              return (
                <div
                  key={`ask-${i}`}
                  className="relative group grid grid-cols-3 py-1 font-mono text-[11px] items-center text-slate-300"
                >
                  {/* Depth fill bar */}
                  <div
                    className="absolute left-0 top-0 bottom-0 bg-rose-500/10 rounded-r transition-all duration-300"
                    style={{ width: `${row.percentage}%` }}
                  />

                  {/* Price */}
                  <span className={`z-10 font-bold flex items-center gap-1 ${isHeavy ? "text-rose-450" : "text-rose-500/90"}`}>
                    {isHeavy && <Flame className="w-2.5 h-2.5 text-yellow-500 fill-yellow-500/10 animate-pulse shrink-0" />}
                    {row.price.toLocaleString(undefined, { minimumFractionDigits: activePair.priceStep < 0.1 ? 3 : 1 })}
                  </span>

                  {/* Size */}
                  <span className={`text-right z-10 transition-all ${isHeavy ? "font-black text-rose-350 text-xs" : ""}`}>
                    {row.amount.toFixed(isActiveFormat(activePair) ? 3 : 1)}
                  </span>

                  {/* Cumulative size */}
                  <span className="text-right z-10 text-slate-500 text-[10px]">
                    {row.total.toFixed(isActiveFormat(activePair) ? 2 : 1)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

      </div>
    </div>
  );
}

// Check formatting rules
function isActiveFormat(pair: CryptoPair) {
  return pair.symbol.includes("SOL") || pair.symbol.includes("BNB") || pair.priceStep < 0.1;
}
