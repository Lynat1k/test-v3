import React, { useState, useEffect, useRef } from "react";
import { CryptoPair } from "../types";
import { 
  X, 
  Play, 
  Pause, 
  AlertTriangle, 
  ArrowUp, 
  ArrowDown, 
  Activity, 
  Trash2, 
  ShieldAlert, 
  Cpu, 
  Check, 
  Zap, 
  DollarSign, 
  RefreshCw, 
  BarChart2, 
  ArrowLeft, 
  Server, 
  HardDrive, 
  Users, 
  Globe, 
  Download, 
  Plus, 
  Calendar, 
  Terminal,
  Settings,
  Edit2,
  Database,
  TrendingUp,
  Radio,
  Wifi,
  Save
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { storage } from "../lib/storage";

interface AdminPanelProps {
  isOpen: boolean;
  onClose: () => void;
  theme: "dark" | "light";
  activePair: CryptoPair;
  pairs: CryptoPair[];
  connectionStatus: "connected" | "syncing" | "stale";
  isTickingAll: boolean;
  onToggleTicking: () => void;
  onSetConnectionStatus: (status: "connected" | "syncing" | "stale") => void;
  onUpdatePairPrice: (symbol: string, newPrice: number) => void;
  onInjectWhaleTrade: (side: "buy" | "sell", amount: number) => void;
  onClearHistory: () => void;
  onApplyAnomaly: (type: "pump" | "dump" | "spike" | "whale-wall") => void;
  marketType: "SPOT" | "FUTURES";
  onSetMarketType: (type: "SPOT" | "FUTURES") => void;
  onAddPair?: (newPair: CryptoPair) => void;
}

interface ClientConnection {
  id: string;
  ip: string;
  geo: string;
  origin: string;
  sub: string;
  status: string;
  ping: number;
}

export default function AdminPanel({
  isOpen,
  onClose,
  theme,
  activePair,
  pairs,
  connectionStatus,
  isTickingAll,
  onToggleTicking,
  onSetConnectionStatus,
  onUpdatePairPrice,
  onInjectWhaleTrade,
  onClearHistory,
  onApplyAnomaly,
  marketType,
  onSetMarketType,
  onAddPair
}: AdminPanelProps) {
  const isLight = theme === "light";

  // Active view tabs
  const [activeTab, setActiveTab] = useState<"server" | "database" | "users" | "stats">("server");

  // State sections
  const [activeTokenParam, setActiveTokenParam] = useState<string>(activePair.symbol);
  const [customPriceInput, setCustomPriceInput] = useState<string>("");
  const [whaleAmountInput, setWhaleAmountInput] = useState<string>("500");
  const [customTickerLogs, setCustomTickerLogs] = useState<string[]>([]);
  
  // Default Chart Compression levels map: { [ticker]: { [timeframe]: multiplier } }
  const [defaultCompressions, setDefaultCompressions] = useState<Record<string, Record<string, number>>>(() => {
    return storage.getJson("procluster_default_compressions", {});
  });

  const [activeCompTicker, setActiveCompTicker] = useState<string>(activePair.symbol);

  // State for user groups / tier settings
  const [selectedGroup, setSelectedGroup] = useState<"guest" | "free" | "pro" | "vip" | "admin" >("guest");
  
  const [tierSettings, setTierSettings] = useState<Record<"guest" | "free" | "pro" | "vip" | "admin", {
    maxHistory: number;
    compressionLevels: number;
    maxIndicators: number;
    customIndicatorSettings: boolean;
    telegramNotifications: boolean;
    historyDays_1m: number;
    historyDays_5m: number;
    historyDays_15m: number;
    historyDays_30m: number;
    historyDays_1h: number;
    historyDays_4h: number;
    workspacesCount: number;
  }>>(() => {
    const defaultSettings = {
      guest: { maxHistory: 700, compressionLevels: 1, maxIndicators: 3, customIndicatorSettings: false, telegramNotifications: false, historyDays_1m: 1, historyDays_5m: 3, historyDays_15m: 7, historyDays_30m: 14, historyDays_1h: 30, historyDays_4h: 90, workspacesCount: 1 },
      free: { maxHistory: 700, compressionLevels: 1, maxIndicators: 3, customIndicatorSettings: false, telegramNotifications: false, historyDays_1m: 1, historyDays_5m: 3, historyDays_15m: 7, historyDays_30m: 14, historyDays_1h: 30, historyDays_4h: 90, workspacesCount: 1 },
      pro: { maxHistory: 1400, compressionLevels: 2, maxIndicators: 5, customIndicatorSettings: true, telegramNotifications: false, historyDays_1m: 3, historyDays_5m: 7, historyDays_15m: 14, historyDays_30m: 30, historyDays_1h: 60, historyDays_4h: 180, workspacesCount: 2 },
      vip: { maxHistory: 10000, compressionLevels: 6, maxIndicators: 15, customIndicatorSettings: true, telegramNotifications: true, historyDays_1m: 7, historyDays_5m: 14, historyDays_15m: 30, historyDays_30m: 60, historyDays_1h: 120, historyDays_4h: 360, workspacesCount: 2 },
      admin: { maxHistory: 10000, compressionLevels: 6, maxIndicators: 99, customIndicatorSettings: true, telegramNotifications: true, historyDays_1m: 14, historyDays_5m: 30, historyDays_15m: 60, historyDays_30m: 120, historyDays_1h: 240, historyDays_4h: 720, workspacesCount: 2 }
    };
    const parsed = storage.getJson<any>("procluster_tier_settings", null);
    if (parsed) {
      for (const k of ["guest", "free", "pro", "vip", "admin"] as const) {
        if (!parsed[k]) {
          parsed[k] = { ...defaultSettings[k] };
        } else {
          parsed[k] = { ...defaultSettings[k], ...parsed[k] };
        }
        const s = parsed[k];
        if (s && typeof s.compressionLevels === "number") {
          s.compressionLevels = Math.min(6, Math.max(1, s.compressionLevels));
        }
      }
      return parsed;
    }
    return defaultSettings;
  });

  const [policySuccessMsg, setPolicySuccessMsg] = useState("");

  const updateTierSetting = (group: "guest" | "free" | "pro" | "vip" | "admin", key: string, value: any) => {
    let sanitizedValue = value;
    if (key === "compressionLevels") {
      sanitizedValue = Math.min(6, Math.max(1, parseInt(value) || 1));
    }
    setTierSettings(prev => {
      const updated = {
        ...prev,
        [group]: {
          ...prev[group],
          [key]: sanitizedValue
        }
      };
      storage.setJson("procluster_tier_settings", updated);
      return updated;
    });
  };

  const handleSavePolicies = (e: React.FormEvent) => {
    e.preventDefault();
    storage.setJson("procluster_tier_settings", tierSettings);
    window.dispatchEvent(new Event("procluster_tier_settings_updated"));
    setPolicySuccessMsg("Политики ограничений успешно сохранены!");
    setTimeout(() => setPolicySuccessMsg(""), 3000);
  };

  // Auto-save default compressions to localStorage separately for Spot and Futures per ticker
  const updateDefaultCompression = (ticker: string, marketSection: "SPOT" | "FUTURES", intervalVal: string, value: number) => {
    setDefaultCompressions(prev => {
      const tickerData = prev[ticker] || {};
      const sectionData = tickerData[marketSection] || {};
      const updated = {
        ...prev,
        [ticker]: {
          ...tickerData,
          [marketSection]: {
            ...sectionData,
            [intervalVal]: value
          }
        }
      };
      storage.setJson("procluster_default_compressions", updated);
      window.dispatchEvent(new Event("procluster_default_comp_changed"));
      return updated;
    });
  };
  
  // Real-time server resource simulator values
  const [cpuUsage, setCpuUsage] = useState<number>(31.4);
  const [ramUsageGB, setRamUsageGB] = useState<number>(6.42);
  const [diskUsageGB, setDiskUsageGB] = useState<number>(184.2);
  const [dbVolumeGB, setDbVolumeGB] = useState<number>(28.45);
  const [diskLoad, setDiskLoad] = useState<number>(14.2);
  
  const [cpuHistory, setCpuHistory] = useState<number[]>(() => Array.from({ length: 25 }, () => 20 + Math.random() * 25));
  const [ramHistory, setRamHistory] = useState<number[]>(() => Array.from({ length: 25 }, () => 5.2 + Math.random() * 1.5));
  const [diskHistory, setDiskHistory] = useState<number[]>(() => Array.from({ length: 25 }, () => 10 + Math.random() * 15));

  const [hostsCount, setHostsCount] = useState<number>(1482);
  const [onlineCount, setOnlineCount] = useState<number>(342);
  const [registeredUsersCount, setRegisteredUsersCount] = useState<number>(12985);

  interface AdminUser {
    id: string;
    nickname: string;
    registerDate: string;
    subscriptionLevel: "free" | "RPO" | "VIP";
    ip: string;
    country: string;
    password?: string;
  }

  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([
    { id: "usr_001", nickname: "@cryptomaster", registerDate: "2026-05-24", subscriptionLevel: "free", ip: "185.220.101.5", country: "Germany 🇩🇪", password: "•••••" },
    { id: "usr_002", nickname: "@whale_hunter", registerDate: "2026-04-12", subscriptionLevel: "VIP", ip: "91.198.174.19", country: "Japan 🇯🇵", password: "•••••" },
    { id: "usr_003", nickname: "@scalper_pro", registerDate: "2026-03-20", subscriptionLevel: "RPO", ip: "104.244.42.1", country: "USA 🇺🇸", password: "•••••" },
    { id: "usr_004", nickname: "@moonwalker", registerDate: "2025-12-14", subscriptionLevel: "free", ip: "8.8.8.8", country: "United Kingdom 🇬🇧", password: "•••••" },
    { id: "usr_005", nickname: "@kzt_trader", registerDate: "2026-02-18", subscriptionLevel: "RPO", ip: "178.90.220.44", country: "Kazakhstan 🇰🇿", password: "•••••" },
  ]);

  // Editing and dynamic additions state for Users Tab
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editNickname, setEditNickname] = useState("");
  const [editLevel, setEditLevel] = useState<"free" | "RPO" | "VIP">("free");

  const [newNickInput, setNewNickInput] = useState("");
  const [newLevelInput, setNewLevelInput] = useState<"free" | "RPO" | "VIP">("free");
  const [newPasswordInput, setNewPasswordInput] = useState("");
  const [userSuccessMsg, setUserSuccessMsg] = useState("");

  // Statistics Billing dataset of paid subscriptions
  interface PaidSubscriptionRecord {
    id: string;
    userId: string;
    nickname: string;
    subscriptionLevel: "RPO" | "VIP";
    status: "active" | "expired" | "waiting"; // активная | закончилась | ожидание
    lastPaidAmount: number; // Стоимость последней оплаченной подписки
    totalSpent: number; // Суммарно потрачено за все время
    paymentDate: string;
  }

  const [paidRecords, setPaidRecords] = useState<PaidSubscriptionRecord[]>(() => {
    return storage.getJson<PaidSubscriptionRecord[]>("procluster_paid_subscriptions", [
      { id: "tx_101", userId: "usr_002", nickname: "@whale_hunter", subscriptionLevel: "VIP", status: "active", lastPaidAmount: 199, totalSpent: 597, paymentDate: "2026-06-10" },
      { id: "tx_102", userId: "usr_003", nickname: "@scalper_pro", subscriptionLevel: "RPO", status: "active", lastPaidAmount: 49, totalSpent: 147, paymentDate: "2026-05-18" },
      { id: "tx_103", userId: "usr_005", nickname: "@kzt_trader", subscriptionLevel: "RPO", status: "waiting", lastPaidAmount: 49, totalSpent: 98, paymentDate: "2026-06-11" },
      { id: "tx_104", userId: "usr_004", nickname: "@moonwalker", subscriptionLevel: "RPO", status: "expired", lastPaidAmount: 49, totalSpent: 49, paymentDate: "2026-02-15" }
    ]);
  });

  // Save billing records to localStorage
  useEffect(() => {
    storage.setJson("procluster_paid_subscriptions", paidRecords);
  }, [paidRecords]);

  // Form states for managing paid transactions inside Statistics Tab
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
  const [editRecUserId, setEditRecUserId] = useState("");
  const [editRecLevel, setEditRecLevel] = useState<"RPO" | "VIP">("RPO");
  const [editRecStatus, setEditRecStatus] = useState<"active" | "expired" | "waiting">("active");
  const [editRecAmount, setEditRecAmount] = useState("49");
  const [editRecTotal, setEditRecTotal] = useState("147");

  // Live connections simulation
  const [clients, setClients] = useState<ClientConnection[]>([
    { id: "usr_208", ip: "185.220.101.5", geo: "Frankfurt, DE", origin: "Web client", sub: "SOL/USDT, BTC/USDT", status: "online", ping: 24 },
    { id: "usr_532", ip: "91.198.174.19", geo: "Tokyo, JP", origin: "Desktop App", sub: "BTC/USDT", status: "online", ping: 112 },
    { id: "usr_401", ip: "104.244.42.1", geo: "New York, USA", origin: "iOS Platform", sub: "ETH/USDT, SOL/USDT", status: "online", ping: 45 },
    { id: "usr_014", ip: "8.8.8.8", geo: "London, UK", origin: "Web client", sub: "ALL_ACTIVE", status: "online", ping: 18 },
    { id: "usr_995", ip: "194.154.20.4", geo: "Lagos, NG", origin: "Android Dev", sub: "SOL/USDT", status: "online", ping: 178 }
  ]);

  // New Ticker Form state
  const [newSymbol, setNewSymbol] = useState("");
  const [newMinTickStepSpot, setNewMinTickStepSpot] = useState("0.01");
  const [newMinTickStepFutures, setNewMinTickStepFutures] = useState("0.1");
  const [compressionSpotVal, setCompressionSpotVal] = useState("2");
  const [compressionFuturesVal, setCompressionFuturesVal] = useState("5");
  
  // Default Chart Compression for Spot and Futures separately
  const [defaultCompSpot, setDefaultCompSpot] = useState<string>(() => {
    return storage.get("procluster_default_comp_spot") || "1";
  });
  const [defaultCompFutures, setDefaultCompFutures] = useState<string>(() => {
    return storage.get("procluster_default_comp_futures") || "5";
  });

  useEffect(() => {
    storage.set("procluster_default_comp_spot", defaultCompSpot);
    window.dispatchEvent(new Event("procluster_default_comp_changed"));
  }, [defaultCompSpot]);

  useEffect(() => {
    storage.set("procluster_default_comp_futures", defaultCompFutures);
    window.dispatchEvent(new Event("procluster_default_comp_changed"));
  }, [defaultCompFutures]);

  const [tickerSuccessMsg, setTickerSuccessMsg] = useState("");
  const [compSuccessMsg, setCompSuccessMsg] = useState("");

  // Historical download state
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [downloadStep, setDownloadStep] = useState<string>("");
  const [histTicker, setHistTicker] = useState<string>(activePair.symbol);
  const [histType, setHistType] = useState<"SPOT" | "FUTURES">("SPOT");
  const [histStartDate, setHistStartDate] = useState<string>("2026-05-01");
  const [histEndDate, setHistEndDate] = useState<string>("2026-05-25");

  // Load default price value
  useEffect(() => {
    setCustomPriceInput(activePair.price.toString());
  }, [activePair.symbol]);

  // Telemetry logs simulation
  useEffect(() => {
    if (!isOpen) return;

    // Seed logs
    setCustomTickerLogs([
      `[System] Панель администратора запущена в режиме full-page`,
      `[Engine] Симулятор запущен: ${activePair.symbol} | Шаг шкалы: ${activePair.priceStep}`,
      `[Telemetry] База данных In-Memory активна. Буфер кадров пуст.`,
      `[Environment] Node.JS v21.4.0 Container Core | Port: 3000 Ingress`,
      `[Database] Запуск проверки консистентности кластеров... OK`
    ]);

    const logUpdateInterval = setInterval(() => {
      const messages = [
        `[Heartbeat] Опрос сетевых хостов. Задержка ПДД: ${Math.floor(22 + Math.random() * 20)}мс`,
        `[Ingress] Получен пакет Binance AggrTrade: ${activePair.symbol} @ $${activePair.price.toLocaleString()}`,
        `[Memory] Сжатие данных свечей завершено. Освобождено ${(1.2 + Math.random() * 0.5).toFixed(2)}Кб`,
        `[GC] Сборщик мусора освободил неиспользуемые ячейки стакана.`,
        `[Client Socket] Синхронизация трансляции глубины стакана для ${onlineCount + Math.floor(Math.random() * 5 - 2)} трейдеров`
      ];
      setCustomTickerLogs(prev => {
        const next = [...prev, messages[Math.floor(Math.random() * messages.length)]];
        return next.slice(-45);
      });
    }, 4500);

    // Smooth resource fluctuate simulator & clients ping changes
    const resourceInterval = setInterval(() => {
      const cpuDelta = (Math.random() - 0.5) * 6;
      const ramDelta = (Math.random() - 0.5) * 0.12;
      const diskDelta = (Math.random() - 0.5) * 4;

      setCpuUsage(prev => {
        const val = Math.min(85, Math.max(8, parseFloat((prev + cpuDelta).toFixed(1))));
        setCpuHistory(history => [...history.slice(1), val]);
        return val;
      });

      setRamUsageGB(prev => {
        const val = Math.min(12, Math.max(4.5, parseFloat((prev + ramDelta).toFixed(2))));
        setRamHistory(history => [...history.slice(1), val]);
        return val;
      });

      setDiskLoad(prev => {
        const val = Math.min(80, Math.max(5, parseFloat((prev + diskDelta).toFixed(1))));
        setDiskHistory(history => [...history.slice(1), val]);
        return val;
      });

      setDbVolumeGB(prev => {
        const delta = Math.random() * 0.0015;
        return parseFloat((prev + delta).toFixed(4));
      });

      setHostsCount(prev => prev + (Math.random() > 0.55 ? 1 : Math.random() < 0.45 ? -1 : 0));
      setOnlineCount(prev => {
        const ch = Math.floor((Math.random() - 0.5) * 4);
        return Math.min(500, Math.max(120, prev + ch));
      });

      // Fluctuate pings
      setClients(current => 
        current.map(c => ({
          ...c,
          ping: Math.max(5, Math.min(300, c.ping + Math.floor((Math.random() - 0.5) * 12)))
        }))
      );
    }, 2500);

    return () => {
      clearInterval(logUpdateInterval);
      clearInterval(resourceInterval);
    };
  }, [isOpen, activePair.symbol, onlineCount]);

  // scroll logs to end
  const logsEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (logsEndRef.current && activeTab === "server") {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [customTickerLogs, activeTab]);

  if (!isOpen) return null;

  // Actions
  const handleApplyPriceChange = () => {
    const nextVal = parseFloat(customPriceInput);
    if (!isNaN(nextVal) && nextVal > 0) {
      onUpdatePairPrice(activeTokenParam, nextVal);
      setCustomTickerLogs(prev => [
        ...prev, 
        `[Core Override] Администратор принудительно установил курс для ${activeTokenParam}: $${nextVal.toLocaleString()}`
      ]);
    }
  };

  const handleClear = () => {
    onClearHistory();
    setCustomTickerLogs(prev => [
      ...prev,
      `[Engine Flash] Историческая память котировок и графиков полностью стерта.`
    ]);
  };

  // Binance vision downloader simulator
  const handleDownloadBinanceVision = () => {
    if (downloadProgress !== null) return;
    setDownloadProgress(0);
    setDownloadStep("1/5 Подключение к Binance Vision CDN (data.binance.vision)...");
    
    const messages = [
      { progress: 15, text: "2/5 Получение метаданных агрегированных сделок Spot/Futures..." },
      { progress: 42, text: `3/5 Загрузка архива ${histTicker.replace("/", "")}-aggTrades-${histStartDate}-to-${histEndDate}.zip...` },
      { progress: 78, text: "4/5 Распаковка CSV и парсинг потока миллисекундных сделок Binance..." },
      { progress: 95, text: "5/5 Слияние агрегатов во внутреннюю структуру ячеек footprint..." },
      { progress: 100, text: `Успешно импортировано за секунды! Загружено исторических тиков.` }
    ];

    let i = 0;
    const interval = setInterval(() => {
      if (i < messages.length) {
        const currentMsg = messages[i];
        setDownloadProgress(currentMsg.progress);
        setDownloadStep(currentMsg.text);
        
        setCustomTickerLogs(prev => [
          ...prev,
          `[Binance Vision] ${currentMsg.text} (${currentMsg.progress}%)`
        ]);
        i++;
      } else {
        clearInterval(interval);
        setTimeout(() => {
          setDownloadProgress(null);
          setDownloadStep("");
        }, 3000);
      }
    }, 1200);
  };

  // Add Dynamic Ticker Form
  const handleAddNewTicker = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSymbol) {
      alert("Заполните базовые поля!");
      return;
    }

    const priceNum = 100.0;
    const defaultName = newSymbol.trim().split("/")[0] || newSymbol.trim();
    const tickStepSpotNum = parseFloat(newMinTickStepSpot);
    const tickStepFuturesNum = parseFloat(newMinTickStepFutures);
    const compSpot = parseInt(compressionSpotVal) || 2;
    const compFut = parseInt(compressionFuturesVal) || 5;

    const addedPair: CryptoPair = {
      symbol: newSymbol.toUpperCase().trim(),
      name: defaultName,
      price: priceNum,
      change24h: 0.0,
      volume24h: 0,
      delta24h: 0.0,
      priceStep: 1,
      compressionSpot: compSpot,
      compressionFutures: compFut,
      minTickStepSpot: isNaN(tickStepSpotNum) || tickStepSpotNum <= 0 ? 0.01 : tickStepSpotNum,
      minTickStepFutures: isNaN(tickStepFuturesNum) || tickStepFuturesNum <= 0 ? 0.1 : tickStepFuturesNum
    };

    if (onAddPair) {
      onAddPair(addedPair);
      setTickerSuccessMsg(`Тикер ${addedPair.symbol} успешно зарегистрирован! Сжатие Spot: ${compSpot}x, Futures: ${compFut}x`);
      setCustomTickerLogs(prev => [
        ...prev,
        `[Admin] Добавлен новый торговый инструмент: ${addedPair.symbol} | Сжатие Spot: ${compSpot}x, Futures: ${compFut}x`
      ]);
      
      // Reset form
      setNewSymbol("");
      setNewMinTickStepSpot("0.01");
      setNewMinTickStepFutures("0.1");
      setTimeout(() => setTickerSuccessMsg(""), 505);
    } else {
      alert("Система динамических тикеров не подключена!");
    }
  };

  return (
    <div className={`flex-1 flex flex-col min-h-0 relative z-40 overflow-y-auto ${
      isLight ? "bg-slate-50 text-slate-900" : "bg-[#060813] text-slate-100"
    } p-6 gap-6 font-sans select-none`}>
      
      {/* HEADER SECTION TOOLBAR */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-500/10 shrink-0">
        <div className="flex items-center gap-4">
          <button
            onClick={onClose}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border cursor-pointer hover:scale-102 active:scale-98 transition ${
              isLight 
                ? "bg-white border-slate-200 text-slate-700 hover:bg-slate-50 shadow-sm" 
                : "bg-slate-900 border-white/5 text-slate-300 hover:text-white hover:bg-slate-800"
            }`}
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Вернуться на Терминал</span>
          </button>
          
          <div className="h-5 w-px bg-slate-500/20 hidden sm:block" />
          
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-black uppercase tracking-wider flex items-center gap-2">
              <Settings className="w-5 h-5 text-red-500 animate-spin-slow animate-spin" />
              Панель Администратора
            </h1>
            <span className={`text-[9px] px-2 py-0.5 rounded-md font-mono font-black ${
              isLight ? "bg-red-50 text-red-700 border border-red-200" : "bg-red-500/10 text-red-400 border border-red-500/15"
            }`}>
              CORE MODE
            </span>
          </div>
        </div>
      </div>

      {/* DYNAMIC TAB CONTROLS */}
      <div className="flex border-b border-slate-500/15 gap-2 pb-px shrink-0">
        <button
          onClick={() => setActiveTab("server")}
          className={`px-5 py-2.5 rounded-t-xl text-xs font-bold tracking-wider uppercase flex items-center gap-2 border-t-2 border-x transition-all duration-150 cursor-pointer ${
            activeTab === "server"
              ? isLight
                ? "bg-white border-t-blue-500 border-x-slate-200 text-slate-900 shadow-sm" 
                : "bg-slate-900 border-t-blue-500 border-x-white/5 text-white"
              : isLight
                ? "bg-transparent border-t-transparent border-x-transparent text-slate-600 hover:bg-slate-200/40 hover:text-slate-800"
                : "bg-transparent border-t-transparent border-x-transparent text-slate-400 hover:bg-white/[0.02] hover:text-white"
          }`}
        >
          <Cpu className="w-4 h-4 text-blue-500" />
          <span>Сервер</span>
        </button>

        <button
          onClick={() => setActiveTab("database")}
          className={`px-5 py-2.5 rounded-t-xl text-xs font-bold tracking-wider uppercase flex items-center gap-2 border-t-2 border-x transition-all duration-150 cursor-pointer ${
            activeTab === "database"
              ? isLight
                ? "bg-white border-t-emerald-500 border-x-slate-200 text-slate-900 shadow-sm" 
                : "bg-slate-900 border-t-emerald-500 border-x-white/5 text-white"
              : isLight
                ? "bg-transparent border-t-transparent border-x-transparent text-slate-600 hover:bg-slate-200/40 hover:text-slate-800"
                : "bg-transparent border-t-transparent border-x-transparent text-slate-400 hover:bg-white/[0.02] hover:text-white"
          }`}
        >
          <Database className="w-4 h-4 text-emerald-500" />
          <span>База Данных</span>
        </button>

        <button
          onClick={() => setActiveTab("users")}
          className={`px-5 py-2.5 rounded-t-xl text-xs font-bold tracking-wider uppercase flex items-center gap-2 border-t-2 border-x transition-all duration-150 cursor-pointer ${
            activeTab === "users"
              ? isLight
                ? "bg-white border-t-amber-500 border-x-slate-200 text-slate-900 shadow-sm" 
                : "bg-slate-900 border-t-amber-500 border-x-white/5 text-white"
              : isLight
                ? "bg-transparent border-t-transparent border-x-transparent text-slate-600 hover:bg-slate-200/40 hover:text-slate-800"
                : "bg-transparent border-t-transparent border-x-transparent text-slate-400 hover:bg-white/[0.02] hover:text-white"
          }`}
        >
          <Users className="w-4 h-4 text-amber-500" />
          <span>Пользователи</span>
        </button>

        <button
          onClick={() => setActiveTab("stats")}
          className={`px-5 py-2.5 rounded-t-xl text-xs font-bold tracking-wider uppercase flex items-center gap-2 border-t-2 border-x transition-all duration-150 cursor-pointer ${
            activeTab === "stats"
              ? isLight
                ? "bg-white border-t-purple-500 border-x-slate-200 text-slate-900 shadow-sm" 
                : "bg-slate-900 border-t-purple-500 border-x-white/5 text-white"
              : isLight
                ? "bg-transparent border-t-transparent border-x-transparent text-slate-600 hover:bg-slate-200/40 hover:text-slate-800"
                : "bg-transparent border-t-transparent border-x-transparent text-slate-400 hover:bg-white/[0.02] hover:text-white"
          }`}
        >
          <BarChart2 className="w-4 h-4 text-purple-500" />
          <span>Статистика</span>
        </button>
      </div>

      {/* RENDER ACTIVE TAB */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -5 }}
          transition={{ duration: 0.15 }}
          className="flex-1 flex flex-col gap-6 min-h-0"
        >
          
          {/* TAB 1: SERVER CONTROLS & MONITORING */}
          {activeTab === "server" && (
            <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-6 min-h-0">
              
              {/* SERVER METRICS COL (LEFT HALF) */}
              <div className={`p-5 rounded-2xl border flex flex-col gap-4 ${
                isLight ? "bg-white border-slate-200" : "liquid-glass-card"
              }`}>
                <h3 className="text-xs font-bold font-mono text-slate-400 flex items-center gap-2 justify-start uppercase shrink-0">
                  <Cpu className="w-4 h-4 text-slate-400 animate-pulse" /> Мониторинг ресурсов & Спецификации веб-сервера
                </h3>
                
                <div className="flex-1 flex flex-col gap-4 lg:min-h-0 justify-between">
                  
                  {/* --- CARD 1: CPU GRAPH --- */}
                  <div className={`flex-1 min-h-[145px] p-3 rounded-xl border flex flex-col justify-between gap-2.5 transition-all ${
                    isLight ? "bg-slate-50/70 border-slate-200" : "bg-white/[0.01] border-white/5"
                  }`}>
                    <div className="flex justify-between items-center text-xs">
                      <span className={`font-bold flex items-center gap-1.5 ${isLight ? "text-slate-800" : "text-white"}`}>
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping" />
                        <span>Нагрузка Процессора (CPU)</span>
                      </span>
                      <span className={`font-mono font-bold ${isLight ? "text-amber-600" : "text-amber-500"}`}>{cpuUsage}%</span>
                    </div>
                    
                    <div className={`h-2 w-full ${isLight ? "bg-slate-200" : "bg-slate-900"} rounded-full overflow-hidden`}>
                      <div 
                        className="h-full bg-amber-500 transition-all duration-300"
                        style={{ width: `${cpuUsage}%` }}
                      />
                    </div>
                    
                    <div className={`text-[10px] ${isLight ? "text-slate-600" : "text-slate-400"} font-mono flex justify-between`}>
                      <span>VM Core 8x Threads</span>
                      <span>Частота: 3.40 GHz</span>
                    </div>

                    {/* CPU Chart View */}
                    <div className="flex flex-col gap-1 min-h-0">
                      <span className={`text-[9px] ${isLight ? "text-slate-550" : "text-slate-400"} font-mono uppercase tracking-wider`}>График загрузки CPU (30 сек)</span>
                      {(() => {
                        const width = 300;
                        const height = 48;
                        const points = cpuHistory.map((val, idx) => {
                           const x = idx * (width / (cpuHistory.length - 1 || 1));
                           const y = height - (val / 100) * (height - 8) - 4;
                           return { x, y };
                        });
                        const pathD = points.map((p, idx) => `${idx === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
                        const areaD = `${pathD} L ${width} ${height} L 0 ${height} Z`;
                        return (
                          <div className={`h-14 w-full ${isLight ? "bg-slate-100/80" : "bg-black/30"} rounded-lg p-1.5 border ${isLight ? "border-slate-300/40" : "border-white/[0.02]"}`}>
                            <svg className="w-full h-full" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
                              <defs>
                                <linearGradient id="cpuGrad" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.25" />
                                  <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.0" />
                                </linearGradient>
                              </defs>
                              <line x1="0" y1={height * 0.5} x2={width} y2={height * 0.5} stroke="currentColor" className={isLight ? "text-slate-400/20" : "text-white/[0.03]"} strokeDasharray="3 3" />
                              <path d={areaD} fill="url(#cpuGrad)" />
                              <path d={pathD} fill="none" stroke="#f59e0b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                              {points.length > 0 && <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r="2" fill="#f59e0b" />}
                            </svg>
                          </div>
                        );
                      })()}
                    </div>
                  </div>

                  {/* --- CARD 2: RAM GRAPH WITH ALL BUSY SERVER MEMORY --- */}
                  <div className={`flex-1 min-h-[145px] p-3 rounded-xl border flex flex-col justify-between gap-2.5 transition-all ${
                    isLight ? "bg-slate-50/70 border-slate-200" : "bg-white/[0.01] border-white/5"
                  }`}>
                    <div className="flex justify-between items-center text-xs">
                      <span className={`font-bold flex items-center gap-1.5 ${isLight ? "text-slate-800" : "text-white"}`}>
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        <span>Вся занятая память сервера (RAM)</span>
                      </span>
                      <span className={`font-mono font-bold ${isLight ? "text-emerald-600" : "text-emerald-500"}`}>{ramUsageGB.toFixed(2)} GB / 16.0 GB</span>
                    </div>
                    
                    <div className={`h-2 w-full ${isLight ? "bg-slate-200" : "bg-slate-900"} rounded-full overflow-hidden`}>
                      <div 
                        className="h-full bg-emerald-500 transition-all duration-350"
                        style={{ width: `${(ramUsageGB / 16) * 100}%` }}
                      />
                    </div>
                    
                    <div className={`text-[10px] ${isLight ? "text-slate-600" : "text-slate-400"} font-mono flex justify-between`}>
                      <span>Использование памяти процессами Node</span>
                      <span>Свободно: {(16 - ramUsageGB).toFixed(2)} GB</span>
                    </div>

                    {/* RAM Chart View */}
                    <div className="flex flex-col gap-1 min-h-0">
                      <span className={`text-[9px] ${isLight ? "text-slate-500" : "text-slate-400"} font-mono uppercase tracking-wider`}>График загрузки ОЗУ (RAM)</span>
                      {(() => {
                        const width = 300;
                        const height = 48;
                        const points = ramHistory.map((val, idx) => {
                           const x = idx * (width / (ramHistory.length - 1 || 1));
                           const y = height - (val / 16) * (height - 8) - 4;
                           return { x, y };
                        });
                        const pathD = points.map((p, idx) => `${idx === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
                        const areaD = `${pathD} L ${width} ${height} L 0 ${height} Z`;
                        return (
                          <div className={`h-14 w-full ${isLight ? "bg-slate-100/80" : "bg-black/30"} rounded-lg p-1.5 border ${isLight ? "border-slate-300/40" : "border-white/[0.02]"}`}>
                            <svg className="w-full h-full" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
                              <defs>
                                <linearGradient id="ramGrad" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="0%" stopColor="#10b981" stopOpacity="0.25" />
                                  <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
                                </linearGradient>
                              </defs>
                              <line x1="0" y1={height * 0.5} x2={width} y2={height * 0.5} stroke="currentColor" className={isLight ? "text-slate-400/20" : "text-white/[0.03]"} strokeDasharray="3 3" />
                              <path d={areaD} fill="url(#ramGrad)" />
                              <path d={pathD} fill="none" stroke="#10b981" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                              {points.length > 0 && <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r="2" fill="#10b981" />}
                            </svg>
                          </div>
                        );
                      })()}
                    </div>
                  </div>

                  {/* --- CARD 3: DISK GRAPH & DATABASE VOLUME --- */}
                  <div className={`flex-1 min-h-[145px] p-3 rounded-xl border flex flex-col justify-between gap-2.5 transition-all ${
                    isLight ? "bg-slate-50/70 border-slate-200" : "bg-white/[0.01] border-white/5"
                  }`}>
                    <div className="flex justify-between items-center text-xs">
                      <span className={`font-semibold flex items-center gap-1.5 ${isLight ? "text-slate-800" : "text-white"}`}>
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                        <span>Нагрузка Диска & Объем Базы Данных</span>
                      </span>
                      <span className={`font-mono font-bold ${isLight ? "text-blue-600" : "text-blue-400"}`}>{diskLoad.toFixed(1)}%</span>
                    </div>
                    
                    <div className={`h-2 w-full ${isLight ? "bg-slate-200" : "bg-slate-900"} rounded-full overflow-hidden`}>
                      <div 
                        className="h-full bg-blue-500 transition-all duration-300"
                        style={{ width: `${diskLoad}%` }}
                      />
                    </div>
                    
                    <div className={`text-[10px] ${isLight ? "text-slate-600" : "text-slate-400"} font-mono flex justify-between`}>
                      <span className={`${isLight ? "text-blue-700 font-bold" : "text-blue-400 font-semibold"}`}>Объём Базы Данных: {dbVolumeGB.toFixed(4)} GB</span>
                      <span>SSD NVMe RAID</span>
                    </div>

                    {/* Disk Chart View */}
                    <div className="flex flex-col gap-1 min-h-0">
                      <span className={`text-[9px] ${isLight ? "text-slate-550" : "text-slate-400"} font-mono uppercase tracking-wider`}>График нагрузки на диск (I/O)</span>
                      {(() => {
                        const width = 300;
                        const height = 48;
                        const points = diskHistory.map((val, idx) => {
                           const x = idx * (width / (diskHistory.length - 1 || 1));
                           const y = height - (val / 100) * (height - 8) - 4;
                           return { x, y };
                        });
                        const pathD = points.map((p, idx) => `${idx === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
                        const areaD = `${pathD} L ${width} ${height} L 0 ${height} Z`;
                        return (
                          <div className={`h-14 w-full ${isLight ? "bg-slate-100/80" : "bg-black/30"} rounded-lg p-1.5 border ${isLight ? "border-slate-300/40" : "border-white/[0.02]"}`}>
                            <svg className="w-full h-full" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
                              <defs>
                                <linearGradient id="diskGrad" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.25" />
                                  <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.0" />
                                </linearGradient>
                              </defs>
                              <line x1="0" y1={height * 0.5} x2={width} y2={height * 0.5} stroke="currentColor" className={isLight ? "text-slate-400/20" : "text-white/[0.03]"} strokeDasharray="3 3" />
                              <path d={areaD} fill="url(#diskGrad)" />
                              <path d={pathD} fill="none" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                              {points.length > 0 && <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r="2" fill="#3b82f6" />}
                            </svg>
                          </div>
                        );
                      })()}
                    </div>
                  </div>

                </div>
              </div>

              {/* SERVER TERMINAL DIAGNOSTICS LOGS CONSOLE */}
              <div className={`flex-1 flex flex-col min-h-[400px] lg:min-h-0 rounded-2xl p-5 border gap-3 ${
                isLight ? "bg-white border-slate-200" : "liquid-glass-card"
              }`}>
                <div className="flex justify-between items-center text-xs">
                  <span className="font-extrabold tracking-wider font-mono text-slate-500 flex items-center gap-2 uppercase">
                    <Terminal className="w-4 h-4 text-slate-400" />
                    Логи Диагностики & Симуляции Терминала
                  </span>
                  <span className="font-mono text-[10px] bg-red-500/15 border border-red-500/15 text-red-400 px-2.5 py-0.5 rounded-full animate-pulse">
                    LIVE TELEMETRY
                  </span>
                </div>

                <div className={`flex-1 min-h-[220px] rounded-xl p-4 font-mono text-[10.5px] overflow-y-auto leading-relaxed border select-text shadow-inner ${
                  isLight 
                    ? "bg-slate-900 text-slate-200 border-slate-300" 
                    : "bg-[#02050e] text-[#00ff66] border-white/5"
                }`}>
                  <div className="flex flex-col gap-1.5">
                    {customTickerLogs.map((log, index) => (
                      <div key={index} className="flex gap-2.5 hover:bg-white/5 py-0.5 px-1.5 rounded transition-colors duration-100">
                        <span className="text-slate-500 shrink-0 select-none">[{index + 1}]</span>
                        <span className="whitespace-pre-wrap">{log}</span>
                      </div>
                    ))}
                    <div ref={logsEndRef} />
                  </div>
                </div>

                <div className="flex justify-between items-center text-[10px] text-slate-500 font-mono">
                  <span>ОБРАБОТКА ПОТОКА: 125,482 TICKS/SEC</span>
                  <span>ОЗУ БУФЕРА: INGRESS COMPACT</span>
                </div>
              </div>

            </div>
          )}

          {/* TAB 2: DATABASE COINS, PRICE SETTING, SCRAPING HISTORICAL DATA */}
          {activeTab === "database" && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 min-h-0 w-full items-start">
              
              {/* BOX 1: ADD COIN & SET GRIDS */}
              <div className={`p-5 rounded-2xl border flex flex-col gap-4 ${
                isLight ? "bg-white border-slate-200 shadow-sm" : "liquid-glass-card"
              }`}>
                <h3 className={`text-sm font-black uppercase tracking-wider flex items-center gap-2 ${
                  isLight ? "text-emerald-700" : "text-emerald-500"
                }`}>
                  <Plus className="w-4 h-4" />
                  Добавление и Сжатие Новых Монет
                </h3>
                <p className={`text-xs leading-relaxed ${
                  isLight ? "text-slate-600 font-medium" : "text-slate-400"
                }`}>
                  Внесите в систему новые рыночные активы. Также укажите степень сжатия цен стакана для Spot (в базовых пунктах) и Futures (в усредненных интервалах объемов).
                </p>

                {tickerSuccessMsg && (
                  <div className={`p-3 rounded-xl text-xs font-bold border ${
                    isLight 
                      ? "bg-emerald-50 border-emerald-200 text-emerald-850" 
                      : "bg-emerald-500/10 border-emerald-500/25 text-emerald-400"
                  }`}>
                    {tickerSuccessMsg}
                  </div>
                )}

                <form onSubmit={handleAddNewTicker} className="flex flex-col gap-3.5 text-xs font-sans">
                  <div>
                    <label className={`text-[10px] font-mono font-bold block mb-1 uppercase ${
                      isLight ? "text-slate-700" : "text-slate-400"
                    }`}>Символ Токена (Например: SOL/USDT)</label>
                    <input
                      type="text"
                      required
                      placeholder="SOL/USDT"
                      value={newSymbol}
                      onChange={(e) => setNewSymbol(e.target.value)}
                      className={`w-full text-xs font-mono font-bold rounded-lg px-3 py-2 border shadow-inner transition-colors ${
                        isLight 
                          ? "bg-slate-50 border-slate-300 text-slate-900 focus:bg-white focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500" 
                          : "bg-slate-900 border-white/5 text-white focus:border-emerald-500"
                      }`}
                    />
                  </div>

                  <div>
                    <label className={`text-[10px] font-mono font-bold block mb-1 uppercase ${
                      isLight ? "text-slate-700" : "text-slate-400"
                    }`}>Минимальный Шаг Тика SPOT (Tick Size)</label>
                    <input
                      type="number"
                      step="any"
                      required
                      placeholder="0.01"
                      value={newMinTickStepSpot}
                      onChange={(e) => setNewMinTickStepSpot(e.target.value)}
                      className={`w-full text-xs font-mono font-bold rounded-lg px-3 py-2 border shadow-inner transition-colors ${
                        isLight 
                          ? "bg-slate-50 border-slate-300 text-slate-900 focus:bg-white focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500" 
                          : "bg-slate-900 border-white/10 text-white focus:border-emerald-500"
                      }`}
                    />
                  </div>

                  <div>
                    <label className={`text-[10px] font-mono font-bold block mb-1 uppercase ${
                      isLight ? "text-slate-700" : "text-slate-400"
                    }`}>Минимальный Шаг Тика FUTURES (Tick Size)</label>
                    <input
                      type="number"
                      step="any"
                      required
                      placeholder="0.1"
                      value={newMinTickStepFutures}
                      onChange={(e) => setNewMinTickStepFutures(e.target.value)}
                      className={`w-full text-xs font-mono font-bold rounded-lg px-3 py-2 border shadow-inner transition-colors ${
                        isLight 
                          ? "bg-slate-50 border-slate-300 text-slate-900 focus:bg-white focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500" 
                          : "bg-slate-900 border-white/10 text-white focus:border-emerald-500"
                      }`}
                    />
                  </div>

                  <div className={`p-3 rounded-lg border flex flex-col gap-1 ${
                    isLight ? "bg-blue-50/70 border-blue-200" : "bg-blue-500/5 border-blue-500/10"
                  }`}>
                    <span className={`text-[10px] font-mono font-bold uppercase block tracking-wider mb-2 ${
                      isLight ? "text-blue-700" : "text-blue-400"
                    }`}>Настройки Степени Сжатия</span>
                    
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className={`text-[9.5px] font-[600] block mb-1 ${
                          isLight ? "text-slate-700" : "text-slate-400"
                        }`}>Сжатие Spot Данных</label>
                        <input
                          type="number"
                          min="1"
                          max="200"
                          value={compressionSpotVal}
                          onChange={(e) => setCompressionSpotVal(e.target.value)}
                          className={`w-full text-xs font-mono font-bold rounded-lg px-3 py-2 border shadow-inner transition-colors ${
                            isLight 
                              ? "bg-slate-50 border-slate-300 text-slate-900 focus:bg-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500" 
                              : "bg-slate-900 border-white/10 text-white focus:border-blue-500"
                          }`}
                        />
                      </div>

                      <div>
                        <label className={`text-[9.5px] font-[600] block mb-1 ${
                          isLight ? "text-slate-700" : "text-slate-400"
                        }`}>Сжатие Futures Данных</label>
                        <input
                          type="number"
                          min="1"
                          max="500"
                          value={compressionFuturesVal}
                          onChange={(e) => setCompressionFuturesVal(e.target.value)}
                          className={`w-full text-xs font-mono font-bold rounded-lg px-3 py-2 border shadow-inner transition-colors ${
                            isLight 
                              ? "bg-slate-50 border-slate-300 text-slate-900 focus:bg-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500" 
                              : "bg-slate-900 border-white/10 text-white focus:border-blue-500"
                          }`}
                        />
                      </div>
                    </div>
                  </div>

                  <button
                    type="submit"
                    className={`w-full px-4 py-2.5 rounded-xl font-black transition tracking-wide text-xs flex items-center justify-center gap-2 cursor-pointer ${
                      isLight 
                        ? "bg-emerald-600 hover:bg-emerald-700 text-white shadow" 
                        : "bg-emerald-500 text-slate-950 hover:bg-emerald-600"
                    }`}
                  >
                    <Plus className="w-4 h-4" />
                    Зарегистрировать Тикер в Реестре
                  </button>
                </form>
              </div>

              {/* DEFAULT CHART COMPRESSIONS BY TICKER AND TIMEFRAME */}
              <div className={`p-5 rounded-2xl border flex flex-col gap-4 ${
                isLight ? "bg-white border-slate-200 shadow-sm" : "liquid-glass-card"
              }`}>
                <h3 className={`text-sm font-black uppercase tracking-wider flex items-center gap-2 ${
                  isLight ? "text-blue-700" : "text-blue-500"
                }`}>
                  <BarChart2 className="w-4 h-4" />
                  Сжатие графика по умолчанию
                </h3>
                <p className={`text-xs leading-relaxed ${
                  isLight ? "text-slate-600 font-medium" : "text-slate-400"
                }`}>
                  Настройте множитель сжатия по умолчанию для любой комбинации торговой пары и таймфрейма. Эти значения автоматически применятся при переключении графиков на терминале.
                </p>

                <div className="flex flex-col gap-4 font-sans text-xs">
                  <div className="flex flex-col gap-1 pb-2 border-b border-dashed border-slate-200/60 dark:border-white/5">
                    <label className={`text-[10px] font-mono font-bold block mb-1 uppercase ${
                      isLight ? "text-slate-700" : "text-slate-400"
                    }`}>Выберите Торговую Пару для настройки</label>
                    <select
                      value={activeCompTicker}
                      onChange={(e) => setActiveCompTicker(e.target.value)}
                      className={`w-full text-xs font-mono font-bold rounded-lg px-3 py-2 border shadow-inner transition-colors ${
                        isLight 
                          ? "bg-slate-50 border-slate-300 text-slate-900 focus:bg-white" 
                          : "bg-slate-900 border-white/10 text-white focus:border-blue-500/50"
                      }`}
                    >
                      {pairs.map(p => (
                        <option key={p.symbol} value={p.symbol}>{p.symbol}</option>
                      ))}
                    </select>
                  </div>

                  {/* FUTURES settings */}
                  <div className={`p-4 rounded-xl border flex flex-col gap-3 ${
                    isLight ? "bg-slate-50/50 border-slate-200" : "bg-white/[0.02] border-white/5"
                  }`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[11px] font-mono font-black uppercase tracking-wider text-amber-500">
                        🟡 FUTURES Сжатие по умолчанию
                      </span>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-2">
                      {["1m", "5m", "15m", "30m", "1h", "4h"].map((intervalVal) => {
                        const currentVal = defaultCompressions[activeCompTicker]?.FUTURES?.[intervalVal] !== undefined
                          ? defaultCompressions[activeCompTicker].FUTURES[intervalVal]
                          : (defaultCompressions[activeCompTicker]?.[intervalVal] !== undefined && typeof defaultCompressions[activeCompTicker]?.[intervalVal] === "number"
                            ? defaultCompressions[activeCompTicker][intervalVal]
                            : 5);
                        return (
                          <div key={intervalVal} className={`flex items-center justify-between gap-1 px-2.5 py-1.5 rounded-lg border ${
                            isLight ? "bg-white border-slate-200/65 shadow-sm" : "bg-slate-900/60 border-white/5"
                          }`}>
                            <span className="font-mono font-black text-xs text-slate-400 uppercase">{intervalVal}</span>
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                min="1"
                                max="500"
                                value={currentVal}
                                onChange={(e) => {
                                  const parsedInput = Math.max(1, parseInt(e.target.value) || 1);
                                  updateDefaultCompression(activeCompTicker, "FUTURES", intervalVal, parsedInput);
                                }}
                                className={`w-11 text-center text-xs font-mono font-bold rounded px-1.5 py-0.5 border transition-all focus:outline-none ${
                                  isLight 
                                    ? "bg-slate-50 border-slate-300 text-slate-900 focus:bg-white focus:border-amber-500 focus:ring-1 focus:ring-amber-500" 
                                    : "bg-slate-950 border-white/10 text-white focus:border-amber-500"
                                }`}
                              />
                              <span className="text-[10px] text-slate-400 font-bold font-mono">x</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* SPOT settings */}
                  <div className={`p-4 rounded-xl border flex flex-col gap-3 ${
                    isLight ? "bg-slate-50/50 border-slate-200" : "bg-white/[0.02] border-white/5"
                  }`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[11px] font-mono font-black uppercase tracking-wider text-emerald-500">
                        🟢 SPOT Сжатие по умолчанию
                      </span>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-2">
                      {["15m", "30m", "1h", "4h"].map((intervalVal) => {
                        const currentVal = defaultCompressions[activeCompTicker]?.SPOT?.[intervalVal] !== undefined
                          ? defaultCompressions[activeCompTicker].SPOT[intervalVal]
                          : (defaultCompressions[activeCompTicker]?.[intervalVal] !== undefined && typeof defaultCompressions[activeCompTicker]?.[intervalVal] === "number"
                            ? defaultCompressions[activeCompTicker][intervalVal]
                            : 1);
                        return (
                          <div key={intervalVal} className={`flex items-center justify-between gap-1 px-2.5 py-1.5 rounded-lg border ${
                            isLight ? "bg-white border-slate-200/65 shadow-sm" : "bg-slate-900/60 border-white/5"
                          }`}>
                            <span className="font-mono font-black text-xs text-slate-400 uppercase">{intervalVal}</span>
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                min="1"
                                max="500"
                                value={currentVal}
                                onChange={(e) => {
                                  const parsedInput = Math.max(1, parseInt(e.target.value) || 1);
                                  updateDefaultCompression(activeCompTicker, "SPOT", intervalVal, parsedInput);
                                }}
                                className={`w-11 text-center text-xs font-mono font-bold rounded px-1.5 py-0.5 border transition-all focus:outline-none ${
                                  isLight 
                                    ? "bg-slate-50 border-slate-300 text-slate-900 focus:bg-white focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500" 
                                    : "bg-slate-950 border-white/10 text-white focus:border-emerald-500"
                                }`}
                              />
                              <span className="text-[10px] text-slate-400 font-bold font-mono">x</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Save Button for default compressions */}
                  <div className="flex flex-col items-stretch gap-3 pt-2">
                    <button
                      onClick={() => {
                        storage.setJson("procluster_default_compressions", defaultCompressions);
                        window.dispatchEvent(new Event("procluster_default_comp_changed"));
                        setCompSuccessMsg("Настройки сжатия успешно сохранены!");
                        setTimeout(() => setCompSuccessMsg(""), 3000);
                      }}
                      className={`w-full px-5 py-2.5 rounded-xl font-bold transition tracking-wide text-xs flex items-center justify-center gap-1.5 cursor-pointer shadow-sm ${
                        isLight 
                          ? "bg-amber-600 hover:bg-amber-700 text-white shadow-amber-600/10" 
                          : "bg-amber-500/20 border border-amber-500/30 text-amber-500 hover:bg-amber-500/30"
                      }`}
                    >
                      <Save className="w-4 h-4" />
                      Сохранить Настройки Сжатия
                    </button>

                    {compSuccessMsg && (
                      <span className="text-xs text-emerald-500 text-center font-bold font-sans animate-pulse">
                        ✓ {compSuccessMsg}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* BINANCE VISION CDN DOWNLOADER */}
              <div className={`p-5 rounded-2xl border flex flex-col gap-4 ${
                isLight ? "bg-white border-slate-200 shadow-sm" : "liquid-glass-card"
              }`}>
                <h3 className={`text-sm font-black uppercase tracking-wider flex items-center gap-2 ${
                  isLight ? "text-amber-700" : "text-yellow-500"
                }`}>
                  <Download className="w-4 h-4" />
                  Загрузка исторических данных (Binance Vision)
                </h3>
                <p className={`text-xs leading-relaxed ${
                  isLight ? "text-slate-600 font-medium" : "text-slate-400"
                }`}>
                  Импортируйте сырой массив агрегированных сделок (zip format) напрямую из архивов <code className="text-blue-500 font-bold">data.binance.vision</code>.
                </p>

                <div className="flex flex-col gap-3.5 text-xs font-sans">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className={`text-[9px] font-mono font-bold block mb-1 ${
                        isLight ? "text-slate-700" : "text-slate-500"
                      }`}>ТИКЕР</label>
                      <select
                        value={histTicker}
                        onChange={(e) => setHistTicker(e.target.value)}
                        className={`w-full text-xs font-mono font-bold rounded-lg px-2.5 py-1.5 border ${
                          isLight ? "bg-slate-50 border-slate-300 text-slate-900" : "bg-slate-900 border-white/10 text-white"
                        }`}
                      >
                        {pairs.map(p => (
                          <option key={p.symbol} value={p.symbol}>{p.symbol}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className={`text-[9px] font-mono font-bold block mb-1 ${
                        isLight ? "text-slate-700" : "text-slate-500"
                      }`}>СЕГМЕНТ</label>
                      <select
                        value={histType}
                        onChange={(e) => setHistType(e.target.value as any)}
                        className={`w-full text-xs font-mono font-bold rounded-lg px-2.5 py-1.5 border ${
                          isLight ? "bg-slate-50 border-slate-300 text-slate-900" : "bg-slate-900 border-white/10 text-white"
                        }`}
                      >
                        <option value="SPOT">SPOT (Сделки)</option>
                        <option value="FUTURES">FUTURES (USD-M)</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className={`text-[9px] font-mono font-bold block mb-1 ${
                        isLight ? "text-slate-700" : "text-slate-500"
                      }`}>С (Начало диапазона)</label>
                      <input
                        type="date"
                        value={histStartDate}
                        onChange={(e) => setHistStartDate(e.target.value)}
                        className={`w-full text-xs font-mono rounded-lg px-2.5 py-1.5 border ${
                          isLight ? "bg-slate-50 border-slate-300 text-slate-900" : "bg-slate-900 border-white/10 text-white"
                        }`}
                      />
                    </div>

                    <div>
                      <label className={`text-[9px] font-mono font-bold block mb-1 ${
                        isLight ? "text-slate-700" : "text-slate-500"
                      }`}>По (Конец диапазона)</label>
                      <input
                        type="date"
                        value={histEndDate}
                        onChange={(e) => setHistEndDate(e.target.value)}
                        className={`w-full text-xs font-mono rounded-lg px-2.5 py-1.5 border ${
                          isLight ? "bg-slate-50 border-slate-300 text-slate-900" : "bg-slate-900 border-white/10 text-white"
                        }`}
                      />
                    </div>
                  </div>

                  {/* Progress reporting UI */}
                  {downloadProgress !== null && (
                    <div className={`p-3 rounded-xl border flex flex-col gap-2 ${
                      isLight ? "bg-blue-50/70 border-blue-200" : "bg-blue-500/5 border-blue-500/10"
                    }`}>
                      <div className="flex justify-between text-[10px] font-mono font-bold">
                        <span className={isLight ? "text-blue-800" : "text-blue-400"}>Импорт Прогресс:</span>
                        <span className={isLight ? "text-blue-850" : "text-blue-400"}>{downloadProgress}%</span>
                      </div>
                      <div className={`h-1.5 w-full ${isLight ? "bg-slate-200" : "bg-slate-900"} rounded-full overflow-hidden`}>
                        <div 
                          className="h-full bg-blue-500 transition-all duration-300"
                          style={{ width: `${downloadProgress}%` }}
                        />
                      </div>
                      <span className={`text-[10px] font-mono italic block truncate ${
                        isLight ? "text-slate-700" : "text-slate-400"
                      }`}>{downloadStep}</span>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={handleDownloadBinanceVision}
                    disabled={downloadProgress !== null}
                    className={`py-2.5 px-3.5 rounded-xl text-center font-black text-xs flex items-center justify-center gap-1.5 transition cursor-pointer ${
                      downloadProgress !== null 
                        ? (isLight ? "bg-slate-200 text-slate-400 cursor-not-allowed" : "bg-slate-800 text-slate-500 cursor-not-allowed border border-white/5") 
                        : (isLight ? "bg-amber-600 hover:bg-amber-700 text-white shadow shadow-amber-600/10" : "bg-amber-500 text-slate-950 hover:bg-amber-600")
                    }`}
                  >
                    <Download className="w-3.5 h-3.5" />
                    Скачать zip-агрегаты и сжать в Footprint
                  </button>
                </div>
              </div>

            </div>
          )}

          {/* TAB 3: USERS & ACTIVE CLIENT WEBSOCKET STREAMS */}
          {activeTab === "users" && (
            <div className="flex-1 flex flex-col gap-6 min-h-0">
              
              {/* METRICS ROW */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {/* 1. Host Counter */}
                <div className={`p-4 rounded-xl border flex items-center gap-4 ${
                  isLight ? "bg-white border-slate-200/85 shadow-sm" : "liquid-glass-card"
                }`}>
                  <div className={`p-3 rounded-lg ${isLight ? "bg-blue-100 text-blue-700 shadow-sm border border-blue-200/30" : "bg-blue-500/10 text-blue-500"}`}>
                    <Globe className="w-6 h-6 animate-spin-slow" />
                  </div>
                  <div>
                    <span className={`text-[10px] font-mono font-extrabold block uppercase ${isLight ? "text-slate-500" : "text-slate-400"}`}>Хостов на сайте</span>
                    <div className="text-lg font-black tracking-tight flex items-center gap-2">
                      <span>{hostsCount.toLocaleString()}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 font-mono font-black rounded ${isLight ? "bg-emerald-600 text-white shadow-sm" : "text-emerald-500 bg-emerald-500/10 border border-emerald-500/20"}`}>LIVE</span>
                    </div>
                    <span className={`text-[9.5px] ${isLight ? "text-slate-600 font-medium" : "text-slate-455"}`}>Идентификация узлов по CDN</span>
                  </div>
                </div>

                {/* 2. Licensed / Registered Users */}
                <div className={`p-4 rounded-xl border flex items-center gap-4 ${
                  isLight ? "bg-white border-slate-200/80 shadow-sm" : "liquid-glass-card"
                }`}>
                  <div className={`p-3 rounded-lg ${isLight ? "bg-amber-100 text-amber-800 shadow-sm border border-amber-200/30" : "bg-yellow-500/10 text-yellow-500"}`}>
                    <Users className="w-6 h-6 animate-pulse" />
                  </div>
                  <div>
                    <span className={`text-[10px] font-mono font-extrabold block uppercase ${isLight ? "text-slate-500" : "text-slate-400"}`}>Зарегистрировано</span>
                    <div className="text-lg font-black tracking-tight">{registeredUsersCount.toLocaleString()}</div>
                    <span className={`text-[9.5px] ${isLight ? "text-emerald-700 font-bold" : "text-slate-455"}`}>+15 новых за сегодня</span>
                  </div>
                </div>

                {/* 3. Real-time Users Online */}
                <div className={`p-4 rounded-xl border flex items-center gap-4 ${
                  isLight ? "bg-white border-slate-200/80 shadow-sm" : "liquid-glass-card"
                }`}>
                  <div className={`p-3 rounded-lg ${isLight ? "bg-emerald-100 text-emerald-800 shadow-sm border border-emerald-200/30" : "bg-emerald-500/10 text-emerald-500"}`}>
                    <Activity className="w-6 h-6" />
                  </div>
                  <div>
                    <span className={`text-[10px] font-mono font-extrabold block uppercase ${isLight ? "text-slate-500" : "text-slate-400"}`}>Пользователей ОНЛАЙН</span>
                    <div className="text-lg font-black tracking-tight flex items-center gap-2">
                      <span>{onlineCount}</span>
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping inline-block" />
                    </div>
                    <span className={`text-[9.5px] font-sans ${isLight ? "text-slate-600 font-medium" : "text-slate-455"}`}>Прямое WebSocket соединение</span>
                  </div>
                </div>
              </div>

              {/* CONFIGURATION OF SUBSCRIPTION TIERS / POLICY POLICIES */}
              <div className={`p-5 rounded-2xl border flex flex-col gap-4 ${
                isLight ? "bg-white border-slate-200 shadow-sm" : "liquid-glass-card"
              }`}>
                <div className="flex flex-wrap justify-between items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Settings className="w-5 h-5 text-indigo-505 animate-spin-slow animate-spin" />
                    <div>
                      <h3 className={`text-sm font-black uppercase tracking-wider ${isLight ? "text-slate-800" : "text-white"}`}>
                        Настройки Лимитов & Политик Групп (Guest, Free, Pro, VIP, Admin)
                      </h3>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Управление правами доступа, лимитами истории, рендером и оповещениями для учетных записей
                      </p>
                    </div>
                  </div>
                  
                  {policySuccessMsg && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="text-[10px] font-mono font-black uppercase bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 px-3 py-1 rounded-full flex items-center gap-1.5 shadow"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>{policySuccessMsg}</span>
                    </motion.div>
                  )}
                </div>

                {/* TABS FOR EVERY TIER */}
                <div className={`flex flex-wrap gap-1.5 p-1 rounded-xl ${
                  isLight ? "bg-slate-100 border border-slate-200/80 shadow-inner" : "bg-slate-950/20 border border-white/5"
                }`}>
                  {(["guest", "free", "pro", "vip", "admin"] as const).map((g) => {
                    const isActive = selectedGroup === g;

                    return (
                      <button
                        key={g}
                        type="button"
                        onClick={() => setSelectedGroup(g)}
                        className={`flex-1 py-2 px-3 rounded-lg text-xs font-black uppercase tracking-wider cursor-pointer transition border ${
                          isActive 
                            ? g === "guest" ? (isLight ? "bg-purple-600 text-white shadow-md border-purple-700" : "bg-purple-550/15 border-purple-500 text-purple-300") :
                              g === "free" ? (isLight ? "bg-slate-600 text-white shadow-md border-slate-700" : "bg-slate-500/15 border-slate-400 text-slate-300") :
                              g === "pro" ? (isLight ? "bg-blue-600 text-white shadow-md border-blue-700" : "bg-blue-500/15 border-blue-500 text-blue-300") :
                              g === "vip" ? (isLight ? "bg-amber-600 text-white shadow-md border-amber-700" : "bg-amber-500/15 border-amber-500 text-amber-400") :
                              (isLight ? "bg-rose-600 text-white shadow-md border-rose-700" : "bg-rose-500/15 border-rose-500 text-rose-300")
                            : isLight ? "bg-white border-slate-300/80 text-slate-700 hover:text-slate-900 hover:bg-slate-50 shadow-sm font-extrabold" : "bg-transparent border-transparent text-slate-400 hover:bg-white/[0.02]"
                        }`}
                      >
                        {g === "guest" && "GUEST ГОСТЬ"}
                        {g === "free" && "FREE тариф"}
                        {g === "pro" && "PRO тариф"}
                        {g === "vip" && "VIP тариф"}
                        {g === "admin" && "ADMIN права"}
                      </button>
                    );
                  })}
                </div>

                {/* FORM CONTROLS FOR THE CHOSEN TIER */}
                <form onSubmit={handleSavePolicies} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 font-sans mt-2">
                  
                  {/* METRIC 1: MAX CHART HISTORY IN DAYS FOR 6 TIMEFRAMES */}
                  <div className={`p-4 rounded-xl border flex flex-col justify-between gap-3 md:col-span-2 lg:col-span-3 ${
                    isLight ? "bg-slate-50 border-slate-200" : "bg-white/[0.02] border-white/5"
                  }`}>
                    <div>
                      <span className={`text-[10px] font-mono font-black uppercase block tracking-wider ${isLight ? "text-slate-600" : "text-slate-300"}`}>
                        1. Максимальная история графика (в днях, по таймфреймам)
                      </span>
                      <p className="text-[10.5px] text-slate-400 mt-1 leading-snug">
                        Лимит отображаемой истории свечей в днях для каждого из 6 таймфреймов.
                      </p>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3.5 mt-2">
                      {(["1m", "5m", "15m", "30m", "1h", "4h"] as const).map(tf => {
                        const key = `historyDays_${tf}` as const;
                        return (
                          <div key={tf} className="flex flex-col gap-1">
                            <span className={`text-[10px] font-mono font-bold uppercase ${isLight ? "text-amber-800" : "text-amber-500"}`}>{tf}</span>
                            <div className="flex items-center gap-1.5">
                              <input
                                type="number"
                                min="1"
                                max="10000"
                                value={tierSettings[selectedGroup][key] ?? 1}
                                onChange={(e) => updateTierSetting(selectedGroup, key, parseInt(e.target.value) || 1)}
                                className={`w-full rounded-lg px-2.5 py-1.5 font-mono font-black text-xs border ${
                                  isLight ? "bg-white border-slate-300 text-slate-900" : "bg-slate-950 border-white/10 text-white"
                                }}`}
                              />
                              <span className="text-[9px] font-mono text-slate-450">дн.</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* METRIC 2: COMPRESSION LEVELS */}
                  <div className={`p-4 rounded-xl border flex flex-col justify-between gap-3 ${
                    isLight ? "bg-slate-50 border-slate-200" : "bg-white/[0.02] border-white/5"
                  }`}>
                    <div>
                      <span className={`text-[10px] font-mono font-black uppercase block tracking-wider ${isLight ? "text-slate-600" : "text-slate-300"}`}>
                        2. Уровней сжатия графика
                      </span>
                      <p className="text-[10.5px] text-slate-400 mt-1 leading-snug">
                        Допустимое количество шагов кластеризации стакана/свечей.
                      </p>
                    </div>

                    <div className="flex flex-col gap-2 mt-2">
                      <div className="flex items-center gap-3">
                        <input
                          type="range"
                          min="1"
                          max="6"
                          value={tierSettings[selectedGroup].compressionLevels}
                          onChange={(e) => updateTierSetting(selectedGroup, "compressionLevels", parseInt(e.target.value) || 1)}
                          className={`w-full h-1.5 rounded-full appearance-none cursor-pointer ${
                            isLight ? "bg-slate-300 accent-blue-600" : "bg-slate-800 accent-blue-500"
                          }`}
                        />
                        <span className={`text-xs font-mono font-black shrink-0 select-none min-w-[32px] text-center ${isLight ? "text-amber-800" : "text-amber-500"}`}>
                          {tierSettings[selectedGroup].compressionLevels}x
                        </span>
                      </div>
                      
                      <div className="flex gap-1 flex-wrap">
                        {[1, 2, 3, 4, 5, 6].map(val => (
                          <button
                            type="button"
                            key={val}
                            onClick={() => updateTierSetting(selectedGroup, "compressionLevels", val)}
                            className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold border transition ${
                              tierSettings[selectedGroup].compressionLevels === val
                                ? "bg-blue-500/15 border-blue-500 text-blue-400"
                                : isLight ? "bg-white hover:bg-slate-100 border-slate-200 text-slate-600 shadow-sm" : "bg-slate-900 hover:bg-slate-800 border-white/5 text-slate-400"
                            }`}
                          >
                            {val}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* METRIC 3: MAX INDICATORS */}
                  <div className={`p-4 rounded-xl border flex flex-col justify-between gap-3 ${
                    isLight ? "bg-slate-50 border-slate-200" : "bg-white/[0.02] border-white/5"
                  }`}>
                    <div>
                      <span className={`text-[10px] font-mono font-black uppercase block tracking-wider ${isLight ? "text-slate-600" : "text-slate-300"}`}>
                        3. Индикаторов на графике
                      </span>
                      <p className="text-[10.5px] text-slate-400 mt-1 leading-snug">
                        Максимальный лимит оверлейных индикаторов в терминале.
                      </p>
                    </div>

                    <div className="flex flex-col gap-2 mt-2">
                      <div className="flex items-center gap-3">
                        <input
                          type="number"
                          min="1"
                          max="20"
                          value={tierSettings[selectedGroup].maxIndicators}
                          onChange={(e) => updateTierSetting(selectedGroup, "maxIndicators", parseInt(e.target.value) || 2)}
                          className={`w-full max-w-[90px] rounded-lg px-3 py-1.5 font-mono font-black text-xs border ${
                            isLight ? "bg-white border-slate-300 text-slate-900" : "bg-slate-950 border-white/10 text-white"
                          }`}
                        />
                        <span className={`text-[11px] font-mono font-bold ${isLight ? "text-teal-700 font-extrabold" : "text-teal-400"}`}>активных</span>
                      </div>
                      
                      <div className="flex gap-1 flex-wrap">
                        {[2, 3, 5, 10, 20].map(val => (
                          <button
                            type="button"
                            key={val}
                            onClick={() => updateTierSetting(selectedGroup, "maxIndicators", val)}
                            className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold border transition ${
                              tierSettings[selectedGroup].maxIndicators === val
                                ? "bg-blue-500/15 border-blue-500 text-blue-400"
                                : isLight ? "bg-white hover:bg-slate-100 border-slate-200 text-slate-600 shadow-sm" : "bg-slate-900 hover:bg-slate-800 border-white/5 text-slate-400"
                            }`}
                          >
                            {val}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* CHECKBOX 1: USE CUSTOM INDICATOR SETTINGS */}
                  <div className={`p-4 rounded-xl border flex flex-col justify-between gap-3 ${
                    isLight ? "bg-slate-50 border-slate-200" : "bg-white/[0.02] border-white/5"
                  }`}>
                    <div>
                      <span className={`text-[10px] font-mono font-black uppercase block tracking-wider ${isLight ? "text-slate-600" : "text-slate-300"}`}>
                        4. Кастомные настройки индикаторов
                      </span>
                      <p className="text-[10.5px] text-slate-400 mt-1 leading-snug">
                        Использование своих уникальных настроек и конфигурационных пресетов для индикаторов.
                      </p>
                    </div>

                    <label className="flex items-center gap-2.5 cursor-pointer mt-2 select-none">
                      <input
                        type="checkbox"
                        checked={tierSettings[selectedGroup].customIndicatorSettings}
                        onChange={(e) => updateTierSetting(selectedGroup, "customIndicatorSettings", e.target.checked)}
                        className={`w-4 h-4 rounded focus:ring-blue-500 focus:ring-2 cursor-pointer ${
                          isLight ? "bg-white border-slate-300 text-blue-600" : "bg-slate-900 border-white/10 text-blue-500"
                        }`}
                      />
                      <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-400">
                        {tierSettings[selectedGroup].customIndicatorSettings ? "РАЗРЕШЕНО (ACTIVE)" : "ЗАБЛОКИРОВАНО"}
                      </span>
                    </label>
                  </div>

                  {/* CHECKBOX 2: TG NOTIFICATIONS */}
                  <div className={`p-4 rounded-xl border flex flex-col justify-between gap-3 ${
                    isLight ? "bg-slate-50 border-slate-200" : "bg-white/[0.02] border-white/5"
                  }`}>
                    <div>
                      <span className={`text-[10px] font-mono font-black uppercase block tracking-wider ${isLight ? "text-slate-600" : "text-slate-300"}`}>
                        5. Телеграм-уведомления (Cluster Search)
                      </span>
                      <p className="text-[10.5px] text-slate-400 mt-1 leading-snug">
                        Уведомления в Telegram о фильтрациях в реальном времени в инструменте Cluster Search.
                      </p>
                    </div>

                    <label className="flex items-center gap-2.5 cursor-pointer mt-2 select-none">
                      <input
                        type="checkbox"
                        checked={tierSettings[selectedGroup].telegramNotifications}
                        onChange={(e) => updateTierSetting(selectedGroup, "telegramNotifications", e.target.checked)}
                        className={`w-4 h-4 rounded focus:ring-blue-500 focus:ring-2 cursor-pointer ${
                          isLight ? "bg-white border-slate-300 text-blue-600" : "bg-slate-900 border-white/10 text-blue-500"
                        }`}
                      />
                      <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-400">
                        {tierSettings[selectedGroup].telegramNotifications ? "ВКЛЮЧЕНО (TELEGRAM)" : "ОТКЛЮЧЕНО"}
                      </span>
                    </label>
                  </div>

                  {/* METRIC 6: WORKSPACES */}
                  <div className={`p-4 rounded-xl border flex flex-col justify-between gap-3 ${
                    isLight ? "bg-slate-50 border-slate-200" : "bg-white/[0.02] border-white/5"
                  }`}>
                    <div>
                      <span className={`text-[10px] font-mono font-black uppercase block tracking-wider ${isLight ? "text-slate-600" : "text-slate-300"}`}>
                        6. Рабочие пространства (Workspaces)
                      </span>
                      <p className="text-[10.5px] text-slate-400 mt-1 leading-snug">
                        Допустимое количество одновременно открытых рабочих пространств.
                      </p>
                    </div>

                    <div className="flex gap-2.5 mt-2">
                      {[1, 2].map(val => (
                        <button
                          type="button"
                          key={val}
                          onClick={() => updateTierSetting(selectedGroup, "workspacesCount", val)}
                          className={`flex-1 py-1.5 rounded-lg text-xs font-bold border transition ${
                            tierSettings[selectedGroup].workspacesCount === val
                              ? "bg-blue-500/15 border-blue-500 text-blue-400"
                              : isLight ? "bg-white hover:bg-slate-100 border-slate-200 text-slate-600 shadow-sm" : "bg-slate-900 hover:bg-slate-800 border-white/5 text-slate-400"
                          }`}
                        >
                          {val} {val === 1 ? "пространство" : "пространства"}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* SAVE BUTTON FOR ALL POLICIES */}
                  <div className="flex items-end justify-start">
                    <button
                      type="submit"
                      className={`w-full py-3 px-4 rounded-xl font-black uppercase tracking-wider text-xs flex items-center justify-center gap-2 cursor-pointer border transition-transform duration-200 hover:scale-[1.01] active:scale-[0.99] ${
                        isLight 
                          ? "bg-indigo-600 hover:bg-indigo-700 text-white border-indigo-700 shadow-md shadow-indigo-600/10" 
                          : "bg-indigo-500/10 hover:bg-indigo-500/20 border-indigo-500/30 text-indigo-400"
                      }`}
                    >
                      <Check className="w-4 h-4" />
                      Сохранить все лимиты
                    </button>
                  </div>

                </form>
              </div>

              {/* REGISTERED USERS MANAGEMENT PANEL */}
              <div className={`p-5 rounded-2xl border flex flex-col gap-4 ${
                isLight ? "bg-white border-slate-200 shadow-sm" : "liquid-glass-card"
              }`}>
                <div className="flex flex-wrap justify-between items-center gap-4">
                  <h3 className="text-sm font-bold font-mono text-slate-455 flex items-center gap-2 uppercase">
                    <Users className="w-4 h-4 text-emerald-500" />
                    Список и Управление Пользователями
                  </h3>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[9px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                      DATABASE REPLICATED
                    </span>
                  </div>
                </div>

                {/* ADD NEW USER FORM */}
                <div className={`p-4 rounded-xl border flex flex-col gap-3 font-sans ${
                  isLight ? "bg-slate-50 border-slate-200" : "bg-slate-900/40 border-white/10"
                }`}>
                  <h4 className="text-xs font-bold tracking-wider uppercase text-slate-400">Добавить нового пользователя</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <input
                        type="text"
                        placeholder="Никнейм (e.g. @pro_trader)"
                        value={newNickInput}
                        onChange={(e) => setNewNickInput(e.target.value)}
                        className={`text-xs w-full rounded-lg px-2.5 py-1.5 focus:outline-none border ${
                          isLight ? "bg-white border-slate-300 text-slate-900" : "bg-slate-950 border-white/5 text-slate-100"
                        }`}
                      />
                    </div>
                    <div>
                      <input
                        type="password"
                        placeholder="Пароль"
                        value={newPasswordInput}
                        onChange={(e) => setNewPasswordInput(e.target.value)}
                        className={`text-xs w-full rounded-lg px-2.5 py-1.5 focus:outline-none border ${
                          isLight ? "bg-white border-slate-300 text-slate-900" : "bg-slate-950 border-white/5 text-slate-101"
                        }`}
                      />
                    </div>
                    <div>
                      <select
                        value={newLevelInput}
                        onChange={(e) => setNewLevelInput(e.target.value as any)}
                        className={`text-xs w-full rounded-lg px-2.5 py-1.5 focus:outline-none border ${
                          isLight ? "bg-white border-slate-300 text-slate-900" : "bg-slate-950 border-white/5 text-slate-101"
                        }`}
                      >
                        <option value="free">free (Бесплатный)</option>
                        <option value="RPO">RPO (Профессионал)</option>
                        <option value="VIP">VIP (Привилегированный)</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex justify-between items-center mt-1">
                    <button
                      onClick={() => {
                        if (!newNickInput) return;
                        const defaultIp = `${Math.floor(Math.random() * 200 + 40)}.${Math.floor(Math.random() * 205 + 10)}.${Math.floor(Math.random() * 240 + 10)}.${Math.floor(Math.random() * 240 + 10)}`;
                        const defaultCountry = "Kazakhstan 🇰🇿";
                        const registerDate = new Date().toISOString().split("T")[0];
                        const newUser: AdminUser = {
                          id: `usr_${Math.floor(Math.random() * 900 + 100)}`,
                          nickname: newNickInput.startsWith("@") ? newNickInput : "@" + newNickInput,
                          registerDate,
                          subscriptionLevel: newLevelInput,
                          ip: defaultIp,
                          country: defaultCountry,
                          password: newPasswordInput || "•••••"
                        };
                        setAdminUsers(prev => [newUser, ...prev]);
                        setRegisteredUsersCount(prev => prev + 1);
                        setNewNickInput("");
                        setNewPasswordInput("");
                        setUserSuccessMsg("Пользователь успешно зарегистрирован!");
                        setTimeout(() => setUserSuccessMsg(""), 3000);
                      }}
                      className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold font-sans cursor-pointer flex items-center gap-1.5 active:scale-95 transition-all"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Добавить пользователя
                    </button>
                    {userSuccessMsg && (
                      <span className="text-emerald-500 text-[11px] font-bold animate-pulse">{userSuccessMsg}</span>
                    )}
                  </div>
                </div>

                {/* INLINE EDITING CONTAINER */}
                {editingUserId && (
                  <div className={`p-4 rounded-xl border flex flex-col gap-3 font-sans ${
                    isLight ? "bg-amber-100/40 border-amber-300" : "bg-yellow-500/5 border-yellow-500/15"
                  }`}>
                    <h4 className="text-xs font-bold tracking-wider uppercase text-yellow-500">Редактировать учетную запись #{editingUserId}</h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] text-slate-400 block uppercase mb-1">Никнейм</label>
                        <input
                          type="text"
                          value={editNickname}
                          onChange={(e) => setEditNickname(e.target.value)}
                          className={`text-xs w-full rounded px-2.5 py-1.5 focus:outline-none border ${
                            isLight ? "bg-white border-slate-300 text-slate-900" : "bg-slate-950 border-white/5 text-slate-100"
                          }`}
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-400 block uppercase mb-1">Уровень Подписки</label>
                        <select
                          value={editLevel}
                          onChange={(e) => setEditLevel(e.target.value as any)}
                          className={`text-xs w-full rounded px-2.5 py-1.5 focus:outline-none border ${
                            isLight ? "bg-white border-slate-300 text-slate-900" : "bg-slate-950 border-white/5 text-slate-100"
                          }`}
                        >
                          <option value="free">free</option>
                          <option value="RPO">RPO</option>
                          <option value="VIP">VIP</option>
                        </select>
                      </div>
                    </div>
                    <div className="flex gap-2 justify-end mt-1">
                      <button
                        onClick={() => {
                          setEditingUserId(null);
                        }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer font-sans transition-all ${
                          isLight ? "bg-slate-200 hover:bg-slate-300 text-slate-700" : "bg-slate-900 hover:bg-slate-800 text-slate-350"
                        }`}
                      >
                        Отмена
                      </button>
                      <button
                        onClick={() => {
                          setAdminUsers(prev => prev.map(u => u.id === editingUserId ? { ...u, nickname: editNickname, subscriptionLevel: editLevel } : u));
                          setEditingUserId(null);
                          setUserSuccessMsg("Успешно изменено!");
                          setTimeout(() => setUserSuccessMsg(""), 3000);
                        }}
                        className="px-3.5 py-1.5 rounded-lg bg-yellow-600 hover:bg-yellow-500 text-slate-950 font-extrabold text-xs font-sans cursor-pointer active:scale-95 transition-all"
                      >
                        Сохранить изменения
                      </button>
                    </div>
                  </div>
                )}

                {/* USER MANAGEMENT TABLE */}
                <div className="overflow-x-auto">
                  <table className="w-full text-left font-sans text-xs border-collapse">
                    <thead>
                      <tr className={`border-b text-[10px] font-mono ${
                        isLight ? "border-slate-200 text-slate-600 font-extrabold" : "border-white/5 text-slate-400"
                      }`}>
                        <th className="py-2.5 px-3">Идентификатор</th>
                        <th className="py-2.5 px-3">Никнейм</th>
                        <th className="py-2.5 px-3">Уровень</th>
                        <th className="py-2.5 px-3">IP-адрес</th>
                        <th className="py-2.5 px-3">Страна</th>
                        <th className="py-2.5 px-3">Дата регистрации</th>
                        <th className="py-2.5 px-3 text-right">Действия</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-500/5 font-mono">
                      {adminUsers.map(user => (
                        <tr key={user.id} className={`hover:bg-slate-500/5 transition-colors ${
                          isLight ? "text-slate-800" : "text-slate-200"
                        }`}>
                          <td className="py-3 px-3 font-semibold text-slate-550">{user.id}</td>
                          <td className="py-3 px-3 font-bold text-amber-500">{user.nickname}</td>
                          <td className="py-3 px-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-black tracking-wider uppercase border ${
                              user.subscriptionLevel === "free"
                                ? isLight ? "bg-slate-100 border-slate-300 text-slate-600" : "bg-slate-900 border-white/5 text-slate-400"
                                : user.subscriptionLevel === "RPO"
                                ? isLight ? "bg-orange-50 border-orange-300 text-orange-700" : "bg-orange-500/10 border-orange-500/25 text-orange-400"
                                : isLight ? "bg-yellow-50 border-yellow-300 text-yellow-850" : "bg-yellow-500/10 border-yellow-500/25 text-yellow-450 font-bold"
                            }`}>
                              {user.subscriptionLevel}
                            </span>
                          </td>
                          <td className="py-3 px-3">{user.ip}</td>
                          <td className="py-3 px-3 font-sans">{user.country}</td>
                          <td className="py-3 px-3 text-slate-400">{user.registerDate}</td>
                          <td className="py-3 px-3 text-right">
                            <div className="flex items-center gap-2 justify-end">
                              <button
                                onClick={() => {
                                  setEditingUserId(user.id);
                                  setEditNickname(user.nickname);
                                  setEditLevel(user.subscriptionLevel);
                                }}
                                className="p-1 rounded bg-blue-500/15 text-blue-400 hover:text-blue-300 cursor-pointer active:scale-95 transition-all"
                                title="Редактировать профиль"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => {
                                  if (confirm(`Вы действительно хотите удалить пользователя ${user.nickname}?`)) {
                                    setAdminUsers(prev => prev.filter(u => u.id !== user.id));
                                    setRegisteredUsersCount(prev => Math.max(0, prev - 1));
                                    setUserSuccessMsg(`Пользователь ${user.nickname} удален`);
                                    setTimeout(() => setUserSuccessMsg(""), 3000);
                                  }
                                }}
                                className="p-1 rounded bg-rose-500/15 text-rose-500 hover:text-rose-400 cursor-pointer active:scale-95 transition-all"
                                title="Удалить"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

            </div>
          )}

          {/* TAB 4: STATISTICS & BILLING */}
          {activeTab === "stats" && (
            <div className="flex-1 flex flex-col gap-6 min-h-0 overflow-y-auto pr-1">
              
              {/* TOP STATS CARDS */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className={`p-4 rounded-xl border flex items-center gap-4 ${
                  isLight ? "bg-white border-slate-200/80 shadow-sm" : "bg-slate-950 border-white/5 shadow-inner"
                }`}>
                  <div className={`p-3 rounded-lg ${isLight ? "bg-emerald-100 text-emerald-800 border border-emerald-200/35" : "bg-emerald-500/10 text-emerald-500"}`}>
                    <DollarSign className="w-6 h-6" />
                  </div>
                  <div>
                    <span className={`text-[10px] font-mono font-extrabold block uppercase ${isLight ? "text-slate-500" : "text-slate-400"}`}>Общая Выручка</span>
                    <span className={`text-sm font-black font-mono tracking-tight mt-1 block ${isLight ? "text-slate-900" : "text-white"}`}>
                      {paidRecords.reduce((acc, r) => acc + r.totalSpent, 0).toLocaleString()} USDT
                    </span>
                  </div>
                </div>

                {/* Выручка за текущий месяц */}
                <div className={`p-4 rounded-xl border flex items-center gap-4 ${
                  isLight ? "bg-white border-slate-200/80 shadow-sm" : "bg-slate-950 border-white/5 shadow-inner"
                }`}>
                  <div className={`p-3 rounded-lg ${isLight ? "bg-teal-100 text-teal-850 border border-teal-200/35" : "bg-teal-500/10 text-teal-400"}`}>
                    <Calendar className="w-6 h-6" />
                  </div>
                  <div>
                    <span className={`text-[10px] font-mono font-extrabold block uppercase ${isLight ? "text-slate-500" : "text-slate-400"}`}>Выручка за Тек. Месяц</span>
                    <span className={`text-sm font-black font-mono tracking-tight mt-1 block ${isLight ? "text-teal-800" : "text-teal-400"}`}>
                      {paidRecords
                        .filter(r => r.paymentDate.startsWith(new Date().toISOString().slice(0, 7)))
                        .reduce((acc, r) => acc + r.lastPaidAmount, 0).toLocaleString()} USDT
                    </span>
                  </div>
                </div>

                <div className={`p-4 rounded-xl border flex items-center gap-4 ${
                  isLight ? "bg-white border-slate-200/80 shadow-sm" : "bg-slate-950 border-white/5 shadow-inner"
                }`}>
                  <div className={`p-3 rounded-lg ${isLight ? "bg-blue-100 text-blue-800 border border-blue-200/35" : "bg-blue-500/10 text-blue-500"}`}>
                    <Check className="w-6 h-6" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className={`text-[10px] font-mono font-extrabold block uppercase ${isLight ? "text-slate-500" : "text-slate-400"}`}>Активные подписки</span>
                    <span className={`text-sm font-black font-mono tracking-tight mt-1 block ${isLight ? "text-emerald-700" : "text-emerald-500"}`}>
                      {paidRecords.filter(r => r.status === "active").length}
                    </span>
                    <span className={`text-[9px] font-mono block mt-0.5 whitespace-nowrap ${isLight ? "text-slate-600 font-bold" : "text-slate-400"}`}>
                      (PRO: {paidRecords.filter(r => r.status === "active" && r.subscriptionLevel === "RPO").length} | VIP: {paidRecords.filter(r => r.status === "active" && r.subscriptionLevel === "VIP").length})
                    </span>
                  </div>
                </div>

                <div className={`p-4 rounded-xl border flex items-center gap-4 ${
                  isLight ? "bg-white border-slate-200/80 shadow-sm" : "bg-slate-950 border-white/5 shadow-inner"
                }`}>
                  <div className={`p-3 rounded-lg ${isLight ? "bg-amber-100 text-amber-800 border border-amber-200/35" : "bg-amber-500/10 text-amber-500"}`}>
                    <RefreshCw className="w-6 h-6" />
                  </div>
                  <div>
                    <span className={`text-[10px] font-mono font-extrabold block uppercase ${isLight ? "text-slate-500" : "text-slate-400"}`}>В ожидании оплаты</span>
                    <span className={`text-sm font-black font-mono tracking-tight mt-1 block ${isLight ? "text-amber-800 animate-pulse font-extrabold" : "text-amber-500"}`}>
                      {paidRecords.filter(r => r.status === "waiting").length}
                    </span>
                  </div>
                </div>
              </div>

              {/* MAIN CONTENT WORKSPACE: LIST & FORM */}
              <div className={`p-5 rounded-2xl border ${
                isLight ? "bg-white border-slate-200 shadow-sm" : "bg-slate-900/60 border-white/5"
              }`}>
                
                {/* HEADER ROW WITH ACTION BUTTONS */}
                <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-200/10 dark:border-white/5">
                  <div>
                    <h3 className={`text-xs font-bold font-mono uppercase tracking-wider flex items-center gap-2 ${
                      isLight ? "text-slate-800" : "text-slate-200"
                    }`}>
                      <DollarSign className="w-4 h-4 text-emerald-500" />
                      База платных подписчиков и биллинг
                    </h3>
                    <p className="text-[10.5px] text-slate-400 mt-0.5 font-sans leading-snug">
                      Учет пользователей, оплачивавших подписку, текущий статус их подписки и финансовая аналитика.
                    </p>
                  </div>

                  <button
                    onClick={() => {
                      setEditingRecordId(editingRecordId === "new" ? null : "new");
                      setEditRecUserId(adminUsers[0]?.id || "");
                      setEditRecLevel("RPO");
                      setEditRecStatus("active");
                      setEditRecAmount("49");
                      setEditRecTotal("147");
                    }}
                    className="px-2.5 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-extrabold text-[10px] uppercase font-mono flex items-center gap-1 cursor-pointer transition active:scale-95"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Зарегистрировать транзакцию
                  </button>
                </div>

                {/* FORM PANEL FOR CREATION / EDITION */}
                {(editingRecordId) && (
                  <div className={`p-4 rounded-xl border mb-5 transition-all ${
                    isLight ? "bg-slate-50 border-slate-200" : "bg-white/[0.01] border-white/5"
                  }`}>
                    <h4 className="text-[10px] font-black font-mono uppercase text-slate-400 mb-3 flex items-center gap-1.5">
                      <Settings className="w-3.5 h-3.5" />
                      {editingRecordId === "new" ? "Новая транзакция" : "Редактирование записи биллинга"}
                    </h4>

                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4">
                      
                      {/* USER SELECT OR INPUT */}
                      <div>
                        <label className="text-[9px] text-slate-400 block uppercase mb-1 font-mono">Никнейм пользователя</label>
                        {editingRecordId === "new" ? (
                          <select
                            value={editRecUserId}
                            onChange={(e) => setEditRecUserId(e.target.value)}
                            className={`text-xs w-full rounded px-2.5 py-1.5 focus:outline-none border ${
                              isLight ? "bg-white border-slate-300 text-slate-900" : "bg-slate-950 border-white/5 text-slate-100"
                            }`}
                          >
                            {adminUsers.map(u => (
                              <option key={u.id} value={u.id}>{u.nickname} ({u.id})</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type="text"
                            disabled
                            value={paidRecords.find(r => r.id === editingRecordId)?.nickname || ""}
                            className={`text-xs w-full rounded px-2.5 py-1.5 font-bold border opacity-60 ${
                              isLight ? "bg-slate-100 border-slate-300 text-slate-700" : "bg-slate-950 border-white/5 text-slate-300"
                            }`}
                          />
                        )}
                      </div>

                      {/* LEVEL */}
                      <div>
                        <label className="text-[9px] text-slate-400 block uppercase mb-1 font-mono">Тарифный план</label>
                        <select
                          value={editRecLevel}
                          onChange={(e) => setEditRecLevel(e.target.value as any)}
                          className={`text-xs w-full rounded px-2.5 py-1.5 focus:outline-none border ${
                            isLight ? "bg-white border-slate-300 text-slate-900" : "bg-slate-950 border-white/5 text-slate-100"
                          }`}
                        >
                          <option value="RPO">RPO</option>
                          <option value="VIP">VIP</option>
                        </select>
                      </div>

                      {/* STATUS */}
                      <div>
                        <label className="text-[9px] text-slate-400 block uppercase mb-1 font-mono">Статус подписки</label>
                        <select
                          value={editRecStatus}
                          onChange={(e) => setEditRecStatus(e.target.value as any)}
                          className={`text-xs w-full rounded px-2.5 py-1.5 focus:outline-none border ${
                            isLight ? "bg-white border-slate-300 text-slate-900" : "bg-slate-950 border-white/5 text-slate-100"
                          }`}
                        >
                          <option value="active">Активная</option>
                          <option value="expired">Закончилась</option>
                          <option value="waiting">В ожидании</option>
                        </select>
                      </div>

                      {/* LAST PAID PRICE */}
                      <div>
                        <label className="text-[9px] text-slate-400 block uppercase mb-1 font-mono">Последняя оплата (USDT)</label>
                        <input
                          type="number"
                          min="0"
                          value={editRecAmount}
                          onChange={(e) => setEditRecAmount(e.target.value)}
                          className={`text-xs w-full rounded px-2.5 py-1.5 focus:outline-none border font-mono ${
                            isLight ? "bg-white border-slate-300 text-slate-900" : "bg-slate-950 border-white/10 text-slate-100"
                          }`}
                        />
                      </div>

                      {/* TOTAL SPENT */}
                      <div>
                        <label className="text-[9px] text-slate-400 block uppercase mb-1 font-mono font-bold">Суммарно потрачено</label>
                        <input
                          type="number"
                          min="0"
                          value={editRecTotal}
                          onChange={(e) => setEditRecTotal(e.target.value)}
                          className={`text-xs w-full rounded px-2.5 py-1.5 focus:outline-none border font-mono font-bold ${
                            isLight ? "bg-white border-slate-300 text-slate-950" : "bg-slate-950 border-white/15 text-white"
                          }`}
                        />
                      </div>

                    </div>

                    {/* FORM BUTTONS */}
                    <div className="flex gap-2 justify-end mt-4">
                      <button
                        onClick={() => setEditingRecordId(null)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer font-sans transition-all opacity-80 hover:opacity-100 ${
                          isLight ? "bg-slate-200 text-slate-700" : "bg-slate-900 text-slate-350"
                        }`}
                      >
                        Отмена
                      </button>
                      <button
                        onClick={() => {
                          const amountVal = parseFloat(editRecAmount) || 0;
                          const totalVal = parseFloat(editRecTotal) || 0;

                          if (editingRecordId === "new") {
                            const usr = adminUsers.find(u => u.id === editRecUserId);
                            const nick = usr ? usr.nickname : "@unknown";
                            const newRec: PaidSubscriptionRecord = {
                              id: `tx_${Date.now().toString().slice(-4)}`,
                              userId: editRecUserId,
                              nickname: nick,
                              subscriptionLevel: editRecLevel,
                              status: editRecStatus,
                              lastPaidAmount: amountVal,
                              totalSpent: totalVal,
                              paymentDate: new Date().toISOString().split('T')[0]
                            };
                            setPaidRecords(prev => [newRec, ...prev]);
                            setUserSuccessMsg("Транзакция успешно добавлена!");
                          } else {
                            setPaidRecords(prev => prev.map(rec => {
                              if (rec.id === editingRecordId) {
                                return {
                                  ...rec,
                                  subscriptionLevel: editRecLevel,
                                  status: editRecStatus,
                                  lastPaidAmount: amountVal,
                                  totalSpent: totalVal
                                };
                              }
                              return rec;
                            }));
                            setUserSuccessMsg("Успешно обновлено!");
                          }
                          setEditingRecordId(null);
                          setTimeout(() => {
                            setUserSuccessMsg("");
                          }, 3000);
                        }}
                        className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs font-sans cursor-pointer active:scale-95 transition-all"
                      >
                        Сохранить
                      </button>
                    </div>
                  </div>
                )}


                {/* BILLING BASE TABLE */}
                <div className="overflow-x-auto">
                  <table className="w-full text-left font-sans text-xs border-collapse">
                    <thead>
                      <tr className={`border-b text-[10px] font-mono ${
                        isLight ? "border-slate-200 text-slate-600 font-extrabold" : "border-white/5 text-slate-400"
                      }`}>
                        <th className="py-2 px-3">Код</th>
                        <th className="py-2 px-3">ID Трейдера</th>
                        <th className="py-2 px-3">Пользователь</th>
                        <th className="py-2 px-3">Тариф</th>
                        <th className="py-2 px-3">Статус подписки</th>
                        <th className="py-2 px-3 text-right">Последняя оплата</th>
                        <th className="py-2 px-3 text-right">Всего внесено</th>
                        <th className="py-2 px-3">Дата платежа</th>
                        <th className="py-2 px-3 text-right">Действия</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-500/5 font-mono">
                      {paidRecords.map(rec => (
                        <tr key={rec.id} className={`hover:bg-slate-500/5 transition-colors ${
                          isLight ? "text-slate-800" : "text-slate-200"
                        }`}>
                          <td className="py-2 px-3 font-semibold text-slate-500 text-[11px]">{rec.id}</td>
                          <td className="py-2 px-3 font-mono text-slate-400 text-[10.5px]">{rec.userId}</td>
                          <td className="py-2 px-3 font-bold text-amber-500">{rec.nickname}</td>
                          <td className="py-2 px-3">
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border ${
                              rec.subscriptionLevel === "RPO"
                                ? isLight ? "bg-orange-50 border-orange-300 text-orange-700" : "bg-orange-500/10 border-orange-500/25 text-orange-400"
                                : isLight ? "bg-yellow-50 border-yellow-300 text-yellow-850" : "bg-yellow-500/10 border-yellow-500/25 text-yellow-450 font-bold"
                            }`}>
                              {rec.subscriptionLevel}
                            </span>
                          </td>
                          <td className="py-2 px-3">
                            <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase border ${
                              rec.status === "active"
                                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                : rec.status === "waiting"
                                ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                                : "bg-rose-500/10 text-rose-400 border-rose-500/20"
                            }`}>
                              {rec.status === "active" ? "Активная" : rec.status === "waiting" ? "Ожидание" : "Закончилась"}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-right font-bold text-slate-350">{rec.lastPaidAmount} USDT</td>
                          <td className="py-2 px-3 text-right font-bold text-emerald-400">{rec.totalSpent} USDT</td>
                          <td className="py-2 px-3 text-slate-400 text-[10.5px]">{rec.paymentDate}</td>
                          <td className="py-2 px-3 text-right">
                            <div className="flex items-center gap-1.5 justify-end">
                              <button
                                onClick={() => {
                                  setEditingRecordId(rec.id);
                                  setEditRecUserId(rec.userId);
                                  setEditRecLevel(rec.subscriptionLevel);
                                  setEditRecStatus(rec.status);
                                  setEditRecAmount(rec.lastPaidAmount.toString());
                                  setEditRecTotal(rec.totalSpent.toString());
                                }}
                                className="p-1 rounded bg-blue-500/15 text-blue-400 hover:text-blue-300 cursor-pointer active:scale-95 transition-all"
                                title="Редактировать запись"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => {
                                  if (confirm(`Вы действительно хотите удалить финансовую запись для ${rec.nickname}?`)) {
                                    setPaidRecords(prev => prev.filter(r => r.id !== rec.id));
                                    setUserSuccessMsg(`Запись биллинга для ${rec.nickname} удалена`);
                                    setTimeout(() => setUserSuccessMsg(""), 3000);
                                  }
                                }}
                                className="p-1 rounded bg-rose-500/15 text-rose-500 hover:text-rose-400 cursor-pointer active:scale-95 transition-all"
                                title="Удалить"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

              </div>

            </div>
          )}

        </motion.div>
      </AnimatePresence>

    </div>
  );
}
