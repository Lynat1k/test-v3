/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import { OrderBook as OrderBookType, CryptoPair } from "../types";
import { storage } from "../lib/storage";
import { 
  Wallet, 
  ArrowUpRight, 
  ArrowDownRight, 
  Trash2, 
  Zap, 
  ShieldAlert, 
  Plus, 
  Minus,
  CheckCircle,
  XCircle,
  TrendingUp,
  TrendingDown
} from "lucide-react";

interface DOMSidebarProps {
  orderBook: OrderBookType;
  activePair: CryptoPair;
  theme?: "dark" | "light";
}

interface LimitOrder {
  id: string;
  price: number;
  size: number;
  side: "buy" | "sell";
  symbol: string;
}

interface TradeLog {
  id: string;
  timestamp: number;
  message: string;
  type: "info" | "buy" | "sell" | "cancel";
}

export default function DOMSidebar({ orderBook, activePair, theme = "dark" }: DOMSidebarProps) {
  const isLight = theme === "light";
  
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const lastInteractionTimeRef = useRef<number>(Date.now());
  const isAutoCenteringRef = useRef<boolean>(false);

  // Center scroll vertically on mount or pair/book length changes
  useEffect(() => {
    if (scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const asksCount = Math.min(200, orderBook.asks.length);
      const midElementCenter = (asksCount * 18) + 22;
      const midPoint = midElementCenter - (container.clientHeight / 2);
      container.scrollTop = midPoint;
      lastInteractionTimeRef.current = Date.now();
    }
  }, [activePair.symbol, orderBook.bids.length, orderBook.asks.length]);

  // Track interaction and auto-center after 1 second of inactivity
  useEffect(() => {
    const handleScroll = () => {
      if (isAutoCenteringRef.current) {
        // Scroll event from auto-centering, ignore it
        return;
      }
      lastInteractionTimeRef.current = Date.now();
    };

    const handleMouseMove = () => {
      lastInteractionTimeRef.current = Date.now();
    };

    const container = scrollContainerRef.current;
    if (container) {
      container.addEventListener("scroll", handleScroll, { passive: true });
      container.addEventListener("mousemove", handleMouseMove, { passive: true });
    }

    const interval = setInterval(() => {
      const now = Date.now();
      if (now - lastInteractionTimeRef.current >= 1000) {
        if (scrollContainerRef.current) {
          const cont = scrollContainerRef.current;
          const asksCount = Math.min(200, orderBook.asks.length);
          const midElementCenter = (asksCount * 18) + 22;
          const midPoint = midElementCenter - (cont.clientHeight / 2);
          if (Math.abs(cont.scrollTop - midPoint) > 5) {
            isAutoCenteringRef.current = true;
            cont.scrollTo({ top: midPoint, behavior: "smooth" });
            // Reset the flag after smooth scroll is complete
            setTimeout(() => {
              isAutoCenteringRef.current = false;
            }, 600);
          }
        }
      }
    }, 200);

    return () => {
      if (container) {
        container.removeEventListener("scroll", handleScroll);
        container.removeEventListener("mousemove", handleMouseMove);
      }
      clearInterval(interval);
    };
  }, [activePair.symbol, orderBook.asks.length]);

  // --- Persistent Simulator State ---
  const [balance, setBalance] = useState<number>(() => {
    const saved = storage.get("procluster_balance_v2");
    return saved ? parseFloat(saved) : 100000;
  });

  const [position, setPosition] = useState<number>(() => {
    const saved = storage.get("procluster_position_v2");
    return saved ? parseFloat(saved) : 0;
  });

  const [entryPrice, setEntryPrice] = useState<number>(() => {
    const saved = storage.get("procluster_entry_price_v2");
    return saved ? parseFloat(saved) : 0;
  });

  const [limitOrders, setLimitOrders] = useState<LimitOrder[]>(() => {
    return storage.getJson<LimitOrder[]>("procluster_limit_orders_v2", []);
  });

  const [tradeLogs, setTradeLogs] = useState<TradeLog[]>([]);

  // Input state for user order parameters
  const [orderSizeInput, setOrderSizeInput] = useState<string>("0.5");
  const [limitPriceInput, setLimitPriceInput] = useState<string>("");

  // Persist simulator variables to localStorage when changes occur
  useEffect(() => {
    storage.set("procluster_balance_v2", balance.toString());
  }, [balance]);

  useEffect(() => {
    storage.set("procluster_position_v2", position.toString());
  }, [position]);

  useEffect(() => {
    storage.set("procluster_entry_price_v2", entryPrice.toString());
  }, [entryPrice]);

  useEffect(() => {
    storage.setJson("procluster_limit_orders_v2", limitOrders);
  }, [limitOrders]);

  // Set default limit price input to active pair price if blank
  useEffect(() => {
    if (!limitPriceInput) {
      setLimitPriceInput(activePair.price.toFixed(2));
    }
  }, [activePair.symbol]);

  // Ref to track last ticking price to detect tick-crossing/touching limit orders
  const prevPriceRef = useRef<number>(activePair.price);

  // --- Crypto Fear and Greed Index (stub until real API) ---
  const [fearGreedValue] = useState<number>(50);

  // Helper sentiment selectors
  const getSentimentLabel = (val: number) => {
    if (val <= 25) return "Extreme Fear 😨";
    if (val <= 45) return "Fear 😧";
    if (val <= 54) return "Neutral 😐";
    if (val <= 75) return "Greed 🤑";
    return "Extreme Greed 🚀";
  };

  const getSentimentColor = (val: number) => {
    if (val <= 25) return "#f43f5e"; // rose-500
    if (val <= 45) return "#f97316"; // orange-500
    if (val <= 54) return "#eab308"; // yellow-500
    if (val <= 75) return "#10b981"; // emerald-500
    return "#22d3ee"; // cyan-400
  };

  const getSentimentTextColor = (val: number) => {
    if (val <= 25) return "text-rose-500 font-extrabold";
    if (val <= 45) return "text-orange-500 font-extrabold";
    if (val <= 54) return "text-amber-500 font-extrabold";
    if (val <= 75) return "text-emerald-500 font-extrabold";
    return "text-cyan-500 font-extrabold";
  };

  // --- Real-time Order Matching Engine ---
  useEffect(() => {
    const currentPrice = activePair.price;
    const prevPrice = prevPriceRef.current;

    if (currentPrice === prevPrice) return;
    if (limitOrders.length === 0) {
      prevPriceRef.current = currentPrice;
      return;
    }

    const remainingOrders: LimitOrder[] = [];
    let updatedBalance = balance;
    let updatedPosition = position;
    let updatedEntryPrice = entryPrice;
    let anyFilled = false;

    // Filter and trigger limit orders that got hit/crossed
    for (const order of limitOrders) {
      // Rule: only matches orders for the active symbol
      if (order.symbol !== activePair.symbol) {
        remainingOrders.push(order);
        continue;
      }

      let isTriggered = false;
      const minPrice = Math.min(prevPrice, currentPrice);
      const maxPrice = Math.max(prevPrice, currentPrice);

      if (order.side === "buy") {
        // Buy Limit triggers if price drops to or below the limit order price
        if (order.price >= currentPrice || (order.price >= minPrice && order.price <= maxPrice)) {
          isTriggered = true;
        }
      } else {
        // Sell Limit triggers if price rises to or above the limit order price
        if (order.price <= currentPrice || (order.price >= minPrice && order.price <= maxPrice)) {
          isTriggered = true;
        }
      }

      if (isTriggered) {
        anyFilled = true;
        const transactionValue = order.price * order.size;

        if (order.side === "buy") {
          // Check if user has enough balance to buy
          if (updatedBalance >= transactionValue) {
            updatedBalance -= transactionValue;
            
            // Adjust position & entry price
            const isLong = updatedPosition >= 0;
            if (isLong) {
              const prevSize = updatedPosition;
              const nextSize = prevSize + order.size;
              updatedEntryPrice = nextSize > 0 
                ? (prevSize * updatedEntryPrice + order.price * order.size) / nextSize 
                : 0;
              updatedPosition = nextSize;
            } else {
              // we are short: partial buy to cover
              const shortCovered = Math.min(-updatedPosition, order.size);
              const remainingAdd = order.size - shortCovered;
              
              // Realize short profit/loss
              const shortProfit = shortCovered * (updatedEntryPrice - order.price);
              updatedBalance += shortProfit; // apply pnl back to balance
              
              if (remainingAdd > 0) {
                // position flipped to Long
                updatedPosition = remainingAdd;
                updatedEntryPrice = order.price;
              } else {
                updatedPosition += shortCovered;
                if (updatedPosition === 0) updatedEntryPrice = 0;
              }
            }

            addLog(
              `🎯 FILLED: Limit Buy ${order.size} ${activePair.symbol} @ $${order.price.toLocaleString()}`, 
              "buy"
            );
          } else {
            addLog(
              `⚠️ REJECTED: Insufficient funds for pending Limit Buy @ $${order.price.toLocaleString()}`, 
              "cancel"
            );
          }
        } else {
          // Side === "sell"
          // Sell order can always be executed either as opening a short or selling holdings.
          const isShort = updatedPosition <= 0;
          if (isShort) {
            const prevSize = Math.abs(updatedPosition);
            const nextSize = prevSize + order.size;
            updatedEntryPrice = nextSize > 0 
              ? (prevSize * updatedEntryPrice + order.price * order.size) / nextSize 
              : 0;
            updatedPosition = -nextSize;
          } else {
            // closing long position
            const longCovered = Math.min(updatedPosition, order.size);
            const remainingShort = order.size - longCovered;

            // realize long pnl
            const longProfit = longCovered * (order.price - updatedEntryPrice);
            updatedBalance += longProfit; // Add pnl back to cash balance
            updatedBalance += longCovered * order.price; // credit collateral cash back too (representing total closed trade credit)
            
            if (remainingShort > 0) {
              updatedPosition = -remainingShort;
              updatedEntryPrice = order.price;
            } else {
              updatedPosition -= longCovered;
              if (updatedPosition === 0) updatedEntryPrice = 0;
            }
          }

          addLog(
            `🎯 FILLED: Limit Sell ${order.size} ${activePair.symbol} @ $${order.price.toLocaleString()}`, 
            "sell"
          );
        }
      } else {
        remainingOrders.push(order);
      }
    }

    if (anyFilled) {
      setBalance(parseFloat(updatedBalance.toFixed(2)));
      setPosition(parseFloat(updatedPosition.toFixed(4)));
      setEntryPrice(parseFloat(updatedEntryPrice.toFixed(4)));
      setLimitOrders(remainingOrders);
    }

    prevPriceRef.current = currentPrice;
  }, [activePair.price, limitOrders, balance, position, entryPrice]);

  // Helper helper to format log lines
  const addLog = (message: string, type: TradeLog["type"]) => {
    const newLog: TradeLog = {
      id: Math.random().toString(),
      timestamp: Date.now(),
      message,
      type
    };
    setTradeLogs(prev => [newLog, ...prev].slice(0, 30));
  };

  // Pre-seed some welcome messages in the trade logs on mount
  useEffect(() => {
    addLog("⚡ PROCLUSTER Simulated DOM Router Online. Ready for tape feed...", "info");
    addLog("💡 Tip: Click any row price on the DOM ladder to snap Limit price input!", "info");
  }, []);

  // Calculate live unrealized profits
  const unrealizedPnL = position !== 0 
    ? position * (activePair.price - entryPrice) 
    : 0;

  const tradeSize = parseFloat(orderSizeInput) || 0;
  const limitPrice = parseFloat(limitPriceInput) || 0;

  // --- Trade placing functions ---
  const handleMarketBuy = () => {
    if (tradeSize <= 0) return;
    const orderCost = activePair.price * tradeSize;
    if (balance < orderCost) {
      addLog(`⚠️ Order rejected: Insufficient cash balance ($${balance.toLocaleString()} / $${orderCost.toLocaleString()} required)`, "cancel");
      return;
    }

    const nextBalance = balance - orderCost;
    let nextPosition = position;
    let nextEntryPrice = entryPrice;

    const isLong = position >= 0;
    if (isLong) {
      const prevSize = position;
      const nextSize = prevSize + tradeSize;
      nextEntryPrice = nextSize > 0 
        ? (prevSize * entryPrice + activePair.price * tradeSize) / nextSize 
        : 0;
      nextPosition = nextSize;
    } else {
      // cover partial short
      const shortCovered = Math.min(-position, tradeSize);
      const remainingLong = tradeSize - shortCovered;

      // Realize profit/loss
      const profit = shortCovered * (entryPrice - activePair.price);
      setBalance(prev => parseFloat((prev + profit).toFixed(2)));

      if (remainingLong > 0) {
        nextPosition = remainingLong;
        nextEntryPrice = activePair.price;
      } else {
        nextPosition += shortCovered;
        if (nextPosition === 0) nextEntryPrice = 0;
      }
    }

    setBalance(parseFloat(nextBalance.toFixed(2)));
    setPosition(parseFloat(nextPosition.toFixed(4)));
    setEntryPrice(parseFloat(nextEntryPrice.toFixed(4)));

    addLog(`🛒 MARKET BUY Filled: ${tradeSize} ${activePair.symbol} @ $${activePair.price.toLocaleString()}`, "buy");
  };

  const handleMarketSell = () => {
    if (tradeSize <= 0) return;
    
    let nextBalance = balance;
    let nextPosition = position;
    let nextEntryPrice = entryPrice;

    // A Sell executes matching either: closing long, or building a short position
    const isShort = position <= 0;
    if (isShort) {
      const prevSize = Math.abs(position);
      const nextSize = prevSize + tradeSize;
      nextEntryPrice = nextSize > 0 
        ? (prevSize * entryPrice + activePair.price * tradeSize) / nextSize 
        : 0;
      nextPosition = -nextSize;
    } else {
      // slice long position
      const longCovered = Math.min(position, tradeSize);
      const remainingShort = tradeSize - longCovered;

      // Profit/Loss liquidation
      const profit = longCovered * (activePair.price - entryPrice);
      nextBalance += profit; // put long scalp profits inside cash ledger
      nextBalance += longCovered * activePair.price; // credit collateral back

      if (remainingShort > 0) {
        nextPosition = -remainingShort;
        nextEntryPrice = activePair.price;
      } else {
        nextPosition -= longCovered;
        if (nextPosition === 0) nextEntryPrice = 0;
      }
    }

    // Cash adjustments
    setBalance(parseFloat(nextBalance.toFixed(2)));
    setPosition(parseFloat(nextPosition.toFixed(4)));
    setEntryPrice(parseFloat(nextEntryPrice.toFixed(4)));

    addLog(`🛒 MARKET SELL Filled: ${tradeSize} ${activePair.symbol} @ $${activePair.price.toLocaleString()}`, "sell");
  };

  const handlePlaceLimit = (side: "buy" | "sell", customPrice?: number) => {
    const targetPrice = customPrice || limitPrice;
    if (targetPrice <= 0 || tradeSize <= 0) {
      addLog("⚠️ Invalid limit price or size parameter specified", "cancel");
      return;
    }

    const newOrder: LimitOrder = {
      id: Math.random().toString(),
      price: parseFloat(targetPrice.toFixed(4)),
      size: tradeSize,
      side,
      symbol: activePair.symbol
    };

    setLimitOrders(prev => [...prev, newOrder].sort((a, b) => b.price - a.price));
    addLog(`📝 Placed ${side.toUpperCase()} LIMIT Order: ${tradeSize} @ $${targetPrice.toLocaleString()}`, "info");
  };

  const cancelLimitOrder = (id: string) => {
    const found = limitOrders.find(o => o.id === id);
    if (!found) return;
    setLimitOrders(prev => prev.filter(order => order.id !== id));
    addLog(`❌ Cancelled Limit ${found.side.toUpperCase()} @ $${found.price.toLocaleString()}`, "cancel");
  };

  const handleCancelAll = () => {
    if (limitOrders.length === 0) return;
    setLimitOrders([]);
    addLog("🗑️ Cancelled ALL working limit orders", "cancel");
  };

  const handleClosePosition = () => {
    if (position === 0) return;
    
    let nextBalance = balance;
    if (position > 0) {
      // Long liquidation
      const profit = position * (activePair.price - entryPrice);
      nextBalance += profit + position * activePair.price;
      addLog(`🛡️ LIQUIDATED LONG: Scalped position size of ${position} @ $${activePair.price.toLocaleString()}`, "sell");
    } else {
      // Short liquidation
      const shortCovered = Math.abs(position);
      const profit = shortCovered * (entryPrice - activePair.price);
      nextBalance += profit;
      addLog(`🛡️ LIQUIDATED SHORT: Covered position size of ${shortCovered} @ $${activePair.price.toLocaleString()}`, "buy");
    }

    setBalance(parseFloat(nextBalance.toFixed(2)));
    setPosition(0);
    setEntryPrice(0);
  };

  const handleRowPriceClick = (price: number) => {
    setLimitPriceInput(price.toFixed(2));
  };

  // Reverse asks so the highest price is at the top of the vertical ladder!
  // Show 200 levels for deeper scroll and analysis
  const reversedAsks = [...orderBook.asks].slice(0, 200).reverse();
  const slicedBids = [...orderBook.bids].slice(0, 200);

  // Find overall maximum size in the book to properly scale horizontal depth bars
  const maxAmountInBook = Math.max(
    ...orderBook.bids.map(b => b.amount),
    ...orderBook.asks.map(a => a.amount),
    1
  );

  return (
    <div className={`rounded-2xl p-4 flex flex-col h-full shadow-2xl relative overflow-hidden text-xs transition-all duration-300 ${
      isLight
        ? "bg-white border border-slate-200 text-slate-800"
        : "liquid-glass-card text-slate-100"
    }`}>
      
      {/* CRYPTO FEAR & GREED INDEX WIDGET */}
      <div className={`rounded-xl p-2 mb-2 border transition-all duration-300 ${
        isLight 
          ? "bg-white border-slate-200/90 shadow-sm text-slate-800" 
          : "bg-[#0c101b] border-white/5 shadow-inner text-slate-100"
      }`}>
        {/* Header with Bitcoin logo */}
        <div className="flex items-center gap-1.5 mb-1.5">
          <div className="w-5 h-5 rounded-full bg-[#f7931a] flex items-center justify-center shadow-sm shrink-0">
            <span className="text-white font-extrabold text-[11px] italic transform -skew-x-6 select-none">₿</span>
          </div>
          <div className="flex-1 min-w-0">
            <h3 className={`text-[13px] font-bold tracking-tight leading-none ${
              isLight ? "text-slate-900" : "text-slate-100"
            }`}>
              Fear & Greed Index
            </h3>
          </div>
        </div>

        {/* Gauge and Sentiment Area */}
        <div className="flex items-center justify-between gap-2.5 py-0.5">
          {/* Left panel metrics */}
          <div className="flex flex-col justify-center shrink-0">
            <span className={`text-[8px] font-black uppercase tracking-wider ${
              isLight ? "text-slate-400" : "text-slate-550"
            }`}>
              Now:
            </span>
            <span 
              className="text-[13px] font-black tracking-tight mt-0.5 leading-none drop-shadow-sm"
              style={{ color: getSentimentColor(fearGreedValue) }}
            >
              {(() => {
                if (fearGreedValue <= 25) return "Ext. Fear";
                if (fearGreedValue <= 45) return "Fear";
                if (fearGreedValue <= 54) return "Neutral";
                if (fearGreedValue <= 75) return "Greed";
                return "Ext. Greed";
              })()}
            </span>
            <span className={`text-[10px] font-semibold mt-1.5 ${isLight ? "text-slate-500" : "text-slate-400"}`}>
              Score: <span className="font-extrabold">{Math.round(fearGreedValue)}</span>
            </span>
          </div>

          {/* Right SVG speedometer arc */}
          <div className="flex-1 flex justify-center items-center">
            {(() => {
              const angle = -180 + (fearGreedValue / 100) * 180;
              const rad = (angle * Math.PI) / 180;
              const badgeX = 75 + 55 * Math.cos(rad);
              const badgeY = 80 + 55 * Math.sin(rad);
              
              return (
                <svg viewBox="0 0 150 90" className="w-full max-w-[105px] overflow-visible select-none">
                  <defs>
                    <linearGradient id="fear-greed-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#e15241" />
                      <stop offset="25%" stopColor="#f0af43" />
                      <stop offset="50%" stopColor="#e3cb41" />
                      <stop offset="75%" stopColor="#69cc63" />
                      <stop offset="100%" stopColor="#4abb50" />
                    </linearGradient>
                    <filter id="badge-glow" x="-30%" y="-30%" width="160%" height="160%">
                      <feDropShadow dx="0" dy="1.5" stdDeviation="1.5" floodOpacity={isLight ? "0.2" : "0.5"} />
                    </filter>
                  </defs>

                  {/* Underlay tracking ring */}
                  <path
                    d="M 20,80 A 55,55 0 0,1 130,80"
                    fill="none"
                    stroke={isLight ? "#f1f5f9" : "rgba(255, 255, 255, 0.05)"}
                    strokeWidth="9.5"
                    strokeLinecap="round"
                  />

                  {/* Beautiful coloured arc */}
                  <path
                    d="M 20,80 A 55,55 0 0,1 130,80"
                    fill="none"
                    stroke="url(#fear-greed-gradient)"
                    strokeWidth="9"
                    strokeLinecap="round"
                  />

                  {/* Indicator Arrow needle rotated about (75, 80) */}
                  <g transform={`rotate(${angle}, 75, 80)`}>
                    <path
                      d="M 75,76.5 L 122,80 L 75,83.5 Z"
                      fill={isLight ? "#5b6b7c" : "#94a3b8"}
                      stroke={isLight ? "#ffffff" : "#0d111d"}
                      strokeWidth="0.8"
                    />
                    
                    <circle
                      cx="75"
                      cy="80"
                      r="10.5"
                      fill={isLight ? "#e2e8f0" : "#1e293b"}
                      stroke={isLight ? "#94a3b8" : "#475569"}
                      strokeWidth="1"
                    />
                    <circle
                      cx="75"
                      cy="80"
                      r="7"
                      fill="#f7931a"
                    />
                    <text
                      x="75"
                      y="80"
                      textAnchor="middle"
                      dominantBaseline="central"
                      className="fill-white font-extrabold text-[8px] italic"
                      style={{ transform: "skewX(-10deg)" }}
                    >
                      ₿
                    </text>
                  </g>

                  {/* Bubble showing current score floating exactly on the gauge curvature */}
                  <g filter="url(#badge-glow)">
                    <circle
                      cx={badgeX}
                      cy={badgeY}
                      r="10.5"
                      fill={getSentimentColor(fearGreedValue)}
                      stroke="#ffffff"
                      strokeWidth="1.8"
                    />
                    <text
                      x={badgeX}
                      y={badgeY}
                      textAnchor="middle"
                      dominantBaseline="central"
                      className="fill-white font-mono font-black text-[9px]"
                    >
                      {Math.round(fearGreedValue)}
                    </text>
                  </g>
                </svg>
              );
            })()}
          </div>
        </div>

        {/* Info footer line */}
        <div className="flex justify-between items-center text-[7.5px] font-mono select-none mt-1.5 opacity-60">
          <span>alternative.me</span>
          <span>Updated: {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
        </div>
      </div>

      {/* 3. DEPTH OF MARKET (DOM) VERTICAL PRICE LADDER */}
      <div className={`flex-1 overflow-hidden flex flex-col rounded-xl border min-h-[140px] transition-all duration-300 ${
        isLight ? "bg-slate-50 border-slate-200" : "bg-[#06080e]/90 border-white/5"
      }`}>
        {/* DOM Table Legend Header */}
        <div className={`grid grid-cols-[1fr_1.2fr] gap-3 border-b py-1.5 text-[8.5px] font-mono font-black uppercase tracking-widest shrink-0 transition-all duration-300 ${
          isLight ? "bg-slate-100 border-slate-200 text-slate-600" : "bg-slate-950 border-white/5 text-slate-500"
        }`}>
          <div className="text-right pr-4">Size</div>
          <div className="text-left pl-3">Price ({activePair.symbol.split("/")[1] || "USDT"})</div>
        </div>

        <div ref={scrollContainerRef} className={`flex-1 overflow-y-auto pr-1 ${isLight ? "scrollbar-thin-light" : "scrollbar-thin-dark"}`}>
          {/* ----- ASKS SIDE (HIGH TO LOW) ----- */}
          {reversedAsks.map((ask) => {
            const hasPendingLimit = limitOrders.filter(o => o.side === "sell" && Math.abs(o.price - ask.price) < 0.001);
            const totalLimitSize = hasPendingLimit.reduce((s, o) => s + o.size, 0);
            const depthPercentage = (ask.amount / maxAmountInBook) * 100;
            const volumeRatio = ask.amount / maxAmountInBook;
            
            // Non-linear brightness curve: raises opacity up to 0.75 for heavy blocks
            const bgOpacity = 0.03 + Math.pow(volumeRatio, 1.3) * 0.72; 
            const isAbundantWall = volumeRatio > 0.45;

            return (
              <div 
                key={`dom-ask-${ask.price}`} 
                onClick={() => handleRowPriceClick(ask.price)}
                className={`grid grid-cols-[1fr_1.2fr] gap-3 font-mono group cursor-pointer border-y border-transparent transition-colors text-[10.5px] relative h-[18px] items-center ${
                  Math.abs(limitPrice - ask.price) < 0.01 
                    ? (isLight ? "bg-slate-300/40" : "bg-white/[0.04]") 
                    : (isLight ? "hover:bg-slate-200/50" : "hover:bg-white/[0.02]")
                }`}
              >
                {/* Horizontal Depth Volume bar starting from left edge with dynamic opacity */}
                <div 
                  className="absolute left-0 top-0 bottom-0 transition-all duration-300 pointer-events-none"
                  style={{ 
                    width: `${Math.min(100, depthPercentage)}%`,
                    backgroundColor: `rgba(244, 63, 94, ${bgOpacity})`
                  }}
                />

                {/* Floating pending limit indicators */}
                {totalLimitSize > 0 && (
                  <div className="absolute left-1 z-20 flex items-center">
                    <span 
                      onClick={(e) => {
                        e.stopPropagation();
                        hasPendingLimit.forEach(o => cancelLimitOrder(o.id));
                      }}
                      className="bg-rose-500 text-slate-950 font-black text-[7.5px] px-1 py-0.2 rounded tracking-tighter cursor-pointer"
                      title="Click to cancel working orders"
                    >
                      LMT {totalLimitSize.toFixed(1)}
                    </span>
                  </div>
                )}

                {/* Size (Ask) Red */}
                <div className={`text-right pr-4 z-10 font-bold tracking-tight transition-all duration-200 ${
                  isAbundantWall 
                    ? (isLight ? "text-rose-950 font-black text-[11px]" : "text-rose-400 font-extrabold text-[11px] drop-shadow-[0_0_3px_rgba(244,63,94,0.4)]") 
                    : (isLight ? "text-rose-800 font-extrabold" : "text-rose-500/90")
                }`}>
                  {ask.amount.toFixed(2)}
                </div>

                {/* Price (Ask) standard Gray/White */}
                <div className={`text-left pl-3 z-10 font-bold transition-all duration-200 ${
                  isAbundantWall
                    ? (isLight ? "font-black text-slate-950 text-[11.5px]" : "font-extrabold text-slate-200")
                    : (isLight ? "text-slate-800 group-hover:text-black font-extrabold" : "text-slate-400 group-hover:text-slate-100")
                }`}>
                  {ask.price.toLocaleString(undefined, { minimumFractionDigits: ask.price < 50 ? 2 : 1 })}
                </div>
              </div>
            );
          })}

          {/* ----- MID TICK / LAST PRICE ROW ----- */}
          <div className={`flex justify-center items-center border-y relative z-20 shrink-0 transition-all duration-300 h-14 ${
            isLight ? "bg-slate-100 border-slate-200" : "bg-[#090b11] border-amber-500/25"
          }`}>
            <div 
              id="dot-matrix-price"
              className={`font-mono text-[30px] font-black tracking-widest leading-none text-center select-all ${
                isLight ? "text-amber-900" : "text-amber-500"
              }`}
              style={{
                textShadow: isLight 
                  ? "none"
                  : '0 0 10px rgba(245, 158, 11, 0.95), 0 0 22px rgba(245, 158, 11, 0.65)',
                fontWeight: 900
              }}
            >
              {activePair.price.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 })}
            </div>
          </div>

          {/* ----- BIDS SIDE (HIGH TO LOW) ----- */}
          {slicedBids.map((bid) => {
            const hasPendingLimit = limitOrders.filter(o => o.side === "buy" && Math.abs(o.price - bid.price) < 0.001);
            const totalLimitSize = hasPendingLimit.reduce((s, o) => s + o.size, 0);
            const depthPercentage = (bid.amount / maxAmountInBook) * 100;
            const volumeRatio = bid.amount / maxAmountInBook;
            
            // Non-linear brightness curve: raises opacity up to 0.75 for heavy blocks
            const bgOpacity = 0.03 + Math.pow(volumeRatio, 1.3) * 0.72; 
            const isAbundantWall = volumeRatio > 0.45;

            return (
              <div 
                key={`dom-bid-${bid.price}`} 
                onClick={() => handleRowPriceClick(bid.price)}
                className={`grid grid-cols-[1fr_1.2fr] gap-3 font-mono group cursor-pointer border-y border-transparent transition-colors text-[10.5px] relative h-[18px] items-center ${
                  Math.abs(limitPrice - bid.price) < 0.01 
                    ? (isLight ? "bg-slate-300/40" : "bg-white/[0.04]") 
                    : (isLight ? "hover:bg-slate-200/50" : "hover:bg-white/[0.02]")
                }`}
              >
                {/* Horizontal Depth Volume bar starting from left edge with dynamic opacity */}
                <div 
                  className="absolute left-0 top-0 bottom-0 transition-all duration-300 pointer-events-none"
                  style={{ 
                    width: `${Math.min(100, depthPercentage)}%`,
                    backgroundColor: `rgba(16, 185, 129, ${bgOpacity})`
                  }}
                />

                {/* Floating pending limit indicators */}
                {totalLimitSize > 0 && (
                  <div className="absolute left-1 z-20 flex items-center">
                    <span 
                      onClick={(e) => {
                        e.stopPropagation();
                        hasPendingLimit.forEach(o => cancelLimitOrder(o.id));
                      }}
                      className="bg-emerald-500 text-slate-950 font-black text-[7.5px] px-1 py-0.2 rounded tracking-tighter cursor-pointer"
                      title="Click to cancel working orders"
                    >
                      LMT {totalLimitSize.toFixed(1)}
                    </span>
                  </div>
                )}

                {/* Size (Bid) Green */}
                <div className={`text-right pr-4 z-10 font-bold tracking-tight transition-all duration-200 ${
                  isAbundantWall 
                    ? (isLight ? "text-emerald-950 font-black text-[11px]" : "text-emerald-400 font-extrabold text-[11px] drop-shadow-[0_0_3px_rgba(16,185,129,0.4)]") 
                    : (isLight ? "text-emerald-800 font-extrabold" : "text-emerald-500/90")
                }`}>
                  {bid.amount.toFixed(2)}
                </div>

                {/* Price (Bid) standard Gray/White */}
                <div className={`text-left pl-3 z-10 font-bold transition-all duration-200 ${
                  isAbundantWall
                    ? (isLight ? "font-black text-slate-950 text-[11.5px]" : "font-extrabold text-slate-200")
                    : (isLight ? "text-slate-800 group-hover:text-black font-extrabold" : "text-slate-400 group-hover:text-slate-100")
                }`}>
                  {bid.price.toLocaleString(undefined, { minimumFractionDigits: bid.price < 50 ? 2 : 1 })}
                </div>
              </div>
            );
          })}
        </div>
      </div>


    </div>
  );
}
