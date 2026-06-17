/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import { CryptoPair, ClusterCandle, ClusterCell, OrderBookRow, OrderBook as OrderBookType, LiveTrade, Indicator, ProfileUser } from "./types";
import { EMPTY_PAIRS, EMPTY_CANDLES, EMPTY_ORDER_BOOK, EMPTY_TRADES } from "./data/stubs";
import Header from "./components/Header";
import ClusterChart from "./components/ClusterChart";
import DOMSidebar from "./components/DOMSidebar";
import IndicatorsModal from "./components/IndicatorsModal";
import AdminPanel from "./components/AdminPanel";
import UserProfile from "./components/UserProfile";
import RoadmapModal from "./components/RoadmapModal";
import defaultAvatar from "./assets/images/trump_avatar_1780681677035.png";
import { TrendingUp, TrendingDown, Layers, ChevronLeft, ChevronRight, AlertTriangle, ChevronDown, Check, Sparkles, CandlestickChart, Footprints, LayoutGrid, Star } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

import { AutoIcon, JapaneseIcon, FootprintIcon, ClustersIcon, CandlePreviewIcon } from "./components/icons";
import { WsClient, getOrCreateWsClient, destroyWsClient } from "./lib/wsClient";
import { getClusterCandles } from "./lib/api";
import { getActiveGroupLimits as getActiveGroupLimitsFromTier } from "./lib/tierLimits";
import { storage } from "./lib/storage";
import { MODULAR_INDICATORS } from "./indicators";

