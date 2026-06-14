/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { LiveTrade, CryptoPair } from "../types";
import { History, ShieldAlert, Award, Filter } from "lucide-react";

interface TimeAndSalesProps {
  trades: LiveTrade[];
  activePair: CryptoPair;
}

export default function TimeAndSales({ trades, activePair }: TimeAndSalesProps) {
  // Option to filter out small sizes (retail noise) from trade tape
  const [minSizeFilter, setMinSizeFilter] = useState<number>(0);

  // Separate retail ticks and high-volume whale blocks (> 10 BTC / equivalent)
  const whaleThreshold = activePair.symbol.includes("BTC") ? 2.5 : activePair.symbol.includes("ETH") ? 15.0 : 50.0;
  
  const filteredTrades = trades.filter((t) => t.amount >= minSizeFilter);
  const whaleAlerts = trades.filter((t) => t.amount >= whaleThreshold);

  return (
    <div className="liquid-glass-card rounded-2xl p-5 flex flex-col h-full shadow-2xl relative">
      
      {/* Tab/Filter Selects Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/5 pb-3 mb-3.5">
        <h3 className="text-xs font-bold text-slate-300 font-display flex items-center gap-1.5 uppercase">
          <History className="w-3.5 h-3.5 text-yellow-500" /> Ticking Sales
        </h3>

        {/* Dynamic Filters */}
        <div className="flex items-center gap-2">
          <Filter className="w-3 h-3 text-slate-500" />
          <select
            value={minSizeFilter}
            onChange={(e) => setMinSizeFilter(parseFloat(e.target.value))}
            className="bg-slate-950/60 text-slate-300 border border-white/10 rounded px-2.5 py-1 text-[10px] font-mono leading-none focus:outline-none cursor-pointer backdrop-blur-md hover:border-white/20 transition-all font-semibold"
          >
            <option value="0" className="bg-slate-950">All Trades</option>
            <option value="0.5" className="bg-slate-950">&gt; 0.5 Size</option>
            <option value="2.0" className="bg-slate-950">&gt; 2.0 Size</option>
            <option value="5.0" className="bg-slate-950">&gt; 5.0 Size</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1 overflow-hidden">
        
        {/* RAW LIVE EXECUTION TAPE */}
        <div className="flex flex-col h-full overflow-hidden">
          <div className="grid grid-cols-3 text-[10.5px] font-mono font-bold text-slate-500 uppercase tracking-wider border-b border-slate-900/60 pb-1 mb-1.5">
            <span>Timestamp</span>
            <span className="text-right">Price</span>
            <span className="text-right">Size ({activePair.symbol.split("/")[0]})</span>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-slate-950 pr-0.5 space-y-[2px]">
            {filteredTrades.map((trade) => {
              const isBuy = trade.side === "buy";
              return (
                <div
                  key={trade.id}
                  className={`grid grid-cols-3 py-1 font-mono text-[11px] items-center hover:bg-slate-900/40 rounded px-1 transition duration-150 ${
                    trade.isWhale
                      ? "bg-yellow-500/5 text-yellow-500 font-bold border-l-2 border-yellow-500"
                      : "text-slate-300"
                  }`}
                >
                  {/* Timestamp with milliseconds */}
                  <span className="text-[10px] text-slate-500">
                    {new Date(trade.timestamp).toLocaleTimeString(undefined, {
                      hour12: false,
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                    <span className="opacity-45 text-[9px]">
                      .{(trade.timestamp % 1000).toString().padStart(3, "0")}
                    </span>
                  </span>

                  {/* Price */}
                  <span className={`text-right font-semibold ${isBuy ? "text-emerald-400" : "text-rose-400"}`}>
                    ${trade.price.toLocaleString(undefined, { minimumFractionDigits: activePair.priceStep < 0.1 ? 3 : 1 })}
                  </span>

                  {/* Size */}
                  <span className={`text-right font-medium ${isBuy ? "text-emerald-400/80" : "text-rose-400/80"}`}>
                    {trade.amount.toFixed(4)}
                  </span>
                </div>
              );
            })}
            
            {filteredTrades.length === 0 && (
              <div className="text-center text-slate-600 font-mono text-[11px] py-10">
                Awaiting market transactions...
              </div>
            )}
          </div>
        </div>

        {/* INSTITUTIONAL WHALE ORDER BLOCKS */}
        <div className="flex flex-col h-full overflow-hidden border-t md:border-t-0 md:border-l border-white/5 pt-4 md:pt-0 md:pl-4">
          <div className="flex items-center gap-1.5 border-b border-white/5 pb-1 mb-1.5 bg-transparent">
            <ShieldAlert className="w-3.5 h-3.5 text-yellow-500" />
            <span className="text-[10.5px] font-mono font-bold text-slate-400 uppercase tracking-wider">
              Whale Block Trade Alerts ({whaleThreshold}+ size)
            </span>
          </div>

          <div className="flex-1 overflow-y-auto space-y-2 pr-0.5">
            {whaleAlerts.map((alert) => {
              const isBuy = alert.side === "buy";
              const equivalentValue = alert.amount * alert.price;
              return (
                <div
                  key={`alert-${alert.id}`}
                  className="bg-slate-950/40 border border-yellow-500/20 p-2.5 rounded-lg flex flex-col gap-1 shadow-lg hover:border-yellow-500/45 hover:bg-slate-900/40 transition-all"
                >
                  <div className="flex justify-between items-center">
                    <span className="bg-yellow-500/10 text-yellow-500 border border-yellow-500/40 text-[9px] font-black tracking-widest px-1.5 py-0.5 rounded flex items-center gap-1 uppercase leading-none">
                      <Award className="w-2.5 h-2.5" /> INSTITUTIONAL BLOCK
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono">
                      {new Date(alert.timestamp).toLocaleTimeString()}
                    </span>
                  </div>

                  <div className="flex justify-between items-baseline mt-1">
                    <span className="text-xs text-slate-300 font-medium font-mono">
                      {isBuy ? "Aggressive Buying Block" : "Aggressive Selling Absorption"}
                    </span>
                    <span className={`text-base font-black font-mono tracking-tight ${isBuy ? "text-emerald-400" : "text-rose-450"}`}>
                      {alert.amount.toFixed(1)} {activePair.symbol.split("/")[0]}
                    </span>
                  </div>

                  <div className="flex justify-between text-[11px] font-mono text-slate-500 pt-1 border-t border-slate-800/40">
                    <span>Fill Rate: ${alert.price.toLocaleString()}</span>
                    <span className="text-yellow-500 font-semibold">
                      Value: ${equivalentValue.toLocaleString(undefined, { maximumFractionDigits: 0 })} USDT
                    </span>
                  </div>
                </div>
              );
            })}

            {whaleAlerts.length === 0 && (
              <div className="flex flex-col items-center justify-center text-slate-600 font-mono text-[11px] h-full py-10 opacity-60">
                <ShieldAlert className="w-8 h-8 text-slate-700 mb-1.5" />
                No large block transactions detected yet on this ticker scan.
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
