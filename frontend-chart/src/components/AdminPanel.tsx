import React, { useState, useEffect, useRef, useCallback } from "react";
import { CryptoPair } from "../types";
import {
  Activity,
  Trash2,
  Cpu,
  Check,
  Zap,
  RefreshCw,
  ArrowLeft,
  Download,
  Plus,
  Terminal,
  Settings,
  Database,
  Wifi,
  Save,
  Server,
  HardDrive,
  Users,
  AlertTriangle,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

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
  marketType: "SPOT" | "FUTURES";
  onSetMarketType: (type: "SPOT" | "FUTURES") => void;
}

interface ServerMetrics {
  uptime: number;
  goroutines: number;
  ram_alloc_mb: number;
  ram_sys_mb: number;
  cpu_percent: number;
  system_ram_gb: number;
  system_ram_total_gb: number;
  disk_used_gb: number;
  disk_total_gb: number;
  disk_percent: number;
  ws_clients: number;
  clickhouse: string;
  redis: string;
}

interface TickerConfig {
  symbol: string;
  market: string;
  tick_size: number;
  base_compression: number;
  compression_levels: number;
  default_compression: number;
  ttl_days: number;
  dom_snapshot_seconds: number;
  enabled: boolean;
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
  marketType,
  onSetMarketType,
}: AdminPanelProps) {
  const isLight = theme === "light";
  const [activeTab, setActiveTab] = useState<"server" | "history" | "database" | "logs">("server");

  const [metrics, setMetrics] = useState<ServerMetrics | null>(null);
  const [tickers, setTickers] = useState<TickerConfig[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [logLines, setLogLines] = useState(200);

  const [cpuHistory, setCpuHistory] = useState<number[]>(() => Array.from({ length: 25 }, () => 0));
  const [ramHistory, setRamHistory] = useState<number[]>(() => Array.from({ length: 25 }, () => 0));
  const [diskHistory, setDiskHistory] = useState<number[]>(() => Array.from({ length: 25 }, () => 0));

  const [histSymbol, setHistSymbol] = useState(activePair.symbol);
  const [histMarket, setHistMarket] = useState<"SPOT" | "FUTURES">(marketType);
  const [histFrom, setHistFrom] = useState("2026-05-01");
  const [histTo, setHistTo] = useState("2026-05-25");
  const [histJobId, setHistJobId] = useState<string | null>(null);
  const [histProgress, setHistProgress] = useState<string>("");
  const [histDetail, setHistDetail] = useState<string>("");
  const [histPercent, setHistPercent] = useState<number>(0);
  const [histDone, setHistDone] = useState(false);
  const [histError, setHistError] = useState<string | null>(null);

  const [newTicker, setNewTicker] = useState({
    symbol: "",
    market: "futures",
    tickSize: "0.1",
    baseCompression: "25",
    ttlDays: "365",
    domSnapshotSec: "60",
  });
  const [tickerMsg, setTickerMsg] = useState("");

  const [compDefaults, setCompDefaults] = useState<Record<string, any>>({});
  const [compMsg, setCompMsg] = useState("");

  const logsEndRef = useRef<HTMLDivElement>(null);

  const fetchMetrics = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/metrics");
      if (res.ok) {
        const data = await res.json();
        setMetrics(data);
        setCpuHistory(prev => [...prev.slice(1), data.cpu_percent || 0]);
        setRamHistory(prev => [...prev.slice(1), data.system_ram_gb || 0]);
        setDiskHistory(prev => [...prev.slice(1), data.disk_percent || 0]);
      }
    } catch {}
  }, []);

  const fetchTickers = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/tickers");
      if (res.ok) {
        const data = await res.json();
        setTickers(Array.isArray(data) ? data : []);
      }
    } catch {}
  }, []);

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/logs?lines=${logLines}`);
      if (res.ok) {
        const data = await res.json();
        setLogs(data.lines || []);
      }
    } catch {}
  }, [logLines]);

  const fetchCompDefaults = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/compression-defaults");
      if (res.ok) {
        const data = await res.json();
        setCompDefaults(data || {});
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    fetchMetrics();
    fetchTickers();
    fetchLogs();
    fetchCompDefaults();
    const id = setInterval(fetchMetrics, 2500);
    return () => clearInterval(id);
  }, [isOpen, fetchMetrics, fetchTickers, fetchLogs, fetchCompDefaults]);

  useEffect(() => {
    if (logsEndRef.current && activeTab === "logs") {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, activeTab]);

  useEffect(() => {
    setHistSymbol(activePair.symbol);
  }, [activePair.symbol]);

  if (!isOpen) return null;

  const formatUptime = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    return `${h}h ${m}m ${s}s`;
  };

  const handleLoadHistory = async () => {
    setHistDone(false);
    setHistError(null);
    setHistProgress("Starting...");
    setHistDetail("");
    setHistPercent(0);
    try {
      const res = await fetch("/api/admin/history/load", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: histSymbol.toUpperCase(),
          market: histMarket.toLowerCase(),
          from: histFrom,
          to: histTo,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        setHistError(err.error?.message || "Failed to start");
        setHistProgress("");
        return;
      }
      const data = await res.json();
      const jobId = data.jobId;
      setHistJobId(jobId);

      const evtSource = new EventSource(`/api/admin/history/progress?jobId=${jobId}`);
      evtSource.addEventListener("progress", (e) => {
        try {
          const d = JSON.parse(e.data);
          const pct = d.total > 0 ? Math.round((d.current / d.total) * 100) : 0;
          setHistPercent(pct);
          setHistProgress(`${d.label || "processing"} ${d.current}/${d.total}`);
          setHistDetail(d.detail || "");
        } catch {}
      });
      evtSource.addEventListener("done", () => {
        setHistDone(true);
        setHistProgress("Complete!");
        setHistPercent(100);
        evtSource.close();
      });
      evtSource.addEventListener("error", (e) => {
        try {
          const d = JSON.parse((e as MessageEvent).data || "{}");
          setHistError(d.error || "Job failed");
        } catch {
          setHistError("Connection lost");
        }
        evtSource.close();
      });
      evtSource.onerror = () => {};
    } catch (err: any) {
      setHistError(err.message || "Network error");
      setHistProgress("");
    }
  };

  const handleAddTicker = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTicker.symbol) return;
    try {
      const res = await fetch("/api/admin/tickers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: newTicker.symbol.toUpperCase(),
          market: newTicker.market,
          tickSize: parseFloat(newTicker.tickSize) || 0.1,
          baseCompression: parseInt(newTicker.baseCompression) || 25,
          ttlDays: parseInt(newTicker.ttlDays) || 365,
          domSnapshotSec: parseInt(newTicker.domSnapshotSec) || 60,
        }),
      });
      if (res.ok) {
        setTickerMsg(`Ticker ${newTicker.symbol.toUpperCase()} added!`);
        fetchTickers();
        setNewTicker({ ...newTicker, symbol: "" });
        setTimeout(() => setTickerMsg(""), 3000);
      }
    } catch {}
  };

  const handleDeleteTicker = async (symbol: string, market: string) => {
    if (!confirm(`Delete ${symbol} ${market}?`)) return;
    try {
      const res = await fetch(`/api/admin/tickers?symbol=${symbol}&market=${market}`, { method: "DELETE" });
      if (res.ok) fetchTickers();
    } catch {}
  };

  const handleSaveCompDefaults = async () => {
    try {
      const res = await fetch("/api/admin/compression-defaults", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(compDefaults),
      });
      if (res.ok) {
        setCompMsg("Saved!");
        setTimeout(() => setCompMsg(""), 3000);
      }
    } catch {}
  };

  const renderGraph = (data: number[], maxVal: number, color: string, gradId: string) => {
    const width = 300;
    const height = 48;
    const points = data.map((val, idx) => {
      const x = idx * (width / (data.length - 1 || 1));
      const y = height - (val / maxVal) * (height - 8) - 4;
      return { x, y };
    });
    const pathD = points.map((p, idx) => `${idx === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
    const areaD = `${pathD} L ${width} ${height} L 0 ${height} Z`;
    return (
      <div className={`h-14 w-full ${isLight ? "bg-slate-100/80" : "bg-black/30"} rounded-lg p-1.5 border ${isLight ? "border-slate-300/40" : "border-white/[0.02]"}`}>
        <svg className="w-full h-full" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.25" />
              <stop offset="100%" stopColor={color} stopOpacity="0.0" />
            </linearGradient>
          </defs>
          <line x1="0" y1={height * 0.5} x2={width} y2={height * 0.5} stroke="currentColor" className={isLight ? "text-slate-400/20" : "text-white/[0.03]"} strokeDasharray="3 3" />
          <path d={areaD} fill={`url(#${gradId})`} />
          <path d={pathD} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          {points.length > 0 && <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r="2" fill={color} />}
        </svg>
      </div>
    );
  };

  const tabs = [
    { id: "server" as const, label: "Server", icon: Cpu, color: "blue" },
    { id: "history" as const, label: "History", icon: Download, color: "amber" },
    { id: "database" as const, label: "Database", icon: Database, color: "emerald" },
    { id: "logs" as const, label: "Logs", icon: Terminal, color: "purple" },
  ];

  return (
    <div className={`flex-1 flex flex-col min-h-0 relative z-40 overflow-y-auto ${
      isLight ? "bg-slate-50 text-slate-900" : "bg-[#060813] text-slate-100"
    } p-6 gap-6 font-sans select-none`}>
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-500/10 shrink-0">
        <div className="flex items-center gap-4">
          <button onClick={onClose}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border cursor-pointer hover:scale-102 active:scale-98 transition ${
              isLight ? "bg-white border-slate-200 text-slate-700 hover:bg-slate-50 shadow-sm" : "bg-slate-900 border-white/5 text-slate-300 hover:text-white hover:bg-slate-800"
            }`}>
            <ArrowLeft className="w-4 h-4" />
            <span>Terminal</span>
          </button>
          <div className="h-5 w-px bg-slate-500/20 hidden sm:block" />
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-black uppercase tracking-wider flex items-center gap-2">
              <Settings className="w-5 h-5 text-red-500 animate-spin" />
              Admin Panel
            </h1>
            <span className={`text-[9px] px-2 py-0.5 rounded-md font-mono font-black ${
              isLight ? "bg-red-50 text-red-700 border border-red-200" : "bg-red-500/10 text-red-400 border border-red-500/15"
            }`}>BUILD MODE</span>
          </div>
        </div>
      </div>

      <div className="flex border-b border-slate-500/15 gap-2 pb-px shrink-0">
        {tabs.map((tab) => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`px-5 py-2.5 rounded-t-xl text-xs font-bold tracking-wider uppercase flex items-center gap-2 border-t-2 border-x transition-all duration-150 cursor-pointer ${
              activeTab === tab.id
                ? isLight ? `bg-white border-t-${tab.color}-500 border-x-slate-200 text-slate-900 shadow-sm` : `bg-slate-900 border-t-${tab.color}-500 border-x-white/5 text-white`
                : isLight ? "bg-transparent border-t-transparent border-x-transparent text-slate-600 hover:bg-slate-200/40 hover:text-slate-800" : "bg-transparent border-t-transparent border-x-transparent text-slate-400 hover:bg-white/[0.02] hover:text-white"
            }`}>
            <tab.icon className={`w-4 h-4 text-${tab.color}-500`} />
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={activeTab} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} transition={{ duration: 0.15 }}
          className="flex-1 flex flex-col gap-6 min-h-0">

          {activeTab === "server" && (
            <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-6 min-h-0">
              <div className={`p-5 rounded-2xl border flex flex-col gap-4 ${isLight ? "bg-white border-slate-200" : "liquid-glass-card"}`}>
                <h3 className="text-xs font-bold font-mono text-slate-400 flex items-center gap-2 justify-start uppercase shrink-0">
                  <Cpu className="w-4 h-4 text-slate-400 animate-pulse" /> Server Metrics & Resources
                </h3>
                <div className="flex-1 flex flex-col gap-4 lg:min-h-0 justify-between">
                  <div className={`flex-1 min-h-[145px] p-3 rounded-xl border flex flex-col justify-between gap-2.5 ${isLight ? "bg-slate-50/70 border-slate-200" : "bg-white/[0.01] border-white/5"}`}>
                    <div className="flex justify-between items-center text-xs">
                      <span className={`font-bold flex items-center gap-1.5 ${isLight ? "text-slate-800" : "text-white"}`}>
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping" />
                        <span>CPU Load</span>
                      </span>
                      <span className={`font-mono font-bold ${isLight ? "text-amber-600" : "text-amber-500"}`}>{(metrics?.cpu_percent || 0).toFixed(1)}%</span>
                    </div>
                    <div className={`h-2 w-full ${isLight ? "bg-slate-200" : "bg-slate-900"} rounded-full overflow-hidden`}>
                      <div className="h-full bg-amber-500 transition-all duration-300" style={{ width: `${Math.min(100, metrics?.cpu_percent || 0)}%` }} />
                    </div>
                    <div className={`text-[10px] ${isLight ? "text-slate-600" : "text-slate-400"} font-mono flex justify-between`}>
                      <span>Goroutines: {metrics?.goroutines || 0}</span>
                      <span>Go RAM: {(metrics?.ram_alloc_mb || 0).toFixed(1)} MB</span>
                    </div>
                    <div className="flex flex-col gap-1 min-h-0">
                      <span className={`text-[9px] ${isLight ? "text-slate-500" : "text-slate-400"} font-mono uppercase tracking-wider`}>CPU History (30s)</span>
                      {renderGraph(cpuHistory, 100, "#f59e0b", "cpuGrad")}
                    </div>
                  </div>

                  <div className={`flex-1 min-h-[145px] p-3 rounded-xl border flex flex-col justify-between gap-2.5 ${isLight ? "bg-slate-50/70 border-slate-200" : "bg-white/[0.01] border-white/5"}`}>
                    <div className="flex justify-between items-center text-xs">
                      <span className={`font-bold flex items-center gap-1.5 ${isLight ? "text-slate-800" : "text-white"}`}>
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        <span>System RAM</span>
                      </span>
                      <span className={`font-mono font-bold ${isLight ? "text-emerald-600" : "text-emerald-500"}`}>{(metrics?.system_ram_gb || 0).toFixed(2)} / {(metrics?.system_ram_total_gb || 0).toFixed(1)} GB</span>
                    </div>
                    <div className={`h-2 w-full ${isLight ? "bg-slate-200" : "bg-slate-900"} rounded-full overflow-hidden`}>
                      <div className="h-full bg-emerald-500 transition-all duration-300" style={{ width: `${((metrics?.system_ram_gb || 0) / (metrics?.system_ram_total_gb || 1)) * 100}%` }} />
                    </div>
                    <div className={`text-[10px] ${isLight ? "text-slate-600" : "text-slate-400"} font-mono flex justify-between`}>
                      <span>Free: {((metrics?.system_ram_total_gb || 0) - (metrics?.system_ram_gb || 0)).toFixed(2)} GB</span>
                      <span>Sys: {(metrics?.ram_sys_mb || 0).toFixed(1)} MB</span>
                    </div>
                    <div className="flex flex-col gap-1 min-h-0">
                      <span className={`text-[9px] ${isLight ? "text-slate-500" : "text-slate-400"} font-mono uppercase tracking-wider`}>RAM History</span>
                      {renderGraph(ramHistory, metrics?.system_ram_total_gb || 16, "#10b981", "ramGrad")}
                    </div>
                  </div>

                  <div className={`flex-1 min-h-[145px] p-3 rounded-xl border flex flex-col justify-between gap-2.5 ${isLight ? "bg-slate-50/70 border-slate-200" : "bg-white/[0.01] border-white/5"}`}>
                    <div className="flex justify-between items-center text-xs">
                      <span className={`font-semibold flex items-center gap-1.5 ${isLight ? "text-slate-800" : "text-white"}`}>
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                        <span>Disk Usage</span>
                      </span>
                      <span className={`font-mono font-bold ${isLight ? "text-blue-600" : "text-blue-400"}`}>{(metrics?.disk_percent || 0).toFixed(1)}%</span>
                    </div>
                    <div className={`h-2 w-full ${isLight ? "bg-slate-200" : "bg-slate-900"} rounded-full overflow-hidden`}>
                      <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${Math.min(100, metrics?.disk_percent || 0)}%` }} />
                    </div>
                    <div className={`text-[10px] ${isLight ? "text-slate-600" : "text-slate-400"} font-mono flex justify-between`}>
                      <span>{(metrics?.disk_used_gb || 0).toFixed(1)} / {(metrics?.disk_total_gb || 0).toFixed(1)} GB</span>
                      <span>SSD NVMe</span>
                    </div>
                    <div className="flex flex-col gap-1 min-h-0">
                      <span className={`text-[9px] ${isLight ? "text-slate-500" : "text-slate-400"} font-mono uppercase tracking-wider`}>Disk I/O History</span>
                      {renderGraph(diskHistory, 100, "#3b82f6", "diskGrad")}
                    </div>
                  </div>
                </div>
              </div>

              <div className={`flex-1 flex flex-col min-h-[400px] lg:min-h-0 rounded-2xl p-5 border gap-3 ${isLight ? "bg-white border-slate-200" : "liquid-glass-card"}`}>
                <div className="flex justify-between items-center text-xs">
                  <span className="font-extrabold tracking-wider font-mono text-slate-500 flex items-center gap-2 uppercase">
                    <Terminal className="w-4 h-4 text-slate-400" /> Server Logs
                  </span>
                  <div className="flex items-center gap-2">
                    <span className={`font-mono text-[10px] px-2.5 py-0.5 rounded-full animate-pulse ${
                      isLight ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                    }`}>LIVE</span>
                    <button onClick={() => { fetchMetrics(); fetchLogs(); }}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1 cursor-pointer ${isLight ? "bg-blue-600 text-white" : "bg-blue-500/20 text-blue-400"}`}>
                      <RefreshCw className="w-3 h-3" /> Refresh
                    </button>
                  </div>
                </div>
                <div className={`flex-1 min-h-[220px] rounded-xl p-4 font-mono text-[10.5px] overflow-y-auto leading-relaxed border select-text shadow-inner ${
                  isLight ? "bg-slate-900 text-slate-200 border-slate-300" : "bg-[#02050e] text-[#00ff66] border-white/5"
                }`}>
                  <div className="flex flex-col gap-1.5">
                    {logs.map((log, index) => (
                      <div key={index} className="flex gap-2.5 hover:bg-white/5 py-0.5 px-1.5 rounded transition-colors duration-100">
                        <span className="text-slate-500 shrink-0 select-none">[{index + 1}]</span>
                        <span className="whitespace-pre-wrap">{log}</span>
                      </div>
                    ))}
                    <div ref={logsEndRef} />
                  </div>
                </div>
                <div className="flex justify-between items-center text-[10px] text-slate-500 font-mono">
                  <span>WS Clients: {metrics?.ws_clients || 0}</span>
                  <span>ClickHouse: {metrics?.clickhouse || "?"} | Redis: {metrics?.redis || "?"}</span>
                </div>
              </div>
            </div>
          )}

          {activeTab === "history" && (
            <div className={`p-5 rounded-2xl border flex flex-col gap-4 max-w-2xl ${isLight ? "bg-white border-slate-200 shadow-sm" : "liquid-glass-card"}`}>
              <h3 className={`text-sm font-black uppercase tracking-wider flex items-center gap-2 ${isLight ? "text-amber-700" : "text-yellow-500"}`}>
                <Download className="w-4 h-4" /> History Load (Binance Vision)
              </h3>
              <p className={`text-xs leading-relaxed ${isLight ? "text-slate-600" : "text-slate-400"}`}>
                Download and aggregate historical trade data from data.binance.vision into ClickHouse.
              </p>
              <div className="flex flex-col gap-3 text-xs">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={`text-[10px] font-mono font-bold block mb-1 uppercase ${isLight ? "text-slate-700" : "text-slate-400"}`}>Symbol</label>
                    <select value={histSymbol} onChange={(e) => setHistSymbol(e.target.value)}
                      className={`w-full text-xs font-mono font-bold rounded-lg px-3 py-2 border ${isLight ? "bg-slate-50 border-slate-300 text-slate-900" : "bg-slate-900 border-white/5 text-white"}`}>
                      {pairs.map(p => <option key={p.symbol} value={p.symbol}>{p.symbol}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={`text-[10px] font-mono font-bold block mb-1 uppercase ${isLight ? "text-slate-700" : "text-slate-400"}`}>Market</label>
                    <select value={histMarket} onChange={(e) => setHistMarket(e.target.value as any)}
                      className={`w-full text-xs font-mono font-bold rounded-lg px-3 py-2 border ${isLight ? "bg-slate-50 border-slate-300 text-slate-900" : "bg-slate-900 border-white/5 text-white"}`}>
                      <option value="SPOT">SPOT</option>
                      <option value="FUTURES">FUTURES</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={`text-[10px] font-mono font-bold block mb-1 ${isLight ? "text-slate-700" : "text-slate-400"}`}>From</label>
                    <input type="date" value={histFrom} onChange={(e) => setHistFrom(e.target.value)}
                      className={`w-full text-xs font-mono rounded-lg px-3 py-2 border ${isLight ? "bg-slate-50 border-slate-300 text-slate-900" : "bg-slate-900 border-white/5 text-white"}`} />
                  </div>
                  <div>
                    <label className={`text-[10px] font-mono font-bold block mb-1 ${isLight ? "text-slate-700" : "text-slate-400"}`}>To</label>
                    <input type="date" value={histTo} onChange={(e) => setHistTo(e.target.value)}
                      className={`w-full text-xs font-mono rounded-lg px-3 py-2 border ${isLight ? "bg-slate-50 border-slate-300 text-slate-900" : "bg-slate-900 border-white/5 text-white"}`} />
                  </div>
                </div>

                {histProgress && (
                  <div className={`p-3 rounded-xl border ${isLight ? "bg-blue-50/70 border-blue-200" : "bg-blue-500/5 border-blue-500/10"}`}>
                    <div className="flex justify-between text-[10px] font-mono font-bold">
                      <span className={isLight ? "text-blue-800" : "text-blue-400"}>{histProgress}</span>
                      <span className={isLight ? "text-blue-850" : "text-blue-400"}>{histPercent}%</span>
                    </div>
                    <div className={`h-1.5 w-full mt-2 ${isLight ? "bg-slate-200" : "bg-slate-900"} rounded-full overflow-hidden`}>
                      <div className="h-full bg-blue-500 transition-all duration-500" style={{ width: `${histPercent}%` }} />
                    </div>
                    {histDetail && <span className={`text-[10px] font-mono italic block mt-1 truncate ${isLight ? "text-slate-700" : "text-slate-400"}`}>{histDetail}</span>}
                  </div>
                )}

                {histError && (
                  <div className={`p-3 rounded-xl border flex items-center gap-2 ${isLight ? "bg-rose-50 border-rose-200" : "bg-rose-500/5 border-rose-500/10"}`}>
                    <AlertTriangle className="w-4 h-4 text-rose-500" />
                    <span className="text-xs text-rose-500 font-bold">{histError}</span>
                  </div>
                )}

                {histDone && (
                  <div className={`p-3 rounded-xl border flex items-center gap-2 ${isLight ? "bg-emerald-50 border-emerald-200" : "bg-emerald-500/5 border-emerald-500/10"}`}>
                    <Check className="w-4 h-4 text-emerald-500" />
                    <span className="text-xs text-emerald-500 font-bold">History loaded successfully!</span>
                  </div>
                )}

                <button onClick={handleLoadHistory}
                  disabled={!!histJobId && !histDone && !histError}
                  className={`py-2.5 px-3.5 rounded-xl text-center font-black text-xs flex items-center justify-center gap-1.5 transition cursor-pointer ${
                    !!histJobId && !histDone && !histError
                      ? isLight ? "bg-slate-200 text-slate-400 cursor-not-allowed" : "bg-slate-800 text-slate-500 cursor-not-allowed"
                      : isLight ? "bg-amber-600 hover:bg-amber-700 text-white shadow" : "bg-amber-500 text-slate-950 hover:bg-amber-600"
                  }`}>
                  <Download className="w-3.5 h-3.5" />
                  {histDone ? "Load Again" : "Start History Load"}
                </button>
              </div>
            </div>
          )}

          {activeTab === "database" && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 min-h-0">
              <div className={`p-5 rounded-2xl border flex flex-col gap-4 ${isLight ? "bg-white border-slate-200 shadow-sm" : "liquid-glass-card"}`}>
                <h3 className={`text-sm font-black uppercase tracking-wider flex items-center gap-2 ${isLight ? "text-emerald-700" : "text-emerald-500"}`}>
                  <Plus className="w-4 h-4" /> Add Ticker
                </h3>
                {tickerMsg && (
                  <div className={`p-3 rounded-xl text-xs font-bold border ${isLight ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-emerald-500/10 border-emerald-500/25 text-emerald-400"}`}>
                    {tickerMsg}
                  </div>
                )}
                <form onSubmit={handleAddTicker} className="flex flex-col gap-3 text-xs">
                  <div>
                    <label className={`text-[10px] font-mono font-bold block mb-1 uppercase ${isLight ? "text-slate-700" : "text-slate-400"}`}>Symbol</label>
                    <input type="text" required placeholder="SOLUSDT" value={newTicker.symbol}
                      onChange={(e) => setNewTicker({ ...newTicker, symbol: e.target.value })}
                      className={`w-full text-xs font-mono font-bold rounded-lg px-3 py-2 border ${isLight ? "bg-slate-50 border-slate-300 text-slate-900" : "bg-slate-900 border-white/5 text-white"}`} />
                  </div>
                  <div>
                    <label className={`text-[10px] font-mono font-bold block mb-1 uppercase ${isLight ? "text-slate-700" : "text-slate-400"}`}>Market</label>
                    <select value={newTicker.market} onChange={(e) => setNewTicker({ ...newTicker, market: e.target.value })}
                      className={`w-full text-xs font-mono font-bold rounded-lg px-3 py-2 border ${isLight ? "bg-slate-50 border-slate-300 text-slate-900" : "bg-slate-900 border-white/5 text-white"}`}>
                      <option value="futures">Futures</option>
                      <option value="spot">Spot</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={`text-[10px] font-mono font-bold block mb-1 ${isLight ? "text-slate-700" : "text-slate-400"}`}>Tick Size</label>
                      <input type="number" step="any" value={newTicker.tickSize}
                        onChange={(e) => setNewTicker({ ...newTicker, tickSize: e.target.value })}
                        className={`w-full text-xs font-mono font-bold rounded-lg px-3 py-2 border ${isLight ? "bg-slate-50 border-slate-300 text-slate-900" : "bg-slate-900 border-white/5 text-white"}`} />
                    </div>
                    <div>
                      <label className={`text-[10px] font-mono font-bold block mb-1 ${isLight ? "text-slate-700" : "text-slate-400"}`}>Base Compression</label>
                      <input type="number" value={newTicker.baseCompression}
                        onChange={(e) => setNewTicker({ ...newTicker, baseCompression: e.target.value })}
                        className={`w-full text-xs font-mono font-bold rounded-lg px-3 py-2 border ${isLight ? "bg-slate-50 border-slate-300 text-slate-900" : "bg-slate-900 border-white/5 text-white"}`} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={`text-[10px] font-mono font-bold block mb-1 ${isLight ? "text-slate-700" : "text-slate-400"}`}>TTL Days</label>
                      <input type="number" value={newTicker.ttlDays}
                        onChange={(e) => setNewTicker({ ...newTicker, ttlDays: e.target.value })}
                        className={`w-full text-xs font-mono font-bold rounded-lg px-3 py-2 border ${isLight ? "bg-slate-50 border-slate-300 text-slate-900" : "bg-slate-900 border-white/5 text-white"}`} />
                    </div>
                    <div>
                      <label className={`text-[10px] font-mono font-bold block mb-1 ${isLight ? "text-slate-700" : "text-slate-400"}`}>DOM Snapshot (sec)</label>
                      <input type="number" value={newTicker.domSnapshotSec}
                        onChange={(e) => setNewTicker({ ...newTicker, domSnapshotSec: e.target.value })}
                        className={`w-full text-xs font-mono font-bold rounded-lg px-3 py-2 border ${isLight ? "bg-slate-50 border-slate-300 text-slate-900" : "bg-slate-900 border-white/5 text-white"}`} />
                    </div>
                  </div>
                  <button type="submit"
                    className={`w-full px-4 py-2.5 rounded-xl font-black transition tracking-wide text-xs flex items-center justify-center gap-2 cursor-pointer ${
                      isLight ? "bg-emerald-600 hover:bg-emerald-700 text-white shadow" : "bg-emerald-500 text-slate-950 hover:bg-emerald-600"
                    }`}>
                    <Plus className="w-4 h-4" /> Register Ticker
                  </button>
                </form>
              </div>

              <div className={`p-5 rounded-2xl border flex flex-col gap-4 ${isLight ? "bg-white border-slate-200 shadow-sm" : "liquid-glass-card"}`}>
                <h3 className={`text-sm font-black uppercase tracking-wider flex items-center gap-2 ${isLight ? "text-blue-700" : "text-blue-500"}`}>
                  <Database className="w-4 h-4" /> Ticker Registry ({tickers.length})
                </h3>
                <div className="overflow-x-auto flex-1">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className={`border-b text-[10px] font-mono ${isLight ? "border-slate-200 text-slate-600 font-extrabold" : "border-white/5 text-slate-400"}`}>
                        <th className="py-2 px-2">Symbol</th>
                        <th className="py-2 px-2">Market</th>
                        <th className="py-2 px-2">Tick</th>
                        <th className="py-2 px-2">Comp</th>
                        <th className="py-2 px-2">TTL</th>
                        <th className="py-2 px-2 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-500/5 font-mono">
                      {tickers.map((t) => (
                        <tr key={`${t.symbol}-${t.market}`} className={`hover:bg-slate-500/5 ${isLight ? "text-slate-800" : "text-slate-200"}`}>
                          <td className="py-2 px-2 font-bold text-amber-500">{t.symbol}</td>
                          <td className="py-2 px-2">
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border ${
                              t.market === "futures"
                                ? isLight ? "bg-amber-50 border-amber-200 text-amber-700" : "bg-amber-500/10 border-amber-500/25 text-amber-400"
                                : isLight ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-emerald-500/10 border-emerald-500/25 text-emerald-400"
                            }`}>{t.market}</span>
                          </td>
                          <td className="py-2 px-2 font-mono text-[11px]">{t.tick_size}</td>
                          <td className="py-2 px-2 font-mono text-[11px]">{t.base_compression}</td>
                          <td className="py-2 px-2 font-mono text-[11px]">{t.ttl_days}d</td>
                          <td className="py-2 px-2 text-right">
                            <button onClick={() => handleDeleteTicker(t.symbol, t.market)}
                              className="p-1 rounded bg-rose-500/15 text-rose-500 hover:text-rose-400 cursor-pointer active:scale-95 transition-all">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className={`p-4 rounded-xl border flex flex-col gap-3 ${isLight ? "bg-slate-50 border-slate-200" : "bg-white/[0.02] border-white/5"}`}>
                  <h4 className={`text-[10px] font-mono font-bold uppercase ${isLight ? "text-slate-600" : "text-slate-400"}`}>Default Compression (Redis)</h4>
                  <div className="flex gap-2">
                    <input type="text" placeholder='{"BTCUSDT":{"futures":{"15m":5}}}'
                      value={JSON.stringify(compDefaults)}
                      onChange={(e) => { try { setCompDefaults(JSON.parse(e.target.value)); } catch {} }}
                      className={`flex-1 text-[10px] font-mono rounded-lg px-3 py-2 border ${isLight ? "bg-white border-slate-300 text-slate-900" : "bg-slate-950 border-white/5 text-white"}`} />
                    <button onClick={handleSaveCompDefaults}
                      className={`px-3 py-2 rounded-lg font-bold text-xs flex items-center gap-1 cursor-pointer ${isLight ? "bg-amber-600 text-white" : "bg-amber-500/20 text-amber-400"}`}>
                      <Save className="w-3.5 h-3.5" /> Save
                    </button>
                  </div>
                  {compMsg && <span className="text-xs text-emerald-500 font-bold">{compMsg}</span>}
                </div>
              </div>
            </div>
          )}

          {activeTab === "logs" && (
            <div className={`flex-1 flex flex-col min-h-[400px] rounded-2xl p-5 border gap-3 ${isLight ? "bg-white border-slate-200" : "liquid-glass-card"}`}>
              <div className="flex justify-between items-center text-xs">
                <span className="font-extrabold tracking-wider font-mono text-slate-500 flex items-center gap-2 uppercase">
                  <Terminal className="w-4 h-4 text-slate-400" /> Server Logs
                </span>
                <div className="flex items-center gap-2">
                  <select value={logLines} onChange={(e) => setLogLines(parseInt(e.target.value))}
                    className={`text-[10px] font-mono rounded px-2 py-1 border ${isLight ? "bg-slate-50 border-slate-300 text-slate-900" : "bg-slate-900 border-white/5 text-white"}`}>
                    <option value={100}>100</option>
                    <option value={200}>200</option>
                    <option value={500}>500</option>
                  </select>
                  <button onClick={fetchLogs}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1 cursor-pointer ${isLight ? "bg-blue-600 text-white" : "bg-blue-500/20 text-blue-400"}`}>
                    <RefreshCw className="w-3 h-3" /> Refresh
                  </button>
                </div>
              </div>
              <div className={`flex-1 min-h-[300px] rounded-xl p-4 font-mono text-[10.5px] overflow-y-auto leading-relaxed border select-text shadow-inner ${
                isLight ? "bg-slate-900 text-slate-200 border-slate-300" : "bg-[#02050e] text-[#00ff66] border-white/5"
              }`}>
                <div className="flex flex-col gap-1.5">
                  {logs.map((log, i) => (
                    <div key={i} className="flex gap-2.5 hover:bg-white/5 py-0.5 px-1.5 rounded transition-colors">
                      <span className="text-slate-500 shrink-0 select-none">[{i + 1}]</span>
                      <span className="whitespace-pre-wrap">{log}</span>
                    </div>
                  ))}
                  <div ref={logsEndRef} />
                </div>
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
