/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from "react";
import { CryptoPair } from "../types";
import { TrendingUp, TrendingDown, DollarSign } from "lucide-react";

interface SidebarPairsProps {
  pairs: CryptoPair[];
  activePair: CryptoPair;
  onPairChange: (pair: CryptoPair) => void;
}

export default function SidebarPairs({
  pairs,
  activePair,
  onPairChange,
}: SidebarPairsProps) {
  const [previousPrices, setPreviousPrices] = useState<Record<string, number>>({});
  const [flashStates, setFlashStates] = useState<Record<string, "up" | "down" | null>>({});

  // Detect price changes to trigger aesthetic flashing
  useEffect(() => {
    const newFlashes: Record<string, "up" | "down" | null> = {};
    let hasChanged = false;

    pairs.forEach((pair) => {
      const prevPrice = previousPrices[pair.symbol];
      if (prevPrice !== undefined && prevPrice !== pair.price) {
        newFlashes[pair.symbol] = pair.price > prevPrice ? "up" : "down";
        hasChanged = true;
      }
    });

    if (hasChanged) {
      setFlashStates((prev) => ({ ...prev, ...newFlashes }));
      
      // Store current prices as previous for next cycle
      const currentPrices = pairs.reduce((acc, p) => ({ ...acc, [p.symbol]: p.price }), {});
      setPreviousPrices(currentPrices);

      // Clear flashes after 600ms
      const timer = setTimeout(() => {
        setFlashStates({});
      }, 5000); // leave longer or let it decay
      return () => clearTimeout(timer);
    } else {
      // First run initialize prices
      const currentPrices = pairs.reduce((acc, p) => ({ ...acc, [p.symbol]: p.price }), {});
      setPreviousPrices(currentPrices);
    }
  }, [pairs, previousPrices]);

  // Format shorthand volumes
  const formatVolume = (vol: number) => {
    if (vol >= 1_000_000_000) return `${(vol / 1_000_000_000).toFixed(2)}B`;
    if (vol >= 1_000_000) return `${(vol / 1_000_000).toFixed(1)}M`;
    return volsFormatted(vol);
  };

  const volsFormatted = (num: number) => {
    return num.toLocaleString();
  };

  return (
    <div className="bg-slate-950/20 backdrop-blur-md border-r border-white/5 w-full lg:w-80 flex flex-col shrink-0 relative z-20">
      <div className="p-4 border-b border-white/5 flex justify-between items-center bg-slate-950/30">
        <h2 className="text-sm font-semibold text-slate-300 font-display flex items-center gap-2">
          <DollarSign className="w-4 h-4 text-yellow-500" /> Market Scanner
        </h2>
        <span className="text-[10px] font-mono bg-slate-950 text-slate-400 px-2 py-0.5 rounded uppercase font-bold border border-white/5 shadow-inner">
          Active Pairs
        </span>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-white/5">
        {pairs.map((pair) => {
          const isActive = pair.symbol === activePair.symbol;
          const isUp = pair.change24h >= 0;
          const flash = flashStates[pair.symbol];

          // Determine flashing borders/background colors
          let flashClass = "border-transparent";
          if (flash === "up") flashClass = "bg-emerald-950/20 border-emerald-500/35 border-l-4";
          if (flash === "down") flashClass = "bg-rose-950/20 border-rose-500/35 border-l-4";

          return (
            <button
              id={`pair-btn-${pair.symbol.replace("/", "-")}`}
              key={pair.symbol}
              onClick={() => onPairChange(pair)}
              className={`w-full text-left p-4 transition-all duration-300 border-l-4 hover:bg-slate-900/30 flex flex-col gap-2 ${
                isActive
                  ? "liquid-glass-active border-yellow-500"
                  : `border-transparent ${flashClass}`
              }`}
            >
              {/* Token Name and Symbol Row */}
              <div className="flex items-center justify-between">
                <span className="font-bold text-sm tracking-wide text-slate-200 font-mono">
                  {pair.symbol}
                </span>
                <span
                  className={`text-xs font-mono font-bold px-2 py-0.5 rounded flex items-center gap-1 ${
                    isUp
                      ? "text-emerald-400 bg-emerald-950/30"
                      : "text-rose-400 bg-rose-950/30"
                  }`}
                >
                  {isUp ? (
                    <TrendingUp className="w-3 h-3 text-emerald-400" />
                  ) : (
                    <TrendingDown className="w-3 h-3 text-rose-400" />
                  )}
                  {isUp ? "+" : ""}
                  {pair.change24h}%
                </span>
              </div>

              {/* Price Row (With micro live flashing text trigger) */}
              <div className="flex justify-between items-baseline mt-1">
                <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">
                  Price
                </span>
                <span
                  className={`text-base font-black font-mono tracking-tight transition-colors duration-300 ${
                    flash === "up"
                      ? "text-emerald-400 font-extrabold"
                      : flash === "down"
                      ? "text-rose-400 font-extrabold"
                      : isActive
                      ? "text-yellow-500"
                      : "text-slate-100"
                  }`}
                >
                  ${pair.price.toLocaleString(undefined, { minimumFractionDigits: pair.priceStep < 0.1 ? 4 : 2 })}
                </span>
              </div>

              {/* Profile statistics footer */}
              <div className="flex justify-between text-[11px] font-mono text-slate-500 border-t border-slate-900/40 pt-1.5 mt-0.5">
                <div>
                  <span className="text-[9px] uppercase tracking-wider text-slate-500 block">
                    Vol 24h
                  </span>
                  <span className="text-slate-400 font-semibold text-[10.5px]">
                    {formatVolume(pair.volume24h)}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-[9px] uppercase tracking-wider text-slate-500 block">
                    Daily Delta
                  </span>
                  <span
                    className={`font-semibold text-[10.5px] ${
                      pair.delta24h >= 0 ? "text-emerald-400" : "text-rose-400"
                    }`}
                  >
                    {pair.delta24h >= 0 ? "+" : ""}
                    {(pair.delta24h / 1000).toFixed(1)}M
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