export default function App() {
  // Theme management state
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    return (storage.get("procluster_theme") as "dark" | "light") || "dark";
  });

  // Language management state
  const [language, setLanguage] = useState<"RU" | "EN" | "KZ">(() => {
    return (storage.get("procluster_lang") as "RU" | "EN" | "KZ") || "RU";
  });

  // Responsive mobile view tab selection
  const [activeMobileTab, setActiveMobileTab] = useState<"chart" | "dom">("chart");

  const handleLanguageChange = (lang: "RU" | "EN" | "KZ") => {
    setLanguage(lang);
    storage.set("procluster_lang", lang);
  };

  const toggleTheme = () => {
    setTheme(prev => {
      const next = prev === "dark" ? "light" : "dark";
      storage.set("procluster_theme", next);
      return next;
    });
  };

  // Master Crypto Pairs (ticking prices)
  const [pairs, setPairs] = useState<CryptoPair[]>(() => {
    const parsed = storage.getJson<any[] | null>("procluster_pairs", null);
    if (parsed && Array.isArray(parsed)) {
      try {
        const filtered = parsed.filter((p: any) => EMPTY_PAIRS.some(ap => ap.symbol === p.symbol));
        const sanitized = filtered.map(p => {
          const original = EMPTY_PAIRS.find(ap => ap.symbol === p.symbol);
          if (original) {
            const isReasonablePrice = p.price > original.price * 0.1 && p.price < original.price * 10 && !isNaN(p.price);
            const isReasonableStep = p.priceStep > 0 && !isNaN(p.priceStep) && typeof p.priceStep === "number";
            if (!isReasonablePrice) {
              p.price = original.price;
            }
            if (!isReasonableStep) {
              p.priceStep = original.priceStep;
            }
          }
          return p;
        });
        if (sanitized.length > 0) return sanitized;
      } catch (e) {}
    }
    return EMPTY_PAIRS;
  });

  // Persistent favorite pairs per market type
  const [favorites, setFavorites] = useState<{ SPOT: string[]; FUTURES: string[] }>(() => {
    const parsed = storage.getJson<any>("procluster_favorites", null);
    if (parsed && typeof parsed === "object") {
      try {
        return {
          SPOT: Array.isArray(parsed.SPOT) ? parsed.SPOT : [],
          FUTURES: Array.isArray(parsed.FUTURES) ? parsed.FUTURES : [],
        };
      } catch (e) {}
    }
    return { SPOT: [], FUTURES: [] };
  });

  const toggleFavorite = (symbol: string, market: "SPOT" | "FUTURES") => {
    setFavorites(prev => {
      const currentList = prev[market] || [];
      const isFav = currentList.includes(symbol);
      const updatedList = isFav
          ? currentList.filter(s => s !== symbol)
          : [...currentList, symbol];
      const updated = {
        ...prev,
        [market]: updatedList
      };
      storage.setJson("procluster_favorites", updated);
      return updated;
    });
  };

  const [workspaceLayout, setWorkspaceLayout] = useState<"1" | "2h" | "2v">("1");
  const [activeChartIndex, setActiveChartIndex] = useState<number>(0);
  const [resizeRatio, setResizeRatio] = useState<number>(50);
  const [showWorkspaceMenu, setShowWorkspaceMenu] = useState<boolean>(false);
  const workspaceMenuRef = useRef<HTMLDivElement>(null);

  // Splitter/resizer drag handlers
  const handleSplitterMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const container = document.getElementById("charts-workspace-container");
      if (!container) return;
      const rect = container.getBoundingClientRect();
      let percentage = 50;
      if (workspaceLayout === "2h") {
        const clientX = moveEvent.clientX;
        percentage = ((clientX - rect.left) / rect.width) * 100;
      } else if (workspaceLayout === "2v") {
        const clientY = moveEvent.clientY;
        percentage = ((clientY - rect.top) / rect.height) * 100;
      }
      percentage = Math.max(15, Math.min(85, percentage));
      setResizeRatio(percentage);
    };

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const handleSplitterTouchStart = (e: React.TouchEvent) => {
    const handleTouchMove = (moveEvent: TouchEvent) => {
      if (moveEvent.touches.length === 0) return;
      const container = document.getElementById("charts-workspace-container");
      if (!container) return;
      const rect = container.getBoundingClientRect();
      let percentage = 50;
      if (workspaceLayout === "2h") {
        const clientX = moveEvent.touches[0].clientX;
        percentage = ((clientX - rect.left) / rect.width) * 100;
      } else if (workspaceLayout === "2v") {
        const clientY = moveEvent.touches[0].clientY;
        percentage = ((clientY - rect.top) / rect.height) * 100;
      }
      percentage = Math.max(15, Math.min(85, percentage));
      setResizeRatio(percentage);
    };

    const handleTouchEnd = () => {
      document.removeEventListener("touchmove", handleTouchMove);
      document.removeEventListener("touchend", handleTouchEnd);
    };

    document.addEventListener("touchmove", handleTouchMove);
    document.addEventListener("touchend", handleTouchEnd);
  };

  const [activePair0, setActivePair0] = useState<CryptoPair>(() => {
    const savedSymbol = storage.get("procluster_active_symbol_0") || storage.get("procluster_active_symbol");
    const initialPairs = EMPTY_PAIRS;
    if (savedSymbol) {
      const found = initialPairs.find((p: CryptoPair) => p.symbol === savedSymbol);
      if (found) return found;
    }
    return initialPairs[0] || EMPTY_PAIRS[0];
  });

  const [activePair1, setActivePair1] = useState<CryptoPair>(() => {
    const savedSymbol = storage.get("procluster_active_symbol_1");
    const initialPairs = EMPTY_PAIRS;
    if (savedSymbol) {
      const found = initialPairs.find((p: CryptoPair) => p.symbol === savedSymbol);
      if (found) return found;
    }
    return initialPairs[1] || initialPairs[0] || EMPTY_PAIRS[0];
  });

  // Dual-chart config states
  const [interval0, setInterval0] = useState<string>(() => {
    return storage.get("procluster_interval_0") || storage.get("procluster_interval") || "15m";
  });
  const [interval1, setInterval1] = useState<string>(() => {
    return storage.get("procluster_interval_1") || "15m";
  });

  const [marketType0, setMarketType0] = useState<"SPOT" | "FUTURES">(() => {
    return (storage.get("procluster_market_type_0") as any) || (storage.get("procluster_market_type") as any) || "SPOT";
  });
  const [marketType1, setMarketType1] = useState<"SPOT" | "FUTURES">(() => {
    return (storage.get("procluster_market_type_1") as any) || "SPOT";
  });

  const [candleType0, setCandleType0] = useState<"auto" | "japanese" | "footprint" | "clusters">(() => {
    return (storage.get("procluster_candle_type_0") as any) || (storage.get("procluster_candle_type") as any) || "auto";
  });
  const [candleType1, setCandleType1] = useState<"auto" | "japanese" | "footprint" | "clusters">(() => {
    return (storage.get("procluster_candle_type_1") as any) || "auto";
  });

  const [candleDataType0, setCandleDataType0] = useState<"bid_ask" | "delta" | "volume">(() => {
    return (storage.get("procluster_candle_data_type_0") as any) || (storage.get("procluster_candle_data_type") as any) || "bid_ask";
  });
  const [candleDataType1, setCandleDataType1] = useState<"bid_ask" | "delta" | "volume">(() => {
    return (storage.get("procluster_candle_data_type_1") as any) || "bid_ask";
  });

  const [candlePalette0, setCandlePalette0] = useState<"default" | "alternative">(() => {
    return (storage.get("procluster_candle_palette_0") as any) || (storage.get("procluster_candle_palette") as any) || "default";
  });
  const [candlePalette1, setCandlePalette1] = useState<"default" | "alternative">(() => {
    return (storage.get("procluster_candle_palette_1") as any) || "default";
  });

  const [compressionMultiplier0, setCompressionMultiplier0] = useState<number>(() => {
    const saved = storage.get("procluster_compression_multiplier_0") || storage.get("procluster_compression_multiplier");
    return saved ? parseInt(saved, 10) || 1 : 1;
  });
  const [compressionMultiplier1, setCompressionMultiplier1] = useState<number>(() => {
    const saved = storage.get("procluster_compression_multiplier_1");
    return saved ? parseInt(saved, 10) || 1 : 1;
  });

  const [isTickingAll, setIsTickingAll] = useState<boolean>(true);
  const [connectionStatus, setConnectionStatus] = useState<"connected" | "syncing" | "stale">("connected");

  // Keep localStorage synchronizer effects
  useEffect(() => {
    storage.set("procluster_compression_multiplier_0", compressionMultiplier0.toString());
  }, [compressionMultiplier0]);
  useEffect(() => {
    storage.set("procluster_compression_multiplier_1", compressionMultiplier1.toString());
  }, [compressionMultiplier1]);

  useEffect(() => {
    storage.set("procluster_interval_0", interval0);
  }, [interval0]);
  useEffect(() => {
    storage.set("procluster_interval_1", interval1);
  }, [interval1]);

  useEffect(() => {
    storage.set("procluster_market_type_0", marketType0);
  }, [marketType0]);
  useEffect(() => {
    storage.set("procluster_market_type_1", marketType1);
  }, [marketType1]);

  useEffect(() => {
    storage.set("procluster_candle_type_0", candleType0);
  }, [candleType0]);
  useEffect(() => {
    storage.set("procluster_candle_type_1", candleType1);
  }, [candleType1]);

  useEffect(() => {
    storage.set("procluster_candle_data_type_0", candleDataType0);
  }, [candleDataType0]);
  useEffect(() => {
    storage.set("procluster_candle_data_type_1", candleDataType1);
  }, [candleDataType1]);

  useEffect(() => {
    storage.set("procluster_candle_palette_0", candlePalette0);
  }, [candlePalette0]);
  useEffect(() => {
    storage.set("procluster_candle_palette_1", candlePalette1);
  }, [candlePalette1]);

  useEffect(() => {
    storage.set("procluster_active_symbol_0", activePair0.symbol);
  }, [activePair0.symbol]);
  useEffect(() => {
    storage.set("procluster_active_symbol_1", activePair1.symbol);
  }, [activePair1.symbol]);

  // Getter derived configs base on activeChartIndex
  const activePair = activeChartIndex === 0 ? activePair0 : activePair1;
  const interval = activeChartIndex === 0 ? interval0 : interval1;
  const marketType = activeChartIndex === 0 ? marketType0 : marketType1;
  const candleType = activeChartIndex === 0 ? candleType0 : candleType1;
  const candleDataType = activeChartIndex === 0 ? candleDataType0 : candleDataType1;
  const candlePalette = activeChartIndex === 0 ? candlePalette0 : candlePalette1;
  const compressionMultiplier = activeChartIndex === 0 ? compressionMultiplier0 : compressionMultiplier1;

  // Setter proxy configs base on activeChartIndex
  const setActivePair = (val: CryptoPair | ((p: CryptoPair) => CryptoPair)) => {
    if (activeChartIndex === 0) {
      setActivePair0(val);
    } else {
      setActivePair1(val);
    }
  };
  const setInterval = (val: string | ((p: string) => string)) => {
    if (activeChartIndex === 0) {
      setInterval0(val);
    } else {
      setInterval1(val);
    }
  };
  const setMarketType = (val: "SPOT" | "FUTURES" | ((p: "SPOT" | "FUTURES") => "SPOT" | "FUTURES")) => {
    if (activeChartIndex === 0) {
      setMarketType0(val);
    } else {
      setMarketType1(val);
    }
  };
  const setCandleType = (val: "auto" | "japanese" | "footprint" | "clusters" | ((p: any) => any)) => {
    if (activeChartIndex === 0) {
      setCandleType0(val);
    } else {
      setCandleType1(val);
    }
  };
  const setCandleDataType = (val: "bid_ask" | "delta" | "volume" | ((p: any) => any)) => {
    if (activeChartIndex === 0) {
      setCandleDataType0(val);
    } else {
      setCandleDataType1(val);
    }
  };
  const setCandlePalette = (val: "default" | "alternative" | ((p: any) => any)) => {
    if (activeChartIndex === 0) {
      setCandlePalette0(val);
    } else {
      setCandlePalette1(val);
    }
  };
  const setCompressionMultiplier = (val: number | ((p: number) => number)) => {
    if (activeChartIndex === 0) {
      setCompressionMultiplier0(val);
    } else {
      setCompressionMultiplier1(val);
    }
  };

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
    return storage.get("procluster_sidebar_collapsed") === "true";
  });

  useEffect(() => {
    storage.set("procluster_sidebar_collapsed", isSidebarCollapsed ? "true" : "false");
  }, [isSidebarCollapsed]);

  // Helper to load default compression configured for active ticker + interval or fallback globally
  const loadDefaultCompressionForPair = (pairSymbol: string, currentInterval: string, currentMarketType: "SPOT" | "FUTURES"): number => {
    try {
      const parsed = storage.getJson<any>("procluster_default_compressions", null);
      if (parsed) {
        const tickerData = parsed[pairSymbol];
        if (tickerData) {
          // Check separate SPOT/FUTURES setting for the active ticker + interval
          const marketData = tickerData[currentMarketType];
          if (marketData && typeof marketData[currentInterval] === "number") {
            return marketData[currentInterval];
          }
          // Fallback to legacy single structure if present
          if (typeof tickerData[currentInterval] === "number") {
            return tickerData[currentInterval];
          }
        }
      }
    } catch (e) {
      console.warn("Failed to load default compression override", e);
    }
    // Fallback block if no specific override is set
    if (currentMarketType === "SPOT") {
      return 1;
    } else {
      return 5;
    }
  };

  // Load default compression for current pair + interval
  useEffect(() => {
    const val = loadDefaultCompressionForPair(activePair.symbol, interval, marketType);
    setCompressionMultiplier(val);
  }, [activePair.symbol, interval, marketType]);

  // Persists states when they change
  useEffect(() => {
    storage.setJson("procluster_pairs", pairs);
  }, [pairs]);

  useEffect(() => {
    storage.set("procluster_active_symbol", activePair.symbol);
  }, [activePair.symbol]);

  useEffect(() => {
    storage.set("procluster_interval", interval);
  }, [interval]);

  useEffect(() => {
    storage.set("procluster_market_type", marketType);
    const val = loadDefaultCompressionForPair(activePair.symbol, interval, marketType);
    setCompressionMultiplier(val);
    if (marketType === "SPOT") {
      if (interval === "1m" || interval === "5m") {
        setInterval("15m");
      }
    }
  }, [marketType]);

  useEffect(() => {
    const handleCompChange = () => {
      const val = loadDefaultCompressionForPair(activePair.symbol, interval, marketType);
      setCompressionMultiplier(val);
    };
    window.addEventListener("procluster_default_comp_changed", handleCompChange);
    return () => window.removeEventListener("procluster_default_comp_changed", handleCompChange);
  }, [activePair.symbol, interval, marketType]);

  useEffect(() => {
    storage.set("procluster_candle_type", candleType);
  }, [candleType]);

  useEffect(() => {
    storage.set("procluster_candle_data_type", candleDataType);
  }, [candleDataType]);

  useEffect(() => {
    storage.set("procluster_candle_palette", candlePalette);
  }, [candlePalette]);

  // Active User Role state (Guest, Free, Pro, VIP, or Admin) for Telegram notification gating
  const [userRole, setUserRole] = useState<"Guest" | "Free" | "Pro" | "VIP" | "Admin">(() => {
    const savedRole = storage.get("procluster_role");
    if (savedRole === "Guest" || savedRole === "Free" || savedRole === "Pro" || savedRole === "VIP" || savedRole === "Admin") return savedRole as any;
    
    // Fallback to procluster_user tier if it exists!
    const savedUser = storage.getJson<any>("procluster_user", null);
    if (savedUser) {
      try {
        const tier = (savedUser.tier || "Free").toLowerCase();
        if (tier === "admin" || savedUser.role === "Admin" || savedUser.subscriptionLevel === "Admin") return "Admin";
        if (tier === "vip" || savedUser.subscriptionLevel === "VIP") return "VIP";
        if (tier === "pro" || savedUser.subscriptionLevel === "Pro") return "Pro";
        if (tier === "free" || savedUser.subscriptionLevel === "Free") return "Free";
        return "Guest";
      } catch (e) {}
    }
    return "Admin"; // Standard default has high permissions
  });

  // Keep saved role synchronous with local storage
  const handleUserRoleChange = (role: "Guest" | "Free" | "Pro" | "VIP" | "Admin") => {
    setUserRole(role);
    storage.set("procluster_role", role);

    // Keep profileUser and localStorage "procluster_user" synchronized
    setProfileUser((prev) => {
      const tierMap: Record<string, string> = {
        Guest: "Guest",
        Free: "Free",
        Pro: "Pro",
        VIP: "VIP",
        Admin: "Admin"
      };
      const newTier = tierMap[role] || "Free";
      const updated = prev
        ? {
            ...prev,
            tier: newTier,
            role: role,
            subscriptionLevel: role
          }
        : {
            name: role === "Guest" ? "Guest" : role,
            email: role === "Guest" ? "guest@procluster.io" : `${role.toLowerCase()}@procluster.io`,
            avatar: defaultAvatar,
            regDate: "2026-05-29",
            tier: newTier,
            role: role,
            subscriptionLevel: role
          };
      storage.setJson("procluster_user", updated);
      return updated;
    });

    // Notify other components of profile user updates
    window.dispatchEvent(new Event("procluster_user_updated"));
  };

  // Telegram Notifications alerts state
  const [telegramAlerts, setTelegramAlerts] = useState<any[]>([]);
  
  // Track triggered price level clusters to avoid notification spamming in session
  const csSentAlertsRef = useRef<Set<string>>(new Set());

  // Indicators Configuration State
  const [indicators, setIndicators] = useState<Indicator[]>(() => {
    const defaultList: Indicator[] = MODULAR_INDICATORS.map(m => ({
      id: m.id,
      label: m.label,
      category: m.category,
      type: m.type,
      isFavorite: true,
      isActive: m.isActiveDefault ?? false,
      settings: m.defaultSettings
    }));

    const parsed = storage.getJson<any[]>("procluster_indicators", null);
    if (parsed && Array.isArray(parsed)) {
      try {
        return defaultList.map(defl => {
          const matched = parsed.find(item => item && item.id === defl.id);
          if (matched) {
            return {
              ...defl,
              isActive: matched.isActive,
              isFavorite: matched.isFavorite !== undefined ? matched.isFavorite : defl.isFavorite,
              settings: matched.settings ? { ...defl.settings, ...matched.settings } : defl.settings
            };
          }
          return defl;
        });
      } catch (err) {
        console.error("Error loading indicators:", err);
      }
    }
    return defaultList;
  });

  // Auto-save indicators to localStorage on modification
  useEffect(() => {
    storage.setJson("procluster_indicators", indicators);
  }, [indicators]);

  const [isIndicatorsModalOpen, setIsIndicatorsModalOpen] = useState<boolean>(false);
  const [isRoadmapModalOpen, setIsRoadmapModalOpen] = useState<boolean>(false);
  const [currentView, setCurrentView] = useState<"terminal" | "admin" | "profile">("terminal");
  const [showTickerMenu, setShowTickerMenu] = useState<boolean>(false);
  const tickerMenuRef = useRef<HTMLDivElement>(null);
  const [showPaletteMenu, setShowPaletteMenu] = useState<boolean>(false);
  const paletteMenuRef = useRef<HTMLDivElement>(null);

  const [profileUser, setProfileUser] = useState<ProfileUser | null>(() => {
    const saved = storage.getJson<any>("procluster_user", null);
    if (saved) {
      return saved;
    }
    const savedRole = storage.get("procluster_role") || "Admin";
    const tierMap: Record<string, string> = {
      Guest: "Guest",
      Free: "Free",
      Pro: "Pro",
      VIP: "VIP",
      Admin: "Admin"
    };
    return {
      name: savedRole === "Guest" ? "Guest" : savedRole,
      email: savedRole === "Guest" ? "guest@procluster.io" : `${savedRole.toLowerCase()}@procluster.io`,
      avatar: defaultAvatar,
      regDate: "2026-05-29",
      tier: tierMap[savedRole] || "Admin"
    };
  });

  // Listen for the local storage changes or custom updates to sync profileUser inside App as well
  useEffect(() => {
    const handleUpdate = () => {
      const saved = storage.getJson<any>("procluster_user", null);
      if (saved) {
        try {
          setProfileUser(saved);
          
          // Align userRole state and storage perfectly with the parsed profile user tier!
          const tier = (saved.tier || "Free").toLowerCase();
          let nextRole: "Guest" | "Free" | "Pro" | "VIP" | "Admin" = "Guest";
          if (tier === "admin" || saved.role === "Admin" || saved.subscriptionLevel === "Admin") {
            nextRole = "Admin";
          } else if (tier === "vip" || saved.subscriptionLevel === "VIP") {
            nextRole = "VIP";
          } else if (tier === "pro" || saved.subscriptionLevel === "Pro") {
            nextRole = "Pro";
          } else if (tier === "free" || saved.subscriptionLevel === "Free") {
            nextRole = "Free";
          } else {
            nextRole = "Guest";
          }
          
          setUserRole(nextRole);
          storage.set("procluster_role", nextRole);
        } catch (e) {
          // ignore
        }
      } else {
        setProfileUser(null);
      }
    };
    window.addEventListener("procluster_user_updated", handleUpdate);
    window.addEventListener("storage", handleUpdate);
    return () => {
      window.removeEventListener("procluster_user_updated", handleUpdate);
      window.removeEventListener("storage", handleUpdate);
    };
  }, []);

  const getActiveGroupLimits = () => {
    return getActiveGroupLimitsFromTier(userRole, profileUser).limits;
  };

  const getMaxCandlesForInterval = (interval: string) => {
    const limits = getActiveGroupLimits();
    let days = 1;
    switch (interval) {
      case "1m":
        days = limits.historyDays_1m ?? 1;
        return (days * 24 * 60); // 1440 candles per day
      case "5m":
        days = limits.historyDays_5m ?? 3;
        return (days * 24 * 12); // 288 candles per day
      case "15m":
        days = limits.historyDays_15m ?? 7;
        return (days * 24 * 4); // 96 candles per day
      case "30m":
        days = limits.historyDays_30m ?? 14;
        return (days * 24 * 2); // 48 candles per day
      case "1h":
        days = limits.historyDays_1h ?? 30;
        return (days * 24); // 24 candles per day
      case "4h":
        days = limits.historyDays_4h ?? 90;
        return (days * 6); // 6 candles per day
      default:
        return limits.maxHistory || 700;
    }
  };

  // Click outside to close custom menus
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (tickerMenuRef.current && !tickerMenuRef.current.contains(event.target as Node)) {
        setShowTickerMenu(false);
      }
      if (paletteMenuRef.current && !paletteMenuRef.current.contains(event.target as Node)) {
        setShowPaletteMenu(false);
      }
      if (workspaceMenuRef.current && !workspaceMenuRef.current.contains(event.target as Node)) {
        setShowWorkspaceMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Dual Chart, book, and trades datasets
  const [candles0, setCandles0] = useState<ClusterCandle[]>([]);
  const [orderBook0, setOrderBook0] = useState<OrderBookType>({ bids: [], asks: [] });
  const [trades0, setTrades0] = useState<LiveTrade[]>([]);

  const [candles1, setCandles1] = useState<ClusterCandle[]>([]);
  const [orderBook1, setOrderBook1] = useState<OrderBookType>({ bids: [], asks: [] });
  const [trades1, setTrades1] = useState<LiveTrade[]>([]);

  const candles = activeChartIndex === 0 ? candles0 : candles1;
  const orderBook = activeChartIndex === 0 ? orderBook0 : orderBook1;
  const trades = activeChartIndex === 0 ? trades0 : trades1;

  // --- Dual-Chart WebSocket & Real-Time Connection Refs & Buffers ---
  const incomingCandleBufferRef0 = useRef<any>(null);
  const activePairRef0 = useRef<CryptoPair>(activePair0);
  const intervalRef0 = useRef<string>(interval0);
  const orderBookTickStepRef0 = useRef<number>(0.01);
  const wsClientRef0 = useRef<WsClient | null>(null);
  const prevSubRef0 = useRef<{ symbol: string; market: string; tf: string; compression: number } | null>(null);

  const incomingCandleBufferRef1 = useRef<any>(null);
  const activePairRef1 = useRef<CryptoPair>(activePair1);
  const intervalRef1 = useRef<string>(interval1);
  const orderBookTickStepRef1 = useRef<number>(0.01);
  const wsClientRef1 = useRef<WsClient | null>(null);
  const prevSubRef1 = useRef<{ symbol: string; market: string; tf: string; compression: number } | null>(null);
  
  useEffect(() => {
    activePairRef0.current = activePair0;
  }, [activePair0]);

  useEffect(() => {
    activePairRef1.current = activePair1;
  }, [activePair1]);

  useEffect(() => {
    intervalRef0.current = interval0;
  }, [interval0]);

  useEffect(() => {
    intervalRef1.current = interval1;
  }, [interval1]);

  const getWhaleThreshold = (symbol: string): number => {
    if (symbol.startsWith("BTC")) return 0.5;
    if (symbol.startsWith("ETH")) return 5;
    if (symbol.startsWith("SOL")) return 100;
    if (symbol.startsWith("BNB")) return 30;
    return 20000; // General high volume threshold (e.g., XRP or low price pairs)
  };

  // Load candles from backend API when Chart 0 settings change
  useEffect(() => {
    let active = true;
    setConnectionStatus("syncing");

    const isFutures = marketType0 === "FUTURES";
    const isBtc = activePair0.symbol.toUpperCase().includes("BTC");
    const baseCompression = isBtc ? (isFutures ? 25 : 500) : 25;
    const compression = baseCompression * compressionMultiplier0;
    const market = isFutures ? "futures" : "spot";

    getClusterCandles({
      symbol: activePair0.symbol,
      market,
      tf: interval0,
      compression,
    }).then(({ candles }) => {
      if (!active) return;
      const maxCandles = getMaxCandlesForInterval(interval0);
      setCandles0(candles.slice(-maxCandles));
      setLoadId0(v => v + 1);

      if (candles.length > 0) {
        const lastCandle = candles[candles.length - 1];
        setActivePair0(prev => {
          if (prev.symbol === activePair0.symbol) {
            return { ...prev, price: lastCandle.close };
          }
          return prev;
        });
        setPairs(prevPairs => prevPairs.map(p => {
          if (p.symbol === activePair0.symbol) {
            return { ...p, price: lastCandle.close };
          }
          return p;
        }));
      }

      setConnectionStatus("connected");
    }).catch(err => {
      console.warn("[Backend API 0] Load failed:", err);
      if (!active) return;
      setCandles0(EMPTY_CANDLES);
      setConnectionStatus("connected");
    });

    setTrades0(EMPTY_TRADES);
    setOrderBook0(EMPTY_ORDER_BOOK);

    return () => { active = false; };
  }, [activePair0.symbol, interval0, marketType0, compressionMultiplier0]);

  // Load candles from backend API when Chart 1 settings change
  useEffect(() => {
    let active = true;
    setConnectionStatus("syncing");

    const isFutures = marketType1 === "FUTURES";
    const isBtc = activePair1.symbol.toUpperCase().includes("BTC");
    const baseCompression = isBtc ? (isFutures ? 25 : 500) : 25;
    const compression = baseCompression * compressionMultiplier1;
    const market = isFutures ? "futures" : "spot";

    getClusterCandles({
      symbol: activePair1.symbol,
      market,
      tf: interval1,
      compression,
    }).then(({ candles }) => {
      if (!active) return;
      const maxCandles = getMaxCandlesForInterval(interval1);
      setCandles1(candles.slice(-maxCandles));
      setLoadId1(v => v + 1);

      if (candles.length > 0) {
        const lastCandle = candles[candles.length - 1];
        setActivePair1(prev => {
          if (prev.symbol === activePair1.symbol) {
            return { ...prev, price: lastCandle.close };
          }
          return prev;
        });
        setPairs(prevPairs => prevPairs.map(p => {
          if (p.symbol === activePair1.symbol) {
            return { ...p, price: lastCandle.close };
          }
          return p;
        }));
      }

      setConnectionStatus("connected");
    }).catch(err => {
      console.warn("[Backend API 1] Load failed:", err);
      if (!active) return;
      setCandles1(EMPTY_CANDLES);
      setConnectionStatus("connected");
    });

    setTrades1(EMPTY_TRADES);
    setOrderBook1(EMPTY_ORDER_BOOK);

    return () => { active = false; };
  }, [activePair1.symbol, interval1, marketType1, compressionMultiplier1]);

  const [isLoadingMore0, setIsLoadingMore0] = useState<boolean>(false);
  const [isLoadingMore1, setIsLoadingMore1] = useState<boolean>(false);
  const [loadId0, setLoadId0] = useState<number>(0);
  const [loadId1, setLoadId1] = useState<number>(0);

  const handleLoadMore0 = (oldestCandleTime: number) => {
    if (isLoadingMore0) return;
    setIsLoadingMore0(true);
    const isFutures = marketType0 === "FUTURES";
    const isBtc = activePair0.symbol.toUpperCase().includes("BTC");
    const baseCompression = isBtc ? (isFutures ? 25 : 500) : 25;
    const compression = baseCompression * compressionMultiplier0;
    getClusterCandles({
      symbol: activePair0.symbol,
      market: isFutures ? "futures" : "spot",
      tf: interval0,
      compression,
      before: Math.floor(oldestCandleTime / 1000),
    }).then(({ candles }) => {
      setCandles0(prev => {
        const maxCandles = getMaxCandlesForInterval(interval0);
        return [...candles, ...prev].slice(-maxCandles);
      });
    }).catch(err => {
      console.warn("[Load More 0] Failed:", err);
    }).finally(() => {
      setIsLoadingMore0(false);
    });
  };

  const handleLoadMore1 = (oldestCandleTime: number) => {
    if (isLoadingMore1) return;
    setIsLoadingMore1(true);
    const isFutures = marketType1 === "FUTURES";
    const isBtc = activePair1.symbol.toUpperCase().includes("BTC");
    const baseCompression = isBtc ? (isFutures ? 25 : 500) : 25;
    const compression = baseCompression * compressionMultiplier1;
    getClusterCandles({
      symbol: activePair1.symbol,
      market: isFutures ? "futures" : "spot",
      tf: interval1,
      compression,
      before: Math.floor(oldestCandleTime / 1000),
    }).then(({ candles }) => {
      setCandles1(prev => {
        const maxCandles = getMaxCandlesForInterval(interval1);
        return [...candles, ...prev].slice(-maxCandles);
      });
    }).catch(err => {
      console.warn("[Load More 1] Failed:", err);
    }).finally(() => {
      setIsLoadingMore1(false);
    });
  };

  // WebSocket connection — singleton survives StrictMode double-mount
  useEffect(() => {
    if (!isTickingAll) {
      setConnectionStatus("stale");
      return;
    }

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws`;

    const client = getOrCreateWsClient(wsUrl, {
      url: wsUrl,
      onConnect: () => setConnectionStatus("connected"),
      onDisconnect: () => setConnectionStatus("stale"),
    });

    wsClientRef0.current = client;
    client.connect();

    return () => {
      wsClientRef0.current = null;
    };
  }, [isTickingAll]);

  // Chart 0 subscription with per-subscription callbacks
  useEffect(() => {
    const client = wsClientRef0.current;
    if (!client) return;
    const isFutures = marketType0 === "FUTURES";
    const isBtc = activePair0.symbol.toUpperCase().includes("BTC");
    const baseCompression = isBtc ? (isFutures ? 25 : 500) : 25;
    const compression = baseCompression * compressionMultiplier0;
    const market = isFutures ? "futures" : "spot";

    if (prevSubRef0.current) {
      const prev = prevSubRef0.current;
      client.unsubscribe(prev.symbol, prev.market, prev.tf, prev.compression);
    }
    prevSubRef0.current = { symbol: activePair0.symbol, market, tf: interval0, compression };

    client.subscribe(activePair0.symbol, market, interval0, compression, {
      onUpdate: (_msg, candle) => { incomingCandleBufferRef0.current = candle; },
      onClose: (_msg, candle) => { incomingCandleBufferRef0.current = candle; },
    });

    return () => {
      if (prevSubRef0.current) {
        const prev = prevSubRef0.current;
        client.unsubscribe(prev.symbol, prev.market, prev.tf, prev.compression);
        prevSubRef0.current = null;
      }
    };
  }, [activePair0.symbol, marketType0, interval0, compressionMultiplier0]);

  // Chart 1 WebSocket connection — singleton
  useEffect(() => {
    if (!isTickingAll) return;

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws`;

    const client = getOrCreateWsClient(wsUrl, {
      url: wsUrl,
      onConnect: () => setConnectionStatus("connected"),
      onDisconnect: () => setConnectionStatus("stale"),
    });

    wsClientRef1.current = client;
    client.connect();

    return () => {
      wsClientRef1.current = null;
    };
  }, [isTickingAll]);

  // Chart 1 subscription with per-subscription callbacks
  useEffect(() => {
    const client = wsClientRef1.current;
    if (!client) return;
    const isFutures = marketType1 === "FUTURES";
    const isBtc = activePair1.symbol.toUpperCase().includes("BTC");
    const baseCompression = isBtc ? (isFutures ? 25 : 500) : 25;
    const compression = baseCompression * compressionMultiplier1;
    const market = isFutures ? "futures" : "spot";

    if (prevSubRef1.current) {
      const prev = prevSubRef1.current;
      client.unsubscribe(prev.symbol, prev.market, prev.tf, prev.compression);
    }
    prevSubRef1.current = { symbol: activePair1.symbol, market, tf: interval1, compression };

    client.subscribe(activePair1.symbol, market, interval1, compression, {
      onUpdate: (_msg, candle) => { incomingCandleBufferRef1.current = candle; },
      onClose: (_msg, candle) => { incomingCandleBufferRef1.current = candle; },
    });

    return () => {
      if (prevSubRef1.current) {
        const prev = prevSubRef1.current;
        client.unsubscribe(prev.symbol, prev.market, prev.tf, prev.compression);
        prevSubRef1.current = null;
      }
    };
  }, [activePair1.symbol, marketType1, interval1, compressionMultiplier1]);

  // WS Candle Buffer Flush (200ms interval)
  useEffect(() => {
    if (!isTickingAll) return;

    const flusherId = window.setInterval(() => {
      if (incomingCandleBufferRef0.current) {
        const candle = incomingCandleBufferRef0.current;
        incomingCandleBufferRef0.current = null;
        setCandles0(prev => {
          if (prev.length === 0) return [candle];
          const lastIdx = prev.length - 1;
          const last = prev[lastIdx];
          if (candle.timestamp > last.timestamp) {
            const next = [...prev, candle];
            return next.slice(-getMaxCandlesForInterval(intervalRef0.current));
          } else if (candle.timestamp === last.timestamp) {
            const next = prev.slice();
            next[lastIdx] = candle;
            return next;
          }
          return prev;
        });
        setActivePair0(prev => {
          if (prev.symbol === activePairRef0.current.symbol) {
            return { ...prev, price: candle.close };
          }
          return prev;
        });
      }

      if (incomingCandleBufferRef1.current) {
        const candle = incomingCandleBufferRef1.current;
        incomingCandleBufferRef1.current = null;
        setCandles1(prev => {
          if (prev.length === 0) return [candle];
          const lastIdx = prev.length - 1;
          const last = prev[lastIdx];
          if (candle.timestamp > last.timestamp) {
            const next = [...prev, candle];
            return next.slice(-getMaxCandlesForInterval(intervalRef1.current));
          } else if (candle.timestamp === last.timestamp) {
            const next = prev.slice();
            next[lastIdx] = candle;
            return next;
          }
          return prev;
        });
        setActivePair1(prev => {
          if (prev.symbol === activePairRef1.current.symbol) {
            return { ...prev, price: candle.close };
          }
          return prev;
        });
      }
    }, 200);

    return () => window.clearInterval(flusherId);
  }, [isTickingAll]);

  // Translate intervals to minutes
  const parseInterval = (val: string): number => {
    if (val === "1m") return 1;
    if (val === "5m") return 5;
    if (val === "15m") return 15;
    if (val === "30m") return 30;
    if (val === "1h") return 60;
    if (val === "4h") return 240;
    return 15;
  };



  // --- Admin Panel API Callbacks ---
  const handleUpdatePairPrice = (symbol: string, newPrice: number) => {
    const activePairRefLocal = activeChartIndex === 0 ? activePairRef0 : activePairRef1;

    setPairs((prev) =>
      prev.map((p) => {
        if (p.symbol === symbol) {
          const updated = { ...p, price: newPrice };
          if (activePairRefLocal.current.symbol === symbol) {
            setActivePair(updated);
          }
          return updated;
        }
        return p;
      })
    );
  };

  const handleInjectWhaleTrade = (_side: "buy" | "sell", _amount: number) => {};

  const handleClearHistory = () => {
    if (activeChartIndex === 0) {
      setCandles0([]);
      setTrades0([]);
    } else {
      setCandles1([]);
      setTrades1([]);
    }
  };

  const handleAddPair = (newPair: CryptoPair) => {
    setPairs(prev => [...prev, newPair]);
  };

  const handleApplyAnomaly = (_type: "pump" | "dump" | "spike" | "whale-wall") => {};

  return (
    <div className={`h-screen max-h-screen flex flex-col font-sans select-none antialiased relative overflow-hidden transition-all duration-300 ${
      theme === "light" ? "light bg-[#e2e8f0] text-slate-900" : "bg-[#030712]/92 text-slate-100"
    }`}>
      {/* Dynamic Drifting Liquid Background Blobs (Lava-lamp style glass ambient glow) */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
        <div className={`absolute top-[5%] left-[3%] w-[450px] h-[450px] rounded-full liquid-blob-cyan blur-[100px] transition-all duration-300 ${theme === "light" ? "opacity-15" : "opacity-40"}`} />
        <div className={`absolute top-[50%] right-[5%] w-[550px] h-[550px] rounded-full liquid-blob-magenta blur-[120px] transition-all duration-300 ${theme === "light" ? "opacity-10" : "opacity-35"}`} />
        <div className={`absolute top-[30%] left-[45%] -translate-x-1/2 w-[420px] h-[420px] rounded-full liquid-blob-emerald blur-[90px] transition-all duration-300 ${theme === "light" ? "opacity-10" : "opacity-20"}`} />
        <div className={`absolute bottom-[2%] left-[10%] w-[380px] h-[380px] rounded-full liquid-blob-gold blur-[100px] transition-all duration-300 ${theme === "light" ? "opacity-10" : "opacity-30"}`} />
      </div>

      {/* BRAND TERMINAL HEADER */}
      <Header
        isTickingAll={isTickingAll}
        onToggleTicking={() => setIsTickingAll(!isTickingAll)}
        connectionStatus={connectionStatus}
        theme={theme}
        onToggleTheme={toggleTheme}
        onOpenAdmin={() => setCurrentView(prev => prev === "admin" ? "terminal" : "admin")}
        language={language}
        onLanguageChange={handleLanguageChange}
        userRole={userRole}
        onChangeUserRole={handleUserRoleChange}
        onOpenProfile={() => setCurrentView("profile")}
        onOpenHome={() => setCurrentView("terminal")}
        onOpenRoadmap={() => setIsRoadmapModalOpen(true)}
      />

      {currentView === "admin" ? (
        <AdminPanel
          isOpen={true}
          onClose={() => setCurrentView("terminal")}
          theme={theme}
          activePair={activePair}
          pairs={pairs}
          connectionStatus={connectionStatus}
          isTickingAll={isTickingAll}
          onToggleTicking={() => setIsTickingAll(!isTickingAll)}
          onSetConnectionStatus={setConnectionStatus}
          onUpdatePairPrice={handleUpdatePairPrice}
          onInjectWhaleTrade={handleInjectWhaleTrade}
          onClearHistory={handleClearHistory}
          onApplyAnomaly={handleApplyAnomaly}
          marketType={marketType}
          onSetMarketType={setMarketType}
          onAddPair={handleAddPair}
        />
      ) : currentView === "profile" ? (
        <div className={`flex-1 overflow-y-auto w-full relative z-40 flex flex-col ${theme === 'light' ? 'scrollbar-thin-light bg-slate-100' : 'scrollbar-thin-dark bg-[#060813]'}`}>
          <UserProfile
            user={profileUser}
            onUpdateUser={setProfileUser}
            onClose={() => setCurrentView("terminal")}
            theme={theme}
            language={language}
          />
        </div>
      ) : (
        <>
          {/* DASHBOARD STATISTICS HUD BANNER WITH GLASSMORPHISM */}
          <section className={`backdrop-blur-md border-b px-4 py-1.5 flex items-center select-none overflow-visible relative z-30 transition-shadow duration-300 gap-x-4 sm:gap-x-6 ${
        theme === "light"
          ? "bg-white/95 border-slate-300 shadow-md"
          : "bg-slate-950/40 border-slate-900/60 shadow-md"
      }`}>

          {/* 1. Ticker Dropdown Select */}
          <div className="shrink-0 relative z-40">
            <span className={`text-[10px] uppercase font-mono tracking-widest font-bold block mb-0.5 ${
              theme === "light" ? "text-slate-500" : "text-slate-400/80"
            }`}>
              Active Ticker
            </span>
            <div className="relative font-sans" ref={tickerMenuRef}>
              <button
                onClick={() => setShowTickerMenu(!showTickerMenu)}
                className={`flex items-center justify-between gap-3 px-3 py-1 rounded-lg text-sm cursor-pointer hover:scale-[1.01] active:scale-[0.99] transition-all min-w-[130px] h-[30px] select-none border ${
                  theme === "light"
                    ? "bg-white hover:bg-slate-100 border-slate-300 text-slate-900 font-black shadow-sm"
                    : "liquid-glass-button border-white/5 text-yellow-400 font-extrabold"
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span className={`font-mono tracking-tight font-extrabold text-xs sm:text-sm ${theme === "light" ? "text-slate-800" : "text-white"}`}>{activePair.symbol}</span>
                </div>
                <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${
                  theme === "light" ? "text-slate-600" : "text-slate-400"
                } ${showTickerMenu ? "rotate-180" : ""}`} />
              </button>

              <AnimatePresence>
                {showTickerMenu && (
                  <motion.div
                    initial={{ opacity: 0, y: 6, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 6, scale: 0.95 }}
                    className={`absolute left-0 mt-1.5 w-48 rounded-xl p-2 z-50 text-left select-none shadow-2xl backdrop-blur-md border transition-all duration-300 ${
                      theme === "light"
                        ? "bg-white border-slate-300 text-slate-900 shadow-2xl"
                        : "bg-[#090d16]/98 border border-white/10 text-slate-100"
                    }`}
                  >
                    <div className={`text-[9px] font-bold px-2 pb-1 border-b mb-1.5 uppercase tracking-widest ${
                      theme === "light" ? "text-slate-500 border-slate-100" : "text-slate-400 border-white/5"
                    }`}>
                      {language === "EN" ? "Available Pairs" : language === "KZ" ? "Қолжетімді жұптар" : "Доступные пары"}
                    </div>
                    <div className="flex flex-col gap-0.5 max-h-[300px] overflow-y-auto pr-1">
                      {[...pairs]
                        .sort((a, b) => {
                          const aFav = favorites[marketType]?.includes(a.symbol) ? 1 : 0;
                          const bFav = favorites[marketType]?.includes(b.symbol) ? 1 : 0;
                          if (aFav !== bFav) return bFav - aFav; // Favorites at the top
                          return a.symbol.localeCompare(b.symbol); // Alphabetical secondary
                        })
                        .map((p) => {
                          const isFav = favorites[marketType]?.includes(p.symbol);
                          const isActive = activePair.symbol === p.symbol;
                          return (
                            <div
                              key={p.symbol}
                              className={`flex items-center justify-between px-2 py-1 rounded-lg transition-all ${
                                isActive
                                  ? theme === "light"
                                    ? "bg-amber-50 text-amber-700 font-extrabold border border-amber-200/50 shadow-sm"
                                    : "bg-yellow-500/10 text-yellow-500 font-extrabold border border-yellow-500/25"
                                  : theme === "light"
                                    ? "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                                    : "text-slate-300 hover:text-white hover:bg-white/5"
                              }`}
                            >
                              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleFavorite(p.symbol, marketType);
                                  }}
                                  className={`p-0.5 rounded cursor-pointer transition-all duration-100 active:scale-90 ${
                                    isFav
                                      ? "text-yellow-400 hover:text-yellow-500"
                                      : theme === "light"
                                      ? "text-slate-300 hover:text-slate-500"
                                      : "text-slate-600 hover:text-slate-400"
                                  }`}
                                  title={language === "EN" ? "Toggle favorite" : "В избранное"}
                                >
                                  <Star
                                    className={`w-3.5 h-3.5 ${isFav ? "fill-current" : ""}`}
                                  />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setActivePair(p);
                                    setShowTickerMenu(false);
                                  }}
                                  className="flex-1 text-left font-mono text-xs font-bold truncate cursor-pointer bg-transparent border-none p-0 outline-none"
                                >
                                  {p.symbol}
                                </button>
                              </div>
                              {isActive && (
                                <Check className="w-3 h-3 shrink-0 ml-1" />
                              )}
                            </div>
                          );
                        })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* 2. Market Type (SPOT / FUTURES) Segment Control */}
          <div className="shrink-0">
            <span className={`text-[10px] uppercase font-mono tracking-widest font-bold block mb-0.5 ${
              theme === "light" ? "text-slate-600 font-bold" : "text-slate-400/80"
            }`}>
              Market Type
            </span>
            <div className={`grid grid-cols-2 gap-0.5 p-[2px] rounded-lg h-[30px] items-center min-w-[130px] select-none transition-all duration-300 border ${
              theme === "light" ? "bg-slate-200 border-slate-300" : "bg-slate-950/60 border-white/5"
            }`}>
              {(["SPOT", "FUTURES"] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setMarketType(type)}
                  className={`px-2 py-0.5 rounded-md text-[11px] font-bold font-mono transition-all duration-200 cursor-pointer text-center leading-none ${
                    marketType === type
                      ? theme === "light"
                        ? "bg-white text-slate-900 font-extrabold border border-slate-300 shadow-sm"
                        : "bg-yellow-500/10 border border-yellow-500/25 text-yellow-500 font-extrabold shadow-inner"
                      : theme === "light"
                        ? "text-slate-600 hover:text-slate-900 hover:bg-white/40"
                        : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          {/* 3. Interval (таймфреймы) */}
          <div className="shrink-0">
            <span className={`text-[10px] uppercase font-mono tracking-widest font-bold block mb-0.5 ${
              theme === "light" ? "text-slate-600 font-bold" : "text-slate-400/80"
            }`}>
              Interval
            </span>
            <div className="flex items-center gap-1">
              {(marketType === "SPOT" ? ["15m", "30m", "1h", "4h"] : ["1m", "5m", "15m", "30m", "1h", "4h", "50t"]).map((item) => (
                <button
                  key={item}
                  onClick={() => setInterval(item)}
                  className={`px-2 py-1 rounded-lg text-xs font-bold font-mono cursor-pointer transition-all duration-200 h-[30px] ${
                    interval === item
                      ? theme === "light"
                        ? "bg-amber-100 text-amber-900 border border-amber-400 font-black shadow-sm"
                        : "liquid-glass-active text-yellow-400 font-black"
                      : theme === "light"
                        ? "bg-slate-200 hover:bg-slate-300 hover:text-slate-900 text-slate-700 font-bold border border-slate-300 shadow-sm"
                        : "liquid-glass-button text-slate-400 hover:text-slate-100"
                  }`}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>

          {/* 4. Candle Type Switcher */}
          <div className="shrink-0">
            <span className={`text-[10px] uppercase font-mono tracking-widest font-bold block mb-0.5 ${
              theme === "light" ? "text-slate-600 font-bold" : "text-slate-400/80"
            }`}>
              {language === "EN" ? "Candle Type" : language === "KZ" ? "Шамдар түрі" : "Тип свечей"}
            </span>
            <div className={`flex items-center p-[2px] rounded-lg h-[30px] select-none transition-all duration-300 border ${
              theme === "light" ? "bg-slate-100 border-slate-200" : "bg-slate-950/60 border-white/5"
            }`}>
              {[
                { id: "auto", label: language === "EN" ? "Auto" : "Авто", icon: AutoIcon },
                { id: "japanese", label: language === "EN" ? "Japanese Candlesticks" : language === "KZ" ? "Жапон шамдары" : "Японские свечи", icon: JapaneseIcon },
                { id: "footprint", label: language === "EN" ? "Footprint" : "Футпринт", icon: FootprintIcon },
                { id: "clusters", label: language === "EN" ? "Clusters" : language === "KZ" ? "Кластерлер" : "Кластера", icon: ClustersIcon }
              ].map((item) => {
                const IconComponent = item.icon;
                const isSelected = candleType === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setCandleType(item.id as any)}
                    title={item.label}
                    className="relative flex-1 px-2 py-0.5 rounded-md text-xs font-bold cursor-pointer text-center leading-none h-[24px] flex items-center justify-center border-0 outline-none select-none"
                  >
                    {isSelected && (
                      <motion.div
                        layoutId="activeCandleType"
                        className={`absolute inset-0 rounded-md ${
                          theme === "light"
                            ? "bg-white border border-slate-300 shadow-sm"
                            : "bg-blue-500/10 border border-blue-500/25 shadow-inner"
                        }`}
                        transition={{ type: "spring", stiffness: 380, damping: 30 }}
                        style={{ zIndex: 0 }}
                      />
                    )}
                    <span className={`relative z-10 flex items-center justify-center transition-colors duration-200 ${
                      isSelected
                        ? theme === "light"
                          ? "text-blue-800 font-black"
                          : "text-blue-400 font-extrabold"
                        : theme === "light"
                          ? "text-slate-600 hover:text-slate-900 font-bold"
                          : "text-slate-400 hover:text-slate-200"
                    }`}>
                      <IconComponent className="w-3.5 h-3.5" />
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 5. Candle Palette Switcher */}
          <div className="shrink-0 relative z-40">
            <span className={`text-[10px] uppercase font-mono tracking-widest font-bold block mb-0.5 ${
              theme === "light" ? "text-slate-500 font-bold" : "text-slate-400/80"
            }`}>
              {language === "EN" ? "Candle Palette" : language === "KZ" ? "Шам палитрасы" : "Палитра свечей"}
            </span>
            <div className="relative font-sans" ref={paletteMenuRef}>
              <button
                onClick={() => setShowPaletteMenu(!showPaletteMenu)}
                className={`flex items-center justify-between gap-1.5 px-2.5 py-1 rounded-lg text-xs cursor-pointer hover:scale-[1.01] active:scale-[0.99] transition-all min-w-[135px] h-[30px] select-none border ${
                  theme === "light"
                    ? "bg-white hover:bg-slate-100 border-slate-300 text-slate-800 font-extrabold shadow-sm"
                    : "liquid-glass-button border-white/5 text-slate-200 font-black"
                }`}
              >
                <div className="flex items-center gap-1.5 leading-none">
                  <CandlePreviewIcon palette={candlePalette} theme={theme} />
                  <span className={`font-mono text-[10px] whitespace-nowrap ${theme === "light" ? "text-slate-700 font-black" : "text-white font-extrabold"}`}>
                    {candlePalette === "default" 
                      ? (language === "EN" ? "Default" : language === "KZ" ? "Әдепкі" : "Стандарт")
                      : (language === "EN" ? "Alternative" : language === "KZ" ? "Балама" : "Альт")}
                  </span>
                </div>
                <ChevronDown className={`w-3 h-3 transition-transform duration-200 shrink-0 ${
                  theme === "light" ? "text-slate-600" : "text-slate-400"
                } ${showPaletteMenu ? "rotate-180" : ""}`} />
              </button>

              <AnimatePresence>
                {showPaletteMenu && (
                  <motion.div
                    initial={{ opacity: 0, y: 6, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 6, scale: 0.95 }}
                    style={{ originY: 0 }}
                    className={`absolute left-0 mt-1.5 w-44 rounded-xl p-1.5 z-50 text-left select-none shadow-2xl backdrop-blur-md border transition-all duration-300 ${
                      theme === "light"
                        ? "bg-white border-slate-300 text-slate-900 shadow-xl"
                        : "bg-[#090d16]/98 border border-white/10 text-slate-100"
                    }`}
                  >
                    <div className="flex flex-col gap-0.5">
                      {[
                        { id: "default", label: language === "EN" ? "Default" : language === "KZ" ? "Әдепкі" : "Стандарт" },
                        { id: "alternative", label: language === "EN" ? "Alternative" : language === "KZ" ? "Балама" : "Альт" }
                      ].map((item) => {
                        const isSelected = candlePalette === item.id;
                        return (
                          <button
                            key={item.id}
                            onClick={() => {
                              setCandlePalette(item.id as any);
                              setShowPaletteMenu(false);
                            }}
                            className={`flex items-center justify-between px-2 py-1.5 rounded-lg text-left cursor-pointer transition-all ${
                              isSelected
                                ? theme === "light"
                                  ? "bg-blue-50 text-blue-800 font-extrabold border border-blue-200 shadow-sm"
                                  : "bg-blue-500/10 text-blue-400 font-extrabold border border-blue-500/25"
                                : theme === "light"
                                  ? "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                                  : "text-slate-300 hover:text-white hover:bg-white/5"
                            }`}
                          >
                            <div className="flex items-center gap-1.5 select-none">
                              <CandlePreviewIcon palette={item.id as any} theme={theme} />
                              <span className="font-mono text-[10px] font-bold">{item.label}</span>
                            </div>
                            {isSelected && (
                              <Check className="w-3 tracking-tight ml-1 text-blue-500 shrink-0" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* 6. Candle Data Type Switcher */}
          <div className="shrink-0">
            <span className={`text-[10px] uppercase font-mono tracking-widest font-bold block mb-0.5 ${
              theme === "light" ? "text-slate-600 font-bold" : "text-slate-400/80"
            }`}>
              {language === "EN" ? "Candle Data" : language === "KZ" ? "Шамдағы деректер" : "Данные в свечах"}
            </span>
            <div className={`flex items-center p-[2px] rounded-lg h-[30px] select-none transition-all duration-300 border ${
              theme === "light" ? "bg-slate-200 border-slate-300" : "bg-slate-950/60 border-white/5"
            }`}>
              {[
                { id: "bid_ask", label: "Bid Ask" },
                { id: "delta", label: "Delta" },
                { id: "volume", label: language === "EN" ? "Volume" : language === "KZ" ? "Көлем" : "Объем" }
              ].map((item) => {
                const isSelected = candleDataType === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setCandleDataType(item.id as any)}
                    className="relative flex-1 px-2 py-0.5 rounded-md text-xs font-bold cursor-pointer text-center leading-none h-[24px] flex items-center justify-center border-0 outline-none select-none"
                  >
                    {isSelected && (
                      <motion.div
                        layoutId="activeCandleDataType"
                        className={`absolute inset-0 rounded-md ${
                          theme === "light"
                            ? "bg-white border border-slate-300 shadow-sm"
                            : "bg-blue-500/10 border border-blue-500/25 shadow-inner"
                        }`}
                        transition={{ type: "spring", stiffness: 380, damping: 30 }}
                        style={{ zIndex: 0 }}
                      />
                    )}
                    <span className={`relative z-10 font-mono text-[10px] sm:text-[11px] whitespace-nowrap transition-colors duration-200 ${
                      isSelected
                        ? theme === "light"
                          ? "text-blue-800 font-black"
                          : "text-blue-400 font-extrabold"
                        : theme === "light"
                          ? "text-slate-600 hover:text-slate-900 font-bold"
                          : "text-slate-400 hover:text-slate-200"
                    }`}>
                      {item.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 7. Chart Compression Select */}
          <div className="shrink-0">
            <span className={`text-[10px] uppercase font-mono tracking-widest font-bold block mb-0.5 ${
              theme === "light" ? "text-slate-600 font-bold" : "text-slate-400/80"
            }`}>
              {language === "EN" ? "Compression" : language === "KZ" ? "Сығылу деңгейі" : "Сжатие графика"}
            </span>
            <select
              value={compressionMultiplier}
              onChange={(e) => setCompressionMultiplier(parseInt(e.target.value))}
              className={`px-3 py-1 rounded-lg text-xs font-bold font-mono cursor-pointer h-[30px] border focus:outline-none transition-all duration-200 outline-none w-full ${
                theme === "light"
                  ? "bg-slate-200 border-slate-300 hover:bg-slate-300 text-slate-800 shadow-sm"
                  : "bg-slate-950/60 border-white/5 text-slate-300 hover:text-slate-100 liquid-glass-button"
              }`}
            >
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((multiplier) => {
                const limits = getActiveGroupLimits();
                const isLocked = multiplier > limits.compressionLevels;
                const isBtc = activePair.symbol.toUpperCase().includes("BTC");
                const baseComp = isBtc 
                  ? (marketType === "FUTURES" ? 25 : 500) 
                  : 25;
                const actualValue = baseComp * multiplier;
                return (
                  <option 
                    key={multiplier} 
                    value={multiplier} 
                    disabled={isLocked}
                    className={theme === "light" ? "bg-white text-slate-900 font-sans" : "bg-slate-950 text-slate-350 font-sans"}
                  >
                    {multiplier}x ({actualValue}){isLocked ? " 🔒 (Уровень закрыт)" : ""}
                  </option>
                );
              })}
            </select>
          </div>

          {/* 8. Indicators Trigger Button */}
          <div className="shrink-0">
            <span className={`text-[10px] uppercase font-mono tracking-widest font-bold block mb-0.5 ${
              theme === "light" ? "text-slate-600 font-bold" : "text-slate-400/80"
            }`}>
              Active Controls
            </span>
            <button
              onClick={() => setIsIndicatorsModalOpen(true)}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-black text-xs cursor-pointer h-[30px] hover:scale-[1.01] active:scale-[0.99] transition-all border ${
                theme === "light"
                  ? "bg-slate-200 hover:bg-slate-300 border-slate-300 text-slate-800 shadow-sm"
                  : "liquid-glass-button text-slate-300 hover:text-slate-100"
              }`}
            >
              <Layers className="w-3.5 h-3.5 text-blue-400 animate-pulse" />
              <span>{language === "EN" ? "Indicators" : language === "KZ" ? "Индикаторлар" : "Индикаторы"}</span>
              <ChevronDown className="w-3 h-3 text-slate-400" />
            </button>
          </div>
      </section>

      {/* MAIN WORKSTATION PANEL: CONTENT VIEWS */}
      {(() => {
        const activeIndicatorsObj = {
          clusterSearch: (indicators.find(i => i.id === "clusterSearch")?.isActive ?? false) && (indicators.find(i => i.id === "clusterSearch")?.isVisible !== false),
          delta: (indicators.find(i => i.id === "delta")?.isActive ?? false) && (indicators.find(i => i.id === "delta")?.isVisible !== false),
          volume: (indicators.find(i => i.id === "volume" || i.id === "volumeProfile")?.isActive ?? false) && (indicators.find(i => i.id === "volume" || i.id === "volumeProfile")?.isVisible !== false),
          volumeOnChart: (indicators.find(i => i.id === "volumeOnChart")?.isActive ?? false) && (indicators.find(i => i.id === "volumeOnChart")?.isVisible !== false),
          cvd: (indicators.find(i => i.id === "cvd")?.isActive ?? false) && (indicators.find(i => i.id === "cvd")?.isVisible !== false),
          stackedImbalance: (indicators.find(i => i.id === "stackedImbalance")?.isActive ?? false) && (indicators.find(i => i.id === "stackedImbalance")?.isVisible !== false)
        };

        const indicatorSettings = {
          clusterSearch: indicators.find(i => i.id === "clusterSearch")?.settings || {},
          volumeProfile: indicators.find(i => i.id === "volumeProfile")?.settings || {},
          delta: indicators.find(i => i.id === "delta")?.settings || {},
          cvd: indicators.find(i => i.id === "cvd")?.settings || {},
          volumeOnChart: indicators.find(i => i.id === "volumeOnChart")?.settings || {},
          stackedImbalance: indicators.find(i => i.id === "stackedImbalance")?.settings || {}
        };

        return (
          <main className="flex-1 flex flex-col min-h-0 bg-transparent select-none relative z-10 p-1 sm:p-2 gap-1 sm:gap-1.5">
            {/* Mobile/Tablet Adaptive View Switcher */}
            <div className={`flex lg:hidden justify-center items-center p-1 rounded-xl w-full max-w-sm mx-auto border transition-all duration-300 shadow-sm shrink-0 select-none ${
              theme === "light"
                ? "bg-slate-200/90 border-slate-300"
                : "bg-slate-950/60 border-white/5"
            }`}>
              <button
                onClick={() => setActiveMobileTab("chart")}
                className={`flex-1 py-1.5 px-4 text-center rounded-lg text-xs font-bold font-sans transition-all duration-200 cursor-pointer ${
                  activeMobileTab === "chart"
                    ? theme === "light"
                      ? "bg-white text-slate-900 border border-slate-300 shadow-sm font-black"
                      : "bg-yellow-500/10 border border-yellow-500/25 text-yellow-500 font-extrabold"
                    : theme === "light"
                      ? "text-slate-600 hover:text-slate-900"
                      : "text-slate-400 hover:text-slate-200"
                }`}
              >
                📊 {language === "RU" ? "График" : language === "KZ" ? "График" : "Chart"}
              </button>
              <button
                onClick={() => setActiveMobileTab("dom")}
                className={`flex-1 py-1.5 px-4 text-center rounded-lg text-xs font-bold font-sans transition-all duration-200 cursor-pointer ${
                  activeMobileTab === "dom"
                    ? theme === "light"
                      ? "bg-white text-slate-900 border border-slate-300 shadow-sm font-black"
                      : "bg-yellow-500/10 border border-yellow-500/25 text-yellow-500 font-extrabold"
                    : theme === "light"
                      ? "text-slate-600 hover:text-slate-900"
                      : "text-slate-400 hover:text-slate-200"
                }`}
              >
                🧱 {language === "RU" ? "Стакан" : language === "KZ" ? "Стакан" : "DOM Ladder"}
              </button>
            </div>

            <div className={`flex-1 flex flex-col lg:flex-row min-h-0 min-w-0 items-stretch font-sans relative ${
              isSidebarCollapsed ? "gap-3 lg:gap-0" : "gap-3 lg:gap-5"
            }`}>
              {/* Left/Middle Column: Footprint Chart Section */}
              <div 
                id="charts-workspace-container"
                className={`flex-1 flex min-h-0 min-w-0 select-none ${
                  workspaceLayout === "2h" ? "flex-row" : workspaceLayout === "2v" ? "flex-col" : "flex-row"
                } ${activeMobileTab === "chart" ? "flex" : "hidden lg:flex"}`}
              >
                {/* CHART 0 CONTAINER */}
                <div
                  onClickCapture={() => {
                    if (activeChartIndex !== 0) setActiveChartIndex(0);
                  }}
                  style={workspaceLayout !== "1" ? {
                    flexGrow: resizeRatio,
                    flexShrink: 1,
                    flexBasis: `${resizeRatio}%`
                  } : undefined}
                  className={`flex flex-col min-h-0 min-w-0 justify-stretch relative ${
                    workspaceLayout === "1" ? "flex-1" : ""
                  } rounded-xl overflow-hidden transition-all duration-150 border-2 ${
                    workspaceLayout !== "1" && activeChartIndex === 0
                      ? theme === "light"
                        ? "border-blue-500 shadow-md shadow-blue-500/5 bg-slate-50/50"
                        : "border-yellow-500/50 shadow-md shadow-yellow-500/5 bg-slate-900/10"
                      : "border-transparent"
                  }`}
                >
                  {/* Active Badge indicator */}
                  {workspaceLayout !== "1" && activeChartIndex === 0 && (
                    <div className="absolute top-2 right-2.5 z-45 bg-yellow-500 text-slate-950 font-sans text-[8px] font-black uppercase px-2 py-0.5 rounded shadow-md tracking-widest leading-none select-none">
                      {language === "RU" ? "Активен" : language === "KZ" ? "Белсенді" : "Active"}
                    </div>
                  )}
                    <ClusterChart
                      candles={candles0}
                      activePair={activePair0}
                      indicators={indicators}
                      activeIndicators={activeIndicatorsObj}
                      indicatorSettings={indicatorSettings}
                      marketType={marketType0}
                      onToggleMarketType={() => setMarketType0(p => p === "SPOT" ? "FUTURES" : "SPOT")}
                      theme={theme}
                      candleType={candleType0}
                      candleDataType={candleDataType0}
                      candlePalette={candlePalette0}
                      onToggleIndicator={(id) => {
                        setIndicators(prev => prev.map(ind => ind.id === id ? { ...ind, isActive: !ind.isActive } : ind));
                      }}
                      onRemoveIndicator={(id) => {
                        setIndicators(prev => prev.map(ind => ind.id === id ? { ...ind, isActive: false } : ind));
                      }}
                      onShowIndicatorsSettings={() => setIsIndicatorsModalOpen(true)}
                      language={language}
                      workspaceLayout={workspaceLayout}
                      onWorkspaceLayoutChange={setWorkspaceLayout}
                      workspacesCount={getActiveGroupLimits().workspacesCount}
                      onLoadMore={handleLoadMore0}
                      isLoadingMore={isLoadingMore0}
                      loadId={loadId0}
                    />
                </div>

                {/* SPLITTER BAR BETWEEN CHART 0 & CHART 1 */}
                {workspaceLayout !== "1" && (
                  <div
                    onMouseDown={handleSplitterMouseDown}
                    onTouchStart={handleSplitterTouchStart}
                    className={`relative flex shrink-0 items-center justify-center transition-all duration-150 group select-none ${
                        workspaceLayout === "2h"
                          ? "w-2.5 hover:w-3 cursor-col-resize h-full mx-1"
                          : "h-2.5 hover:h-3 cursor-row-resize w-full my-1"
                    }`}
                  >
                    {/* The splitter line visual */}
                    <div className={`transition-colors duration-150 rounded-full ${
                      workspaceLayout === "2h"
                        ? "w-[2px] h-3/4 group-hover:bg-yellow-500"
                        : "h-[2px] w-3/4 group-hover:bg-yellow-500"
                    } ${theme === "light" ? "bg-slate-300 animate-pulse" : "bg-slate-800 animate-pulse"}`} />
                    
                    {/* Floating center touch indicator dot */}
                    <div className={`absolute w-1.5 h-1.5 rounded-full transition-transform scale-0 group-hover:scale-100 ${
                      theme === "light" ? "bg-slate-400" : "bg-yellow-500"
                    }`} />
                  </div>
                )}

                {/* CHART 1 CONTAINER */}
                {workspaceLayout !== "1" && (
                  <div
                    onClickCapture={() => {
                      if (activeChartIndex !== 1) setActiveChartIndex(1);
                    }}
                    style={{
                      flexGrow: 100 - resizeRatio,
                      flexShrink: 1,
                      flexBasis: `${100 - resizeRatio}%`
                    }}
                    className={`flex flex-col min-h-0 min-w-0 justify-stretch relative rounded-xl overflow-hidden transition-all duration-150 border-2 ${
                      activeChartIndex === 1
                        ? theme === "light"
                          ? "border-blue-500 shadow-md shadow-blue-500/5 bg-slate-50/50"
                          : "border-yellow-500/50 shadow-md shadow-yellow-500/5 bg-slate-900/10"
                        : "border-transparent"
                    }`}
                  >
                    {/* Active Badge indicator */}
                    {activeChartIndex === 1 && (
                      <div className="absolute top-2 right-2.5 z-45 bg-yellow-500 text-slate-950 font-sans text-[8px] font-black uppercase px-2 py-0.5 rounded shadow-md tracking-widest leading-none select-none">
                        {language === "RU" ? "Активен" : language === "KZ" ? "Белсенді" : "Active"}
                      </div>
                    )}
                    <ClusterChart
                      candles={candles1}
                      activePair={activePair1}
                      indicators={indicators}
                      activeIndicators={activeIndicatorsObj}
                      indicatorSettings={indicatorSettings}
                      marketType={marketType1}
                      onToggleMarketType={() => setMarketType1(p => p === "SPOT" ? "FUTURES" : "SPOT")}
                      theme={theme}
                      candleType={candleType1}
                      candleDataType={candleDataType1}
                      candlePalette={candlePalette1}
                      onToggleIndicator={(id) => {
                        setIndicators(prev => prev.map(ind => ind.id === id ? { ...ind, isActive: !ind.isActive } : ind));
                      }}
                      onRemoveIndicator={(id) => {
                        setIndicators(prev => prev.map(ind => ind.id === id ? { ...ind, isActive: false } : ind));
                      }}
                      onShowIndicatorsSettings={() => setIsIndicatorsModalOpen(true)}
                      language={language}
                      workspaceLayout={workspaceLayout}
                      onWorkspaceLayoutChange={setWorkspaceLayout}
                      workspacesCount={getActiveGroupLimits().workspacesCount}
                      onLoadMore={handleLoadMore1}
                      isLoadingMore={isLoadingMore1}
                      loadId={loadId1}
                    />
                  </div>
                )}
              </div>

              {/* Right Sidebar Column: DOM Sidebar with Interactive Trading */}
              <div className={`relative flex min-h-0 flex-col shrink-0 transition-all duration-300 ease-in-out ${
                isSidebarCollapsed ? "lg:w-0 lg:ml-0" : "w-full lg:w-[380px]"
              } ${
                activeMobileTab === "dom" ? "flex" : "hidden lg:flex"
              }`}>
                {/* Expand / Collapse Button */}
                <button
                  onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
                  className={`hidden lg:flex absolute top-1/2 -translate-y-1/2 z-35 items-center justify-center w-6 h-12 rounded-md border transition-all duration-200 cursor-pointer ${
                    isSidebarCollapsed 
                      ? "-left-3 " + (theme === "light"
                          ? "bg-white hover:bg-slate-50 text-slate-600 border-slate-300 shadow-md hover:text-slate-900"
                          : "bg-slate-900 hover:bg-slate-850 text-slate-400 border-slate-700 shadow-lg hover:text-slate-200")
                      : "-left-3 " + (theme === "light"
                          ? "bg-white hover:bg-slate-50 text-slate-600 border-slate-200 shadow-sm hover:text-slate-900"
                          : "bg-slate-900 hover:bg-slate-850 text-slate-400 border-slate-750/80 hover:text-slate-200")
                  }`}
                  style={{ transform: "translateY(-50%)" }}
                  title={
                    isSidebarCollapsed 
                      ? (language === "RU" ? "Развернуть стакан и индекс" : language === "KZ" ? "Стақанды жаю" : "Expand orderbook & sentiment sidebar")
                      : (language === "RU" ? "Свернуть стакан и индекс" : language === "KZ" ? "Стақанды жинау" : "Collapse orderbook & sentiment sidebar")
                  }
                >
                  {isSidebarCollapsed ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </button>

                <div className={`flex-1 flex flex-col min-h-0 transition-opacity duration-300 ${
                  isSidebarCollapsed ? "lg:opacity-0 lg:pointer-events-none lg:overflow-hidden w-0" : "w-full"
                }`}>
                  <DOMSidebar orderBook={orderBook} activePair={activePair} theme={theme} />
                </div>
              </div>
            </div>
          </main>
        );
      })()}
        </>
      )}

      {/* Dynamic Indicators Customizer Modal */}
      <IndicatorsModal
        isOpen={isIndicatorsModalOpen}
        onClose={() => setIsIndicatorsModalOpen(false)}
        symbol={activePair.symbol}
        indicators={indicators}
        onApply={(updatedIndicators) => setIndicators(updatedIndicators)}
        theme={theme}
      />

      {/* Project Roadmap (BETA) Modal */}
      <RoadmapModal
        isOpen={isRoadmapModalOpen}
        onClose={() => setIsRoadmapModalOpen(false)}
        theme={theme}
        language={language}
      />

      {/* ✈️ REAL-TIME TELEGRAM ALERT BANNER BOX */}
      {indicators.find(i => i.id === "clusterSearch")?.isActive && (
        <div className="fixed bottom-6 right-6 z-[999] max-w-sm w-full flex flex-col gap-3 pointer-events-none">
          <AnimatePresence>
            {telegramAlerts.filter(a => !a.dismissed).slice(0, 3).map((alert) => {
              const isAllowed = userRole === "VIP" || userRole === "Admin";
              
              return (
                <motion.div
                  key={alert.id}
                  initial={{ opacity: 0, y: 30, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, x: 50, scale: 0.95 }}
                  transition={{ type: "spring", stiffness: 350, damping: 25 }}
                  className={`pointer-events-auto rounded-[24px] p-4.5 shadow-2xl border transition-all ${
                    theme === "light"
                      ? "bg-white border-slate-205 text-slate-800 shadow-slate-200/50"
                      : "bg-[#090d16]/95 border-sky-500/20 text-slate-100 shadow-black/80"
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-[12px] animate-bounce">✈️</span>
                      <span className={`text-[10px] font-mono font-black uppercase tracking-wider ${
                        theme === "light" ? "text-sky-700" : "text-sky-400"
                      }`}>
                        {language === "RU" ? "ТГ Увед-Бот" : "Telegram Alert Bot"}
                      </span>
                      {isAllowed ? (
                        <span className="text-[8px] font-extrabold uppercase bg-emerald-500/10 text-emerald-500 px-1.5 py-0.5 rounded border border-emerald-500/25">
                          {userRole}
                        </span>
                      ) : (
                        <span className="text-[8px] font-extrabold uppercase bg-amber-500/10 text-amber-500 px-1.5 py-0.5 rounded border border-amber-500/25">
                          {language === "RU" ? "ЗАБЛОКИРОВАНО (GUEST)" : "LOCKED (GUEST)"}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => {
                        setTelegramAlerts(prev => prev.map(a => a.id === alert.id ? { ...a, dismissed: true } : a));
                      }}
                      className={`text-[11px] font-bold cursor-pointer hover:bg-slate-200/50 hover:text-red-500 p-1 rounded-lg ${
                        theme === "light" ? "text-slate-400" : "text-slate-500 hover:bg-white/5"
                      }`}
                    >
                      ✕
                    </button>
                  </div>

                  {!isAllowed ? (
                    <div className="relative">
                      {/* Blurred teaser message */}
                      <div className="filter blur-[4.5px] select-none opacity-40 text-[10.5px] font-mono leading-relaxed pointer-events-none">
                        🚨 LARGE CLUSTER FILTER: BTC/USD Volume of 1840K detected at price level $67,930! Imbalance: 75% Bid Dominance.
                      </div>
                      <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-1">
                        <span className="text-[11.5px] font-bold text-amber-500 flex items-center gap-1 mb-0.5">
                          🔒 {language === "RU" ? "Только для VIP & Admin" : "Exclusive VIP & Admin Feature"}
                        </span>
                        <p className={`text-[9.5px] leading-snug max-w-[280px] font-medium ${theme === "light" ? "text-slate-500" : "text-slate-405"}`}>
                          {language === "RU" 
                            ? "Выберите роль VIP или Admin в меню профиля сверху справа, чтобы мгновенно включить поток уведомлений в Телеграм."
                            : "Select VIP or Admin as your role in the profile dropdown at the top-right to instantly unlock Telegram alerts streams."}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <p className="text-[10.5px] font-mono font-bold leading-relaxed whitespace-pre-wrap">
                        {alert.message}
                      </p>
                      <div className="mt-2.5 flex items-center justify-between text-[8px] font-mono font-bold text-slate-550">
                        <span>{language === "RU" ? "ОТПРАВЛЕНО В @PROCLUSTER_BOT" : "SENT TO @PROCLUSTER_BOT"}</span>
                        <span>{new Date(alert.timestamp).toLocaleTimeString()}</span>
                      </div>
                    </div>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
