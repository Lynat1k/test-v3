/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useLayoutEffect, useMemo } from "react";
import { ClusterCandle, ClusterCell, CryptoPair, IndicatorSettings, Indicator } from "../types";
import { ZoomIn, ZoomOut, Maximize2, Compass, Move, Layers, Activity, Eye, EyeOff, Settings, Trash2, Globe, Slash, Minus, Square, Grid3X3, Ruler, Type, BarChart3, Check, ChevronDown, LayoutGrid, ArrowUpRight, TrendingUp } from "lucide-react";
import { storage } from "../lib/storage";
import { volumeOnChartIndicator, deltaIndicator, cvdIndicator, clusterSearchIndicator } from "../indicators";

interface ClusterChartProps {
  candles: ClusterCandle[];
  activePair: CryptoPair;
  indicators?: Indicator[];
  activeIndicators?: Record<string, boolean>;
  indicatorSettings?: Record<string, any>;
  marketType?: "SPOT" | "FUTURES";
  onToggleMarketType?: () => void;
  theme?: "dark" | "light";
  candleType?: "auto" | "japanese" | "footprint" | "clusters";
  candleDataType?: "bid_ask" | "delta" | "volume";
  candlePalette?: "default" | "alternative";
  onToggleIndicator?: (id: string) => void;
  onRemoveIndicator?: (id: string) => void;
  onShowIndicatorsSettings?: () => void;
  language?: "RU" | "EN" | "KZ";
  workspaceLayout?: "1" | "2h" | "2v";
  onWorkspaceLayoutChange?: (layout: "1" | "2h" | "2v") => void;
  workspacesCount?: number;
  onLoadMore?: (oldestCandleTime: number) => void;
  isLoadingMore?: boolean;
}

export default function ClusterChart({
  candles,
  activePair,
  indicators,
  activeIndicators = {
    clusterSearch: true,
    delta: true,
    volume: true,
    cvd: true,
    stackedImbalance: false
  },
  indicatorSettings,
  marketType = "SPOT",
  onToggleMarketType,
  theme = "dark",
  candleType = "auto",
  candleDataType = "bid_ask",
  candlePalette = "default",
  onToggleIndicator,
  onRemoveIndicator,
  onShowIndicatorsSettings,
  language = "EN",
  workspaceLayout,
  onWorkspaceLayoutChange,
  workspacesCount = 1,
  onLoadMore,
  isLoadingMore = false
}: ClusterChartProps) {
  
  const isLight = theme === "light";

  const [activeDrawingTool, setActiveDrawingTool] = useState<string | null>(null);
  const [drawings, setDrawings] = useState<any[]>([]);
  const [drawingInProgress, setDrawingInProgress] = useState<any | null>(null);
  const [selectedDrawingId, setSelectedDrawingId] = useState<number | null>(null);
  const [drawingDragState, setDrawingDragState] = useState<any | null>(null);

  // FPS Counter
  const [fps, setFps] = useState(0);
  const frameCountRef = useRef(0);
  const lastFpsTimeRef = useRef(performance.now());
  const rafIdRef = useRef<number>(0);

  const [selectedTimezone, setSelectedTimezone] = useState<string>(() => {
    return storage.get("procluster_chart_timezone") || "local";
  });

  const [showWorkspaceMenu, setShowWorkspaceMenu] = useState(false);
  const workspaceDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (workspaceDropdownRef.current && !workspaceDropdownRef.current.contains(event.target as Node)) {
        setShowWorkspaceMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  useEffect(() => {
    storage.set("procluster_chart_timezone", selectedTimezone);
  }, [selectedTimezone]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement as HTMLElement | null;
      if (activeEl && (
        activeEl.tagName === "INPUT" || 
        activeEl.tagName === "TEXTAREA" || 
        activeEl.contentEditable === "true"
      )) {
        return;
      }

      if ((e.key === "Delete" || e.key === "Backspace") && selectedDrawingId !== null) {
        e.preventDefault();
        setDrawings(prev => prev.filter(d => d.id !== selectedDrawingId));
        setSelectedDrawingId(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [selectedDrawingId]);

  const formatTimezoneString = (timestamp: number, isHovered: boolean) => {
    const date = new Date(timestamp);
    const timezoneOpt = selectedTimezone === "local" ? undefined : selectedTimezone;
    
    const timeStr = date.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: timezoneOpt,
    });
    
    if (isHovered) {
      const dateStr = date.toLocaleDateString(undefined, {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        timeZone: timezoneOpt,
      });
      return `${timeStr} ${dateStr}`;
    }
    
    return timeStr;
  };
  // Zoom state: width of each candlestick in pixels
  const [candleWidth, setCandleWidth] = useState<number>(145);
  const candleSpacing = Math.max(1, candleWidth < 30 ? Math.floor(candleWidth * 0.35) : 12);
  const margin = { top: 30, right: 90, bottom: 40, left: 60 };

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [containerHeight, setContainerHeight] = useState<number>(550);
  const [verticalScale, setVerticalScale] = useState<number>(0.7);

  const hasInitializedZoomRef = useRef<string | null>(null);

  // Height configurations dynamic calculations
  const [deltaPanelHeight, setDeltaPanelHeight] = useState<number>(() => {
    const saved = storage.get("procluster_delta_panel_height");
    return saved ? parseInt(saved, 10) : 120;
  });
  const [cvdPanelHeight, setCvdPanelHeight] = useState<number>(() => {
    const saved = storage.get("procluster_cvd_panel_height");
    return saved ? parseInt(saved, 10) : 120;
  });

  useEffect(() => {
    storage.set("procluster_delta_panel_height", deltaPanelHeight.toString());
  }, [deltaPanelHeight]);

  useEffect(() => {
    storage.set("procluster_cvd_panel_height", cvdPanelHeight.toString());
  }, [cvdPanelHeight]);

  const [resizingPanel, setResizingPanel] = useState<"delta" | "cvd" | null>(null);

  const panelGap = 24;
  const deltaHeightTotal = activeIndicators.delta ? (deltaPanelHeight + panelGap) : 0;
  const cvdHeightTotal = activeIndicators.cvd ? (cvdPanelHeight + panelGap) : 0;

  // Calculate base chart height to fill container exactly, ensuring Delta/CVD are always pinned at the bottom
  const chartHeight = Math.max(150, containerHeight - margin.top - margin.bottom - deltaHeightTotal - cvdHeightTotal);
  
  const deltaTopY = margin.top + chartHeight + (activeIndicators.delta ? panelGap : 0);
  const cvdTopY = deltaTopY + (activeIndicators.delta ? deltaPanelHeight : 0) + (activeIndicators.cvd ? panelGap : 0);

  const totalSvgHeight = margin.top + chartHeight + deltaHeightTotal + cvdHeightTotal + margin.bottom;

  const [hoveredCell, setHoveredCell] = useState<{ candleIndex: number; cell: ClusterCell } | null>(null);
  const [hoveredClusterSearch, setHoveredClusterSearch] = useState<{
    x: number;
    y: number;
    sumVolume: number;
    usdtVolume: number;
    bidPercent: number;
    askPercent: number;
    isBidDominant: boolean;
    isAskDominant: boolean;
    baseAsset: string;
    price: number;
    color: string;
    filterType: "medium" | "large";
  } | null>(null);
  const [crosshair, setCrosshair] = useState<{ x: number; y: number; price: number } | null>(null);

  // Drag-to-scroll panning variables supporting full vertical + horizontal scrolling
  const [isDragging, setIsDragging] = useState(false);
  const [startX, setStartX] = useState(0);
  const [startY, setStartY] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [visibleScrollLeft, setVisibleScrollLeft] = useState(0);
  const [visibleClientWidth, setVisibleClientWidth] = useState(800);
  const [priceCenterOffset, setPriceCenterOffset] = useState<number>(0);
  const [startPriceOffset, setStartPriceOffset] = useState<number>(0);

  // Synchronize state references for smooth zero-drift mouse wheel zooming
  const candleWidthRef = useRef<number>(145);
  const verticalScaleRef = useRef<number>(0.7);
  const priceCenterOffsetRef = useRef<number>(0);

  useEffect(() => {
    candleWidthRef.current = candleWidth;
  }, [candleWidth]);

  useEffect(() => {
    verticalScaleRef.current = verticalScale;
  }, [verticalScale]);

  useEffect(() => {
    priceCenterOffsetRef.current = priceCenterOffset;
  }, [priceCenterOffset]);

  // States and refs for interactive vertical scroll/zoom dragging on the price scale
  const [isDraggingPriceScale, setIsDraggingPriceScale] = useState(false);
  const startPriceScaleYRef = useRef<number>(0);
  const startVerticalScaleRef = useRef<number>(1.0);

  const [deltaScale, setDeltaScale] = useState<number>(1.0);
  const [cvdScale, setCvdScale] = useState<number>(1.0);

  const [isDraggingDeltaScale, setIsDraggingDeltaScale] = useState(false);
  const startDeltaScaleYRef = useRef<number>(0);
  const startDeltaScaleRef = useRef<number>(1.0);

  const [isDraggingCvdScale, setIsDraggingCvdScale] = useState(false);
  const startCvdScaleYRef = useRef<number>(0);
  const startCvdScaleRef = useRef<number>(1.0);

  // States and refs for interactive horizontal timescale zoom/scale dragging
  const [isDraggingTimeScale, setIsDraggingTimeScale] = useState(false);
  const startTimeScaleXRef = useRef<number>(0);
  const startCandleWidthRef = useRef<number>(145);
  const zoomAnchorIndexRef = useRef<number | null>(null);
  const zoomAnchorClickXRef = useRef<number>(0);

  // Dynamically measure container dimensions with ResizeObserver so CVD/delta are pinned perfectly to the bottom
  useEffect(() => {
    if (!containerRef.current) return;
    const resizeObserver = new ResizeObserver((entries) => {
      for (let entry of entries) {
        const height = containerRef.current?.clientHeight || entry.contentRect.height;
        if (height && height > 100) {
          setContainerHeight(height);
        }
        const width = containerRef.current?.clientWidth || entry.contentRect.width;
        if (width && width > 100) {
          setVisibleClientWidth(width);
        }
      }
    });
    resizeObserver.observe(containerRef.current);

    const initialHeight = containerRef.current.clientHeight;
    if (initialHeight && initialHeight > 100) {
      setContainerHeight(initialHeight);
    }
    const initialWidth = containerRef.current.clientWidth;
    if (initialWidth && initialWidth > 100) {
      setVisibleClientWidth(initialWidth);
    }

    return () => resizeObserver.disconnect();
  }, [candles.length]);

  const candlesToScale = useMemo(() => {
    // Keep reference to all loaded candles so the vertical scaling is 100% stable
    // and never shifts or jumps up/down when we zoom or scroll horizontally.
    return candles;
  }, [candles]);

  const priceBounds = useMemo(() => {
    if (candlesToScale.length === 0) {
      return { maxPriceRaw: 100, minPriceRaw: 0, priceRange: 100, basePriceCenter: 50 };
    }
    let maxPriceRaw = candlesToScale[0].high;
    let minPriceRaw = candlesToScale[0].low;
    for (let i = 0; i < candlesToScale.length; i++) {
      const c = candlesToScale[i];
      if (c.high > maxPriceRaw) maxPriceRaw = c.high;
      if (c.low < minPriceRaw) minPriceRaw = c.low;
    }
    const priceRange = maxPriceRaw - minPriceRaw || 1;
    const basePriceCenter = (maxPriceRaw + minPriceRaw) / 2;
    return { maxPriceRaw, minPriceRaw, priceRange, basePriceCenter };
  }, [candlesToScale]);

  const { maxPriceRaw, minPriceRaw, priceRange, basePriceCenter } = priceBounds;

  // We apply the vertical scale to the price range projection to stretch/compress candles visually!
  // verticalScale > 1.0 means we stretch vertically (narrower visible price range = taller candles)
  // verticalScale < 1.0 means we compress vertically (wider visible price range = flatter candles)
  const zoomedPriceRange = useMemo(() => priceRange / Math.max(0.1, verticalScale), [priceRange, verticalScale]);
  
  const priceCenter = useMemo(() => basePriceCenter + priceCenterOffset, [basePriceCenter, priceCenterOffset]);
  
  const maxPrice = useMemo(() => priceCenter + zoomedPriceRange * 0.58, [priceCenter, zoomedPriceRange]);
  const minPrice = useMemo(() => priceCenter - zoomedPriceRange * 0.58, [priceCenter, zoomedPriceRange]);

  const priceToY = (price: number) => {
    const range = maxPrice - minPrice || 1;
    return margin.top + chartHeight * (1 - (price - minPrice) / range);
  };

  const yToPrice = (y: number) => {
    const range = maxPrice - minPrice || 1;
    return minPrice + (1 - (y - margin.top) / Math.max(1, chartHeight)) * range;
  };

  // Standard trading wheel zoom engine (Standard wheel = zoom both directions at cursor; Ctrl+wheel = Horizontal zoom; Shift+wheel = Vertical zoom)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      
      const delta = e.deltaY;
      const direction = Math.sign(delta);
      if (direction === 0) return;

      const isCtrl = e.ctrlKey || e.metaKey;
      const isShift = e.shiftKey;

      const curCandleWidth = candleWidthRef.current;
      const curVerticalScale = verticalScaleRef.current;
      const curPriceCenterOffset = priceCenterOffsetRef.current;

      const rect = container.getBoundingClientRect();

      // Dynamic local helper to extract unclamped price from a physical Y coordinate given vertical scale and offset
      const extractPriceFromY = (yCoord: number, scaleVal: number, offsetVal: number) => {
        const zoomedRange = priceRange / Math.max(0.1, scaleVal);
        const centerPrice = basePriceCenter + offsetVal;
        const maxP = centerPrice + zoomedRange * 0.58;
        const minP = centerPrice - zoomedRange * 0.58;
        const range = maxP - minP || 1;
        return minP + (1 - (yCoord - margin.top) / Math.max(1, chartHeight)) * range;
      };

      if (isShift) {
        // Shift + Wheel -> zoom/stretch vertically centered on mouse position!
        const relativeY = e.clientY - rect.top;
        if (relativeY >= margin.top && relativeY <= margin.top + chartHeight) {
          const mousePrice = extractPriceFromY(relativeY, curVerticalScale, curPriceCenterOffset);
          const multiplier = direction < 0 ? 1.08 : 0.92;
          const nextVerticalScale = Math.min(2000.0, Math.max(0.1, curVerticalScale * multiplier));
          const actualMultiplier = nextVerticalScale / curVerticalScale;

          if (actualMultiplier !== 1) {
            const currentPriceCenter = basePriceCenter + curPriceCenterOffset;
            const newPriceCenter = mousePrice - (mousePrice - currentPriceCenter) / actualMultiplier;
            const nextPriceCenterOffset = newPriceCenter - basePriceCenter;

            setVerticalScale(nextVerticalScale);
            setPriceCenterOffset(nextPriceCenterOffset);

            // Update refs synchronously for any consecutive ticks in the same frame
            verticalScaleRef.current = nextVerticalScale;
            priceCenterOffsetRef.current = nextPriceCenterOffset;
          }
        }
      } else if (isCtrl) {
        // Ctrl + Wheel -> zoom horizontally centered on mouse position!
        const multiplier = direction < 0 ? 1.08 : 0.92;
        const nextWidth = curCandleWidth * multiplier;
        const minW = (candleType === "japanese" || candleType === "auto") ? 2 : 8;
        const nextWidthClamped = Math.min(450, Math.max(minW, nextWidth));

        if (nextWidthClamped !== curCandleWidth) {
          const mouseRelativeX = e.clientX - rect.left;
          const currentScrollLeft = container.scrollLeft;
          const chartCursorX = currentScrollLeft + mouseRelativeX;
          
          const activeChartX = chartCursorX - margin.left;
          
          const prevSpacing = Math.max(1, curCandleWidth < 30 ? Math.floor(curCandleWidth * 0.35) : 12);
          const nextSpacing = Math.max(1, nextWidthClamped < 30 ? Math.floor(nextWidthClamped * 0.35) : 12);
          
          const ratio = (nextWidthClamped + nextSpacing) / (curCandleWidth + prevSpacing);
          const newChartCursorX = margin.left + activeChartX * ratio;
          const nextScrollLeft = Math.max(0, newChartCursorX - mouseRelativeX);

          // Synchronously resize the HTML scroll spacer before scrolling to prevent clamping/drift
          const currentScrollRightPadding = Math.round(Number(container.clientWidth || 800) * 0.85);
          const nextScrollWidth = candles.length * (nextWidthClamped + nextSpacing) + margin.left + margin.right + currentScrollRightPadding;
          const spacer = container.querySelector("#procluster-chart-spacer") as HTMLElement;
          if (spacer) {
            spacer.style.width = `${nextScrollWidth}px`;
          }

          setCandleWidth(nextWidthClamped);
          container.scrollLeft = nextScrollLeft;
          setVisibleScrollLeft(nextScrollLeft);

          // Update ref synchronously for any consecutive ticks in the same frame
          candleWidthRef.current = nextWidthClamped;
        }
      } else {
        // Standard Wheel -> zoom BOTH horizontally and vertically centered on mouse position!
        
        // 1. Horizontal zoom
        const hMultiplier = direction < 0 ? 1.08 : 0.92;
        const nextWidth = curCandleWidth * hMultiplier;
        const minW = (candleType === "japanese" || candleType === "auto") ? 2 : 8;
        const nextWidthClamped = Math.min(450, Math.max(minW, nextWidth));

        let updatedScaleCandleWidth = curCandleWidth;
        if (nextWidthClamped !== curCandleWidth) {
          const mouseRelativeX = e.clientX - rect.left;
          const currentScrollLeft = container.scrollLeft;
          const chartCursorX = currentScrollLeft + mouseRelativeX;
          
          const activeChartX = chartCursorX - margin.left;
          
          const prevSpacing = Math.max(1, curCandleWidth < 30 ? Math.floor(curCandleWidth * 0.35) : 12);
          const nextSpacing = Math.max(1, nextWidthClamped < 30 ? Math.floor(nextWidthClamped * 0.35) : 12);
          
          const ratio = (nextWidthClamped + nextSpacing) / (curCandleWidth + prevSpacing);
          const newChartCursorX = margin.left + activeChartX * ratio;
          const nextScrollLeft = Math.max(0, newChartCursorX - mouseRelativeX);

          // Synchronously resize the HTML scroll spacer before scrolling to prevent clamping/drift
          const currentScrollRightPadding = Math.round(Number(container.clientWidth || 800) * 0.85);
          const nextScrollWidth = candles.length * (nextWidthClamped + nextSpacing) + margin.left + margin.right + currentScrollRightPadding;
          const spacer = container.querySelector("#procluster-chart-spacer") as HTMLElement;
          if (spacer) {
            spacer.style.width = `${nextScrollWidth}px`;
          }

          setCandleWidth(nextWidthClamped);
          container.scrollLeft = nextScrollLeft;
          setVisibleScrollLeft(nextScrollLeft);

          // Update ref synchronously for any consecutive ticks in the same frame
          candleWidthRef.current = nextWidthClamped;
          updatedScaleCandleWidth = nextWidthClamped;
        }

        // 2. Vertical zoom
        const relativeY = e.clientY - rect.top;
        if (relativeY >= margin.top && relativeY <= margin.top + chartHeight) {
          const mousePrice = extractPriceFromY(relativeY, curVerticalScale, curPriceCenterOffset);
          const vMultiplier = direction < 0 ? 1.08 : 0.92; // Use matching multiplier style for professional visual experience
          const nextVerticalScale = Math.min(2000.0, Math.max(0.1, curVerticalScale * vMultiplier));
          const actualMultiplier = nextVerticalScale / curVerticalScale;

          if (actualMultiplier !== 1) {
            const currentPriceCenter = basePriceCenter + curPriceCenterOffset;
            const newPriceCenter = mousePrice - (mousePrice - currentPriceCenter) / actualMultiplier;
            const nextPriceCenterOffset = newPriceCenter - basePriceCenter;

            setVerticalScale(nextVerticalScale);
            setPriceCenterOffset(nextPriceCenterOffset);

            // Update refs synchronously for any consecutive ticks in the same frame
            verticalScaleRef.current = nextVerticalScale;
            priceCenterOffsetRef.current = nextPriceCenterOffset;
          }
        }
      }
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      container.removeEventListener("wheel", handleWheel);
    };
  }, [
    candles.length, 
    candleType, 
    basePriceCenter, 
    priceRange, 
    chartHeight
  ]);

  // Auto-scroll to show the latest candles with a comfortable padding from the right price scale on mount or symbol change
  useEffect(() => {
    const container = containerRef.current;
    if (container && candles.length > 0) {
      const clientWidth = container.clientWidth || 800;

      // Ensure default zoom configuration on symbol change: 40 visible candles and 0.812 verticalScale (70% height)
      let currentWidth = candleWidth;
      if (hasInitializedZoomRef.current !== activePair.symbol) {
        const visibleWidth = clientWidth - margin.left - margin.right;
        const spacePerCandle = visibleWidth / 40;
        
        let bestWidth = 10;
        for (let w = 2; w < 120; w++) {
          const spacing = Math.max(1, w < 30 ? Math.floor(w * 0.35) : 12);
          if (w + spacing <= spacePerCandle) {
            bestWidth = w;
          } else {
            break;
          }
        }
        currentWidth = Math.max(2, bestWidth);
        setCandleWidth(currentWidth);

        // Centering on last 40 candles and scaling so they take up 70% of vertical height
        const last40 = candles.slice(-40);
        let maxL40 = candles[0]?.high || 100;
        let minL40 = candles[0]?.low || 0;
        if (last40.length > 0) {
          maxL40 = last40[0].high;
          minL40 = last40[0].low;
          for (let i = 0; i < last40.length; i++) {
            const c = last40[i];
            if (c.high > maxL40) maxL40 = c.high;
            if (c.low < minL40) minL40 = c.low;
          }
        }
        const rangeL40 = maxL40 - minL40 || 1;
        const centerL40 = (maxL40 + minL40) / 2;
        const targetVerticalScale = (priceRange * 0.812) / rangeL40;

        setVerticalScale(Math.min(2000.0, Math.max(0.1, targetVerticalScale)));
        setPriceCenterOffset(centerL40 - basePriceCenter);

        hasInitializedZoomRef.current = activePair.symbol;
      }

      const spacingVal = Math.max(1, currentWidth < 30 ? Math.floor(currentWidth * 0.35) : 12);
      const candlesTotalWidth = candles.length * (currentWidth + spacingVal);
      const lastCandleRight = margin.left + candlesTotalWidth;
      
      // Position the last candle with a neat 120px margin from the fixed price scale
      const targetScrollLeft = lastCandleRight - (clientWidth - margin.right - 120);
      
      // Calculate max scroll bounds using the extended scrollWidth padding
      const rightPadding = Math.round(clientWidth * 0.85);
      const computedScrollWidth = candlesTotalWidth + margin.left + margin.right + rightPadding;
      const maxScroll = computedScrollWidth - clientWidth;
      const finalScrollLeft = Math.max(0, Math.min(maxScroll, targetScrollLeft));
      
      container.scrollLeft = finalScrollLeft;
      setVisibleScrollLeft(finalScrollLeft);
      setVisibleClientWidth(clientWidth);
    }
  }, [activePair.symbol, candles.length, visibleClientWidth, priceRange, basePriceCenter]);

  // Adjust canvas zoom
  const handleZoom = (factor: number) => {
    setCandleWidth(prev => {
      const next = prev + factor;
      const minW = (candleType === "japanese" || candleType === "auto") ? 2 : 8;
      return Math.min(450, Math.max(minW, next));
    });
  };

  const handleVerticalZoom = (factor: number) => {
    setVerticalScale(prev => {
      const multiplier = factor > 0 ? 1.25 : 0.8;
      const next = prev * multiplier;
      return Math.min(2000.0, Math.max(0.1, next));
    });
  };

  const handleResetZoom = () => {
    if (visibleClientWidth > 100) {
      const visibleWidth = visibleClientWidth - margin.left - margin.right;
      const spacePerCandle = visibleWidth / 40;
      let bestWidth = 10;
      for (let w = 2; w < 120; w++) {
        const spacing = Math.max(1, w < 30 ? Math.floor(w * 0.35) : 12);
        if (w + spacing <= spacePerCandle) {
          bestWidth = w;
        } else {
          break;
        }
      }
      setCandleWidth(Math.max(2, bestWidth));
    } else {
      setCandleWidth(10);
    }
    
    // Centering on last 40 candles and scaling so they take up 70% of vertical height
    const last40 = candles.slice(-40);
    let maxL40 = candles[0]?.high || 100;
    let minL40 = candles[0]?.low || 0;
    if (last40.length > 0) {
      maxL40 = last40[0].high;
      minL40 = last40[0].low;
      for (let i = 0; i < last40.length; i++) {
        const c = last40[i];
        if (c.high > maxL40) maxL40 = c.high;
        if (c.low < minL40) minL40 = c.low;
      }
    }
    const rangeL40 = maxL40 - minL40 || 1;
    const centerL40 = (maxL40 + minL40) / 2;
    const targetVerticalScale = (priceRange * 0.812) / rangeL40;

    setVerticalScale(Math.min(2000.0, Math.max(0.1, targetVerticalScale)));
    setPriceCenterOffset(centerL40 - basePriceCenter);
  };

  // Find min/max price boundaries for mapping coordinates based on VISIBLE candles! (memoized)
  const visibleCandlesList = useMemo(() => {
    return candles.filter((_, cIdx) => {
      const x = margin.left + cIdx * (candleWidth + candleSpacing);
      return x + candleWidth >= visibleScrollLeft && x <= visibleScrollLeft + visibleClientWidth;
    });
  }, [candles, visibleScrollLeft, visibleClientWidth, candleWidth, candleSpacing]);



  // Compute scrollable content width - add a generous scroll zone on the right (85% of screen width) so users can freely drag the last candles away from the price scale
  const scrollRightPadding = Math.round(Number(visibleClientWidth || 800) * 0.85);
  const scrollWidth = candles.length * (candleWidth + candleSpacing) + margin.left + margin.right + scrollRightPadding;

  // Zoom threshold: Detailed cluster footprint mode vs default Candlestick view
  const isDetailedModeCalculated = candleWidth >= 15;
  const isDetailedMode = candleType === "japanese"
    ? false
    : (candleType === "footprint" || candleType === "clusters"
        ? true
        : isDetailedModeCalculated);

  // Panning drag-to-scroll handlers (supports 2D movement)
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // Only left click
    const target = e.target as HTMLElement;
    if (target.closest("button") || target.closest("select")) return; // skip for controls
    
    // If drawing tool is active, handle drawing instead of panning!
    if (activeDrawingTool) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (rect) {
        const clickX = e.clientX - rect.left;
        const clickY = e.clientY - rect.top;
        
        // Skip margin zones if needed, allow drawing in main chart panel
        if (clickY >= margin.top && clickY <= totalSvgHeight - margin.bottom && clickX >= margin.left) {
          const scrollRelativeX = clickX + visibleScrollLeft;
          const price = yToPrice(clickY);

          if (drawingInProgress && drawingInProgress.type === "channel" && drawingInProgress.stage === 2) {
            // COMPLETE THE CHANNEL DRAWING!
            const baselinePriceAtX = drawingInProgress.startPrice + (drawingInProgress.endPrice - drawingInProgress.startPrice) * 
              (drawingInProgress.endX === drawingInProgress.startX ? 0 : (scrollRelativeX - drawingInProgress.startX) / (drawingInProgress.endX - drawingInProgress.startX));
            const finalOffsetPrice = price - baselinePriceAtX;
            
            const finalDrawing = {
              ...drawingInProgress,
              offsetPrice: finalOffsetPrice,
              stage: undefined
            };
            
            setDrawings(prev => [...prev, finalDrawing]);
            setDrawingInProgress(null);
            setActiveDrawingTool(null);
            return;
          }

          if (activeDrawingTool === "horizontal") {
            // Horizontal level is placed instantly on one click!
            const newDrawing = {
              id: Date.now(),
              type: "horizontal",
              startX: scrollRelativeX,
              startPrice: price,
              endX: scrollRelativeX,
              endPrice: price,
              text: "",
            };
            setDrawings(prev => [...prev, newDrawing]);
            setActiveDrawingTool(null); // Reset drawing tool after placement
          } else {
            // Start a dragging drawing
            const isChannel = activeDrawingTool === "channel";
            setDrawingInProgress({
              id: Date.now(),
              type: activeDrawingTool,
              startX: scrollRelativeX,
              startPrice: price,
              endX: scrollRelativeX,
              endPrice: price,
              stage: isChannel ? 1 : undefined,
              offsetPrice: isChannel ? 0 : undefined,
              text: "",
            });
          }
          return; // Skip normal panning
        }
      }
    }

    // If not drawing, check if click hit a drawing or handle to drag/select it
    if (!activeDrawingTool && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      if (clickY >= margin.top && clickY <= totalSvgHeight - margin.bottom && clickX >= margin.left) {
        let foundDrawingId: number | null = null;
        let foundHandleIdx: number | null = null;

        // 1. Check selected drawing handles first
        if (selectedDrawingId !== null) {
          const d = drawings.find(item => item.id === selectedDrawingId);
          if (d) {
            const y1 = priceToY(d.startPrice);
            const y2 = priceToY(d.endPrice);
            const x1 = d.startX - visibleScrollLeft;
            const x2 = d.endX - visibleScrollLeft;
            
            let handles = [
              { x: x1, y: y1, idx: 1 },
              { x: x2, y: y2, idx: 2 },
              { x: x2, y: y1, idx: 3 },
              { x: x1, y: y2, idx: 4 }
            ];

            if (d.type === "channel") {
              const offset = d.offsetPrice !== undefined ? d.offsetPrice : ((activePair.priceStep || 0.1) * 20);
              const y1_offset = priceToY(d.startPrice + offset);
              const y2_offset = priceToY(d.endPrice + offset);
              handles = [
                { x: x1, y: y1, idx: 1 },
                { x: x2, y: y2, idx: 2 },
                { x: x2, y: y2_offset, idx: 3 },
                { x: x1, y: y1_offset, idx: 4 }
              ];
            }
            
            const clickedHandle = handles.find(h => {
              const dx = clickX - h.x;
              const dy = clickY - h.y;
              return Math.sqrt(dx * dx + dy * dy) <= 10;
            });
            
            if (clickedHandle) {
              foundDrawingId = d.id;
              foundHandleIdx = clickedHandle.idx;
            }
          }
        }

        // 2. If no handle, check if we clicked inside any drawing
        if (foundDrawingId === null) {
          for (let i = drawings.length - 1; i >= 0; i--) {
            const d = drawings[i];
            const y1 = priceToY(d.startPrice);
            const y2 = priceToY(d.endPrice);
            const x1 = d.startX - visibleScrollLeft;
            const x2 = d.endX - visibleScrollLeft;
            
            if (d.type === "volume" || d.type === "rect" || d.type === "ruler") {
              const minX = Math.min(x1, x2);
              const maxX = Math.max(x1, x2);
              const minY = Math.min(y1, y2);
              const maxY = Math.max(y1, y2);
              if (clickX >= minX && clickX <= maxX && clickY >= minY && clickY <= maxY) {
                foundDrawingId = d.id;
                break;
              }
            } else if (d.type === "trend" || d.type === "arrow" || d.type === "channel") {
              const dx1 = clickX - x1;
              const dy1 = clickY - y1;
              const dStart = Math.sqrt(dx1 * dx1 + dy1 * dy1);
              
              const dx2 = clickX - x2;
              const dy2 = clickY - y2;
              const dEnd = Math.sqrt(dx2 * dx2 + dy2 * dy2);
              
              const offsetVal = d.offsetPrice !== undefined ? d.offsetPrice : ((activePair.priceStep || 0.1) * 20);
              const y1_off = priceToY(d.startPrice + offsetVal);
              const y2_off = priceToY(d.endPrice + offsetVal);
              
              const dx1_off = clickX - x1;
              const dy1_off = clickY - y1_off;
              const dStart_off = Math.sqrt(dx1_off * dx1_off + dy1_off * dy1_off);
              
              const dx2_off = clickX - x2;
              const dy2_off = clickY - y2_off;
              const dEnd_off = Math.sqrt(dx2_off * dx2_off + dy2_off * dy2_off);

              if (dStart <= 10 || dEnd <= 10 || dStart_off <= 10 || dEnd_off <= 10) {
                foundDrawingId = d.id;
                break;
              }

              const checkLine = (px1: number, py1: number, px2: number, py2: number) => {
                const lineLen = Math.sqrt((px2 - px1) * (px2 - px1) + (py2 - py1) * (py2 - py1));
                if (lineLen > 0) {
                  const u = ((clickX - px1) * (px2 - px1) + (clickY - py1) * (py2 - py1)) / (lineLen * lineLen);
                  if (u >= 0 && u <= 1) {
                    const projX = px1 + u * (px2 - px1);
                    const projY = py1 + u * (py2 - py1);
                    const realDist = Math.sqrt((clickX - projX) * (clickX - projX) + (clickY - projY) * (clickY - projY));
                    if (realDist <= 8) return true;
                  }
                }
                return false;
              };

              if (checkLine(x1, y1, x2, y2) || checkLine(x1, y1_off, x2, y2_off)) {
                foundDrawingId = d.id;
                break;
              }
            } else if (d.type === "horizontal") {
              if (Math.abs(clickY - y1) <= 8) {
                foundDrawingId = d.id;
                break;
              }
            } else if (d.type === "text" || d.type === "fibonacci") {
              const minX = Math.min(x1, x2) - 10;
              const maxX = Math.max(x1, x2) + 10;
              const minY = Math.min(y1, y2) - 10;
              const maxY = Math.max(y1, y2) + 10;
              if (clickX >= minX && clickX <= maxX && clickY >= minY && clickY <= maxY) {
                foundDrawingId = d.id;
                break;
              }
            }
          }
        }

        if (foundDrawingId !== null) {
          setSelectedDrawingId(foundDrawingId);
          const d = drawings.find(item => item.id === foundDrawingId);
          if (d) {
            setDrawingDragState({
              id: foundDrawingId,
              type: foundHandleIdx !== null ? "handle" : "move",
              handleIndex: foundHandleIdx || undefined,
              initialX: clickX,
              initialY: clickY,
              initialStartX: d.startX,
              initialStartPrice: d.startPrice,
              initialEndX: d.endX,
              initialEndPrice: d.endPrice,
            });
            return; // Skip normal panning
          }
        } else {
          setSelectedDrawingId(null);
        }
      }
    }

    // Check if the click is in the timeline zone (at the bottom margin area of the canvas/container)
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      const clickY = e.clientY - rect.top;
      if (clickY >= totalSvgHeight - margin.bottom) {
        setIsDraggingTimeScale(true);
        startTimeScaleXRef.current = e.clientX;
        startCandleWidthRef.current = candleWidth;
        
        const clickXInContainer = e.clientX - rect.left;
        const currentScroll = containerRef.current?.scrollLeft || 0;
        const absoluteX = currentScroll + clickXInContainer;
        const xFromLeft = absoluteX - margin.left;
        zoomAnchorIndexRef.current = xFromLeft / (candleWidth + candleSpacing);
        zoomAnchorClickXRef.current = clickXInContainer;
        return; // skip standard 2D panning/dragging
      }
    }

    setIsDragging(true);
    setStartX(e.pageX - (containerRef.current?.offsetLeft || 0));
    setStartY(e.pageY - (containerRef.current?.offsetTop || 0));
    setScrollLeft(containerRef.current?.scrollLeft || 0);
    setStartPriceOffset(priceCenterOffset);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    // If we are actively drawing
    if (drawingInProgress && canvasRef.current) {
      e.preventDefault();
      const rect = canvasRef.current.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const scrollRelativeX = mouseX + visibleScrollLeft;
      const price = yToPrice(mouseY);

      setDrawingInProgress(prev => {
        if (!prev) return null;
        if (prev.type === "channel" && prev.stage === 2) {
          const baselinePriceAtX = prev.startPrice + (prev.endPrice - prev.startPrice) * (prev.endX === prev.startX ? 0 : (scrollRelativeX - prev.startX) / (prev.endX - prev.startX));
          const offsetPrice = price - baselinePriceAtX;
          return {
            ...prev,
            offsetPrice
          };
        }
        return {
          ...prev,
          endX: scrollRelativeX,
          endPrice: price,
        };
      });
      return; // Skip panning
    }

    // If dragging an existing drawing or handle
    if (drawingDragState && canvasRef.current) {
      e.preventDefault();
      const rect = canvasRef.current.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      setDrawings(prev => prev.map(d => {
        if (d.id === drawingDragState.id) {
          if (drawingDragState.type === "move") {
            const deltaX = mouseX - drawingDragState.initialX;
            const initialPrice = yToPrice(drawingDragState.initialY);
            const currentPrice = yToPrice(mouseY);
            const deltaPrice = currentPrice - initialPrice;
            return {
              ...d,
              startX: drawingDragState.initialStartX + deltaX,
              endX: drawingDragState.initialEndX + deltaX,
              startPrice: drawingDragState.initialStartPrice + deltaPrice,
              endPrice: drawingDragState.initialEndPrice + deltaPrice,
            };
          } else {
            const deltaX = mouseX - drawingDragState.initialX;
            const currentPrice = yToPrice(mouseY);
            let nextStartX = d.startX;
            let nextStartPrice = d.startPrice;
            let nextEndX = d.endX;
            let nextEndPrice = d.endPrice;
            let nextOffsetPrice = d.offsetPrice;
            
            if (d.type === "channel") {
              if (drawingDragState.handleIndex === 1) {
                nextStartX = drawingDragState.initialStartX + deltaX;
                nextStartPrice = currentPrice;
              } else if (drawingDragState.handleIndex === 2) {
                nextEndX = drawingDragState.initialEndX + deltaX;
                nextEndPrice = currentPrice;
              } else if (drawingDragState.handleIndex === 3) {
                nextOffsetPrice = currentPrice - d.endPrice;
              } else if (drawingDragState.handleIndex === 4) {
                nextOffsetPrice = currentPrice - d.startPrice;
              }
            } else {
              if (drawingDragState.handleIndex === 1) {
                nextStartX = drawingDragState.initialStartX + deltaX;
                nextStartPrice = currentPrice;
              } else if (drawingDragState.handleIndex === 2) {
                nextEndX = drawingDragState.initialEndX + deltaX;
                nextEndPrice = currentPrice;
              } else if (drawingDragState.handleIndex === 3) {
                nextEndX = drawingDragState.initialEndX + deltaX;
                nextStartPrice = currentPrice;
              } else if (drawingDragState.handleIndex === 4) {
                nextStartX = drawingDragState.initialStartX + deltaX;
                nextEndPrice = currentPrice;
              }
            }
            
            return {
              ...d,
              startX: nextStartX,
              startPrice: nextStartPrice,
              endX: nextEndX,
              endPrice: nextEndPrice,
              offsetPrice: nextOffsetPrice
            };
          }
        }
        return d;
      }));
      return; // Skip panning
    }

    if (!isDragging || !containerRef.current) return;
    e.preventDefault();
    
    const x = e.pageX - containerRef.current.offsetLeft;
    const walkX = x - startX; // 1.0 multiplier is mathematically perfect for 1:1 mouse tracking!
    const nextScroll = scrollLeft - walkX;
    containerRef.current.scrollLeft = nextScroll;
    setVisibleScrollLeft(nextScroll); // Update immediately for instant layout/canvas sync!

    const y = e.pageY - containerRef.current.offsetTop;
    const deltaY = y - startY;
    
    // Mathematically perfect 1:1 vertical mouse tracking based on current price range
    const currentPriceRange = maxPrice - minPrice;
    const priceChange = (deltaY / Math.max(1, chartHeight)) * currentPriceRange;
    setPriceCenterOffset(startPriceOffset + priceChange);
  };

  const handleMouseUpOrLeave = () => {
    if (drawingInProgress) {
      if (drawingInProgress.type === "channel" && drawingInProgress.stage === 1) {
        // Transition to stage 2!
        setDrawingInProgress(prev => {
          if (!prev) return null;
          return {
            ...prev,
            stage: 2
          };
        });
        return;
      }

      if (drawingInProgress.type === "text") {
        // Prompt for text
        const txt = prompt(language === "RU" ? "Введите текст для графика:" : "Enter your chart text:");
        if (txt && txt.trim()) {
          setDrawings(prev => [...prev, { ...drawingInProgress, text: txt }]);
        }
      } else {
        // Minimum distance safe check or let all slide
        setDrawings(prev => [...prev, drawingInProgress]);
      }
      setDrawingInProgress(null);
      setActiveDrawingTool(null); // Reset tool after drawing
      return;
    }

    if (drawingDragState) {
      setDrawingDragState(null);
      return;
    }

    setIsDragging(false);
  };

  // Mouse crosshair update builder
  const handleSvgMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const viewportWidth = visibleClientWidth || 800;

    // Check if hovered on the timeline strip at the bottom
    if (y >= totalSvgHeight - margin.bottom && y <= totalSvgHeight) {
      e.currentTarget.style.cursor = "ew-resize";
      setCrosshair(null);
      setHoveredCell(null);
      setHoveredClusterSearch(null);
      return;
    } else {
      e.currentTarget.style.cursor = "";
    }

    if (y >= margin.top && y <= totalSvgHeight - margin.bottom && x >= margin.left && x <= viewportWidth - margin.right) {
      const clampedYForPrice = Math.min(margin.top + chartHeight, Math.max(margin.top, y));
      const price = yToPrice(clampedYForPrice);
      setCrosshair({ x, y, price });

      const scrolledX = x + visibleScrollLeft;

      // Identify hovered cell mathematically
      const colIdx = Math.floor((scrolledX - margin.left) / (candleWidth + candleSpacing));
      if (colIdx >= 0 && colIdx < candles.length) {
        const candle = candles[colIdx];
        const candleX = margin.left + colIdx * (candleWidth + candleSpacing);
        
        if (scrolledX >= candleX && scrolledX <= candleX + candleWidth) {
          const step = activePair.priceStep;
          const cell = (candle.cells || []).find(cl => Math.abs(cl.price - price) <= step / 2);
          if (cell) {
            setHoveredCell({ candleIndex: colIdx, cell });
          } else {
            setHoveredCell(null);
          }
        } else {
          setHoveredCell(null);
        }
      } else {
        setHoveredCell(null);
      }

      // --- DYNAMIC CLUSTER SEARCH HOVER DETECTION ---
      let foundCS: any = null;
      if (activeIndicators.clusterSearch && colIdx >= 0 && colIdx < candles.length) {
        const csSettings = indicatorSettings?.clusterSearch || {};
        const csMergeLevels = typeof csSettings.csMergeLevels === "number" ? csSettings.csMergeLevels : 1;
        const csImbalancePercent = typeof csSettings.csImbalancePercent === "number" ? csSettings.csImbalancePercent : 60;
        
        // Medium Filter
        const csMedMinVolume = typeof csSettings.csMedMinVolume === "number" ? csSettings.csMedMinVolume : 100;
        const csMedMaxVolume = typeof csSettings.csMedMaxVolume === "number" ? csSettings.csMedMaxVolume : 500;
        const csMedMinSize = typeof csSettings.csMedMinSize === "number" ? csSettings.csMedMinSize : 4;
        const csMedMaxSize = typeof csSettings.csMedMaxSize === "number" ? csSettings.csMedMaxSize : 12;
        const csMedColorBid = csSettings.csMedColorBid || "#ef4444";
        const csMedColorAsk = csSettings.csMedColorAsk || "#10b981";
        
        // Large Filter
        const csLargeMinVolume = typeof csSettings.csLargeMinVolume === "number" ? csSettings.csLargeMinVolume : 500;
        const csLargeMinSize = typeof csSettings.csLargeMinSize === "number" ? csSettings.csLargeMinSize : 10;
        const csLargeMaxSize = typeof csSettings.csLargeMaxSize === "number" ? csSettings.csLargeMaxSize : 20;
        const csLargeColorBid = csSettings.csLargeColorBid || "#f43f5e";
        const csLargeColorAsk = csSettings.csLargeColorAsk || "#34d399";

        // Check neighboring candles for overlapping geometric elements
        const startC = Math.max(0, colIdx - 1);
        const endC = Math.min(candles.length - 1, colIdx + 1);

        for (let col = startC; col <= endC; col++) {
          const currentCandle = candles[col];
          const candleCells = currentCandle.cells || [];
          const sortedCells = [...candleCells].sort((a, b) => b.price - a.price);
          if (sortedCells.length === 0) continue;

          const colX = margin.left + col * (candleWidth + candleSpacing);
          const centerX = colX + candleWidth / 2;

          const maxBody = Math.max(currentCandle.open, currentCandle.close);
          const minBody = Math.min(currentCandle.open, currentCandle.close);

          const matches: Array<{
            filterType: "medium" | "large";
            sumVolume: number;
            bidPercent: number;
            askPercent: number;
            isBidDominant: boolean;
            isAskDominant: boolean;
            price: number;
            size: number;
            color: string;
          }> = [];

          // 1. Medium filter check
          const csMedEnabled = csSettings.csMedEnabled !== false;
          if (csMedEnabled) {
            const csMedMergeLevels = typeof csSettings.csMedMergeLevels === "number" ? csSettings.csMedMergeLevels : csMergeLevels;
            const csMedImbalancePercent = typeof csSettings.csMedImbalancePercent === "number" ? csSettings.csMedImbalancePercent : csImbalancePercent;
            const csMedMinDelta = typeof csSettings.csMedMinDelta === "number" ? csSettings.csMedMinDelta : 0;
            const csMedLocation = csSettings.csMedLocation || "any";

            const K_med = Math.max(1, Math.min(csMedMergeLevels, sortedCells.length));
            for (let i = 0; i <= sortedCells.length - K_med; i++) {
              let sumVolume = 0, sumBid = 0, sumAsk = 0;
              for (let j = 0; j < K_med; j++) {
                const cell = sortedCells[i + j];
                if (cell) {
                  sumVolume += cell.volume;
                  sumBid += cell.bid;
                  sumAsk += cell.ask;
                }
              }
              if (sumVolume <= 0) continue;
              if (sumVolume < csMedMinVolume || sumVolume > csMedMaxVolume) continue;

              const bidPercent = (sumBid / sumVolume) * 100;
              const askPercent = (sumAsk / sumVolume) * 105 ? (sumAsk / sumVolume) * 100 : 0; // Guard NaN
              const isBidDominant = bidPercent >= csMedImbalancePercent;
              const isAskDominant = askPercent >= csMedImbalancePercent;
              if (!isBidDominant && !isAskDominant) continue;

              const absDelta = Math.abs(sumAsk - sumBid);
              if (absDelta < csMedMinDelta) continue;

              const midPrice = (sortedCells[i].price + sortedCells[i + K_med - 1].price) / 2;
              if (csMedLocation === "body" && !(midPrice >= minBody && midPrice <= maxBody)) continue;
              if (csMedLocation === "lowerWick" && !(midPrice < minBody)) continue;
              if (csMedLocation === "upperWick" && !(midPrice > maxBody)) continue;

              const color = isBidDominant ? csMedColorBid : csMedColorAsk;
              const range = csMedMaxVolume - csMedMinVolume;
              const ratio = range > 0 ? Math.min(1.0, (sumVolume - csMedMinVolume) / range) : 0;
              const size = csMedMinSize + ratio * (csMedMaxSize - csMedMinSize);

              matches.push({
                filterType: "medium",
                sumVolume,
                bidPercent,
                askPercent,
                isBidDominant,
                isAskDominant,
                price: midPrice,
                size,
                color
              });
            }
          }

          // 2. Large filter check
          const csLargeEnabled = csSettings.csLargeEnabled !== false;
          if (csLargeEnabled) {
            const csLargeMergeLevels = typeof csSettings.csLargeMergeLevels === "number" ? csSettings.csLargeMergeLevels : csMergeLevels;
            const csLargeImbalancePercent = typeof csSettings.csLargeImbalancePercent === "number" ? csSettings.csLargeImbalancePercent : csImbalancePercent;
            const csLargeMinDelta = typeof csSettings.csLargeMinDelta === "number" ? csSettings.csLargeMinDelta : 0;
            const csLargeLocation = csSettings.csLargeLocation || "any";

            const K_large = Math.max(1, Math.min(csLargeMergeLevels, sortedCells.length));
            for (let i = 0; i <= sortedCells.length - K_large; i++) {
              let sumVolume = 0, sumBid = 0, sumAsk = 0;
              for (let j = 0; j < K_large; j++) {
                const cell = sortedCells[i + j];
                if (cell) {
                  sumVolume += cell.volume;
                  sumBid += cell.bid;
                  sumAsk += cell.ask;
                }
              }
              if (sumVolume <= 0) continue;
              if (sumVolume < csLargeMinVolume) continue;

              const bidPercent = (sumBid / sumVolume) * 100;
              const askPercent = (sumAsk / sumVolume) * 100;
              const isBidDominant = bidPercent >= csLargeImbalancePercent;
              const isAskDominant = askPercent >= csLargeImbalancePercent;
              if (!isBidDominant && !isAskDominant) continue;

              const absDelta = Math.abs(sumAsk - sumBid);
              if (absDelta < csLargeMinDelta) continue;

              const midPrice = (sortedCells[i].price + sortedCells[i + K_large - 1].price) / 2;
              if (csLargeLocation === "body" && !(midPrice >= minBody && midPrice <= maxBody)) continue;
              if (csLargeLocation === "lowerWick" && !(midPrice < minBody)) continue;
              if (csLargeLocation === "upperWick" && !(midPrice > maxBody)) continue;

              const color = isBidDominant ? csLargeColorBid : csLargeColorAsk;
              const range = csLargeMinVolume * 2;
              const ratio = range > 0 ? Math.min(1.0, (sumVolume - csLargeMinVolume) / range) : 0;
              const size = csLargeMinSize + ratio * (csLargeMaxSize - csLargeMinSize);

              matches.push({
                filterType: "large",
                sumVolume,
                bidPercent,
                askPercent,
                isBidDominant,
                isAskDominant,
                price: midPrice,
                size,
                color
              });
            }
          }

          // Check click / hover distance on computed matches
          for (const match of matches) {
            const screenX = centerX - visibleScrollLeft;
            const screenY = priceToY(match.price);

            const dx = x - screenX;
            const dy = y - screenY;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance <= Math.max(12, match.size / 2 + 8)) {
              const baseAsset = activePair.symbol.split("/")[0] || "BTC";
              foundCS = {
                x: screenX,
                y: screenY,
                sumVolume: match.sumVolume,
                usdtVolume: match.sumVolume * match.price,
                bidPercent: match.bidPercent,
                askPercent: match.askPercent,
                isBidDominant: match.isBidDominant,
                isAskDominant: match.isAskDominant,
                baseAsset,
                price: match.price,
                color: match.color,
                filterType: match.filterType
              };
              break;
            }
          }
          if (foundCS) break;
        }
      }
      setHoveredClusterSearch(foundCS);
    } else {
      setCrosshair(null);
      setHoveredCell(null);
      setHoveredClusterSearch(null);
    }
  };

  const handleSvgMouseLeave = () => {
    setCrosshair(null);
    setHoveredCell(null);
    setHoveredClusterSearch(null);
  };

  // Profile aggregates: Horizontal Session Profile drawn on the vertical scale.
  // Slices price ranges and sums volumes from visible candles
  const generateSessionProfile = () => {
    const profileRange = maxPrice - minPrice;
    const bucketCount = 20;
    const bucketSize = (profileRange / bucketCount) || 1;
    const buckets = Array.from({ length: bucketCount }, (_, i) => ({
      price: minPrice + i * bucketSize + bucketSize / 2,
      volume: 0,
    }));

    if (candles.length > 0) {
      candles.forEach(candle => {
        (candle.cells || []).forEach(cell => {
          const bucketIdx = Math.floor((cell.price - minPrice) / bucketSize);
          if (bucketIdx >= 0 && bucketIdx < bucketCount) {
            buckets[bucketIdx].volume += cell.volume;
          }
        });
      });
    }

    const maxProfileVol = Math.max(...buckets.map(b => b.volume), 1);
    return { buckets, maxProfileVol, bucketSize };
  };

  // Memoize Session Profile
  const { buckets: profileBuckets, maxProfileVol, bucketSize: profileBucketSize } = useMemo(() => {
    const profileRange = maxPrice - minPrice;
    const bucketCount = 20;
    const bucketSize = (profileRange / bucketCount) || 1;
    const buckets = Array.from({ length: bucketCount }, (_, i) => ({
      price: minPrice + i * bucketSize + bucketSize / 2,
      volume: 0,
    }));

    if (candles.length > 0) {
      candles.forEach(candle => {
        (candle.cells || []).forEach(cell => {
          const bucketIdx = Math.floor((cell.price - minPrice) / bucketSize);
          if (bucketIdx >= 0 && bucketIdx < bucketCount) {
            buckets[bucketIdx].volume += cell.volume;
          }
        });
      });
    }

    let maxProfileVol = 1;
    for (let i = 0; i < buckets.length; i++) {
      if (buckets[i].volume > maxProfileVol) maxProfileVol = buckets[i].volume;
    }
    return { buckets, maxProfileVol, bucketSize };
  }, [candles, minPrice, maxPrice]);

  // Find overall maximum cell volume to properly scale cell footprint horizontal bars (memoized)
  const maxCellVolume = useMemo(() => {
    let max = 1;
    for (let c = 0; c < candles.length; c++) {
      const cells = candles[c].cells || [];
      for (let i = 0; i < cells.length; i++) {
        if (cells[i].volume > max) {
          max = cells[i].volume;
        }
      }
    }
    return max;
  }, [candles]);

  // Compute high delta for standard delta chart scaling (memoized) using visible candles
  const maxCandleDelta = useMemo(() => {
    let max = 1;
    for (let i = 0; i < candlesToScale.length; i++) {
      const absDelta = Math.abs(candlesToScale[i].delta);
      if (absDelta > max) max = absDelta;
    }
    return max;
  }, [candlesToScale]);

  // Zoomed version of maxCandleDelta based on user vertical dragging/zooming
  const zoomedMaxCandleDelta = useMemo(() => {
    return maxCandleDelta / Math.max(0.01, deltaScale);
  }, [maxCandleDelta, deltaScale]);

  // Find overall maximum cell delta to properly scale imbalance highlights (memoized)
  const maxCellDelta = useMemo(() => {
    let max = 1;
    for (let c = 0; c < candles.length; c++) {
      const cells = candles[c].cells || [];
      for (let i = 0; i < cells.length; i++) {
        const d = Math.abs(cells[i].ask - cells[i].bid);
        if (d > max) max = d;
      }
    }
    return max;
  }, [candles]);

  // Generate Cumulative Delta Line Coordinates (memoized)
  const cumulativeDeltaPoints = useMemo(() => {
    const rawCvd = cvdIndicator.calculateCVD(candles);
    return rawCvd.map((item, i) => {
      const cx = margin.left + i * (candleWidth + candleSpacing) + candleWidth / 2;
      return { cx, value: item.value };
    });
  }, [candles, candleWidth, candleSpacing]);

  // Dynamically calculate visible min and max cumulative delta for local auto-scaling to fill 80% height
  const { minCumDeltaVal, maxCumDeltaVal, cvdDeltaRange } = useMemo(() => {
    if (cumulativeDeltaPoints.length === 0) {
      return { minCumDeltaVal: 0, maxCumDeltaVal: 1, cvdDeltaRange: 1 };
    }
    const viewportWidth = visibleClientWidth || 800;
    const startIdx = Math.max(0, Math.floor((visibleScrollLeft - margin.left - candleWidth) / (candleWidth + candleSpacing)));
    const endIdx = Math.min(cumulativeDeltaPoints.length - 1, Math.ceil((visibleScrollLeft + viewportWidth - margin.left) / (candleWidth + candleSpacing)));
    
    let minVal = Infinity;
    let maxVal = -Infinity;
    for (let i = startIdx; i <= endIdx; i++) {
      if (cumulativeDeltaPoints[i]) {
        const val = cumulativeDeltaPoints[i].value;
        if (val < minVal) minVal = val;
        if (val > maxVal) maxVal = val;
      }
    }
    if (minVal === Infinity || maxVal === -Infinity) {
      // Fallback if none are visible
      minVal = cumulativeDeltaPoints[0].value;
      maxVal = cumulativeDeltaPoints[0].value;
      for (let i = 0; i < cumulativeDeltaPoints.length; i++) {
        const val = cumulativeDeltaPoints[i].value;
        if (val < minVal) minVal = val;
        if (val > maxVal) maxVal = val;
      }
    }
    const range = Math.max(1, maxVal - minVal);
    return { minCumDeltaVal: minVal, maxCumDeltaVal: maxVal, cvdDeltaRange: range };
  }, [cumulativeDeltaPoints, visibleScrollLeft, visibleClientWidth, candleWidth, candleSpacing]);

  const zoomedCvdDeltaRange = useMemo(() => cvdDeltaRange / Math.max(0.01, cvdScale), [cvdDeltaRange, cvdScale]);
  const cvdCenterVal = useMemo(() => (maxCumDeltaVal + minCumDeltaVal) / 2, [maxCumDeltaVal, minCumDeltaVal]);
  const zoomedCvdMax = useMemo(() => cvdCenterVal + zoomedCvdDeltaRange * 0.5, [cvdCenterVal, zoomedCvdDeltaRange]);
  const zoomedCvdMin = useMemo(() => cvdCenterVal - zoomedCvdDeltaRange * 0.5, [cvdCenterVal, zoomedCvdDeltaRange]);

  const getCvdY = (val: number, panelH: number) => {
    return panelH - ((val - zoomedCvdMin) / zoomedCvdDeltaRange) * (panelH * 0.8) - (panelH * 0.1);
  };

  // Find dynamic maximum volume on visible part of the chart (memoized)
  const visibleMaxCellVol = useMemo(() => {
    let max = 1;
    for (let c = 0; c < visibleCandlesList.length; c++) {
      const cells = visibleCandlesList[c].cells || [];
      for (let i = 0; i < cells.length; i++) {
        if (cells[i].volume > max) {
          max = cells[i].volume;
        }
      }
    }
    return max;
  }, [visibleCandlesList]);

  const visibleMaxSingleVol = useMemo(() => {
    let max = 1;
    for (let c = 0; c < visibleCandlesList.length; c++) {
      const cells = visibleCandlesList[c].cells || [];
      for (let i = 0; i < cells.length; i++) {
        const cell = cells[i];
        if (cell.bid > max) max = cell.bid;
        if (cell.ask > max) max = cell.ask;
      }
    }
    return max;
  }, [visibleCandlesList]);

  // Window-level mouse resize tracker for indicator panels
  useEffect(() => {
    if (!resizingPanel) return;

    const handleWindowMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const relativeY = e.clientY - rect.top;

      if (resizingPanel === "delta") {
        const deltaBottomY = deltaTopY + deltaPanelHeight;
        const newHeight = Math.max(50, Math.min(350, deltaBottomY - relativeY));
        setDeltaPanelHeight(newHeight);
      } else if (resizingPanel === "cvd") {
        const cvdBottomY = cvdTopY + cvdPanelHeight;
        const newHeight = Math.max(50, Math.min(350, cvdBottomY - relativeY));
        setCvdPanelHeight(newHeight);
      }
    };

    const handleWindowMouseUp = () => {
      setResizingPanel(null);
    };

    window.addEventListener("mousemove", handleWindowMouseMove);
    window.addEventListener("mouseup", handleWindowMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleWindowMouseMove);
      window.removeEventListener("mouseup", handleWindowMouseUp);
    };
  }, [resizingPanel, deltaTopY, deltaPanelHeight, cvdTopY, cvdPanelHeight]);

  // Window-level mouse drag-zoom tracker for vertical price scale dragging
  useEffect(() => {
    if (!isDraggingPriceScale) return;

    const handleWindowMouseMove = (e: MouseEvent) => {
      const deltaY = startPriceScaleYRef.current - e.clientY;
      // Exponential zoom feel: dragging up zooms in, dragging down zooms out
      const multiplier = Math.exp(deltaY / 200);
      const nextScale = startVerticalScaleRef.current * multiplier;
      const clampedScale = Math.min(2000.0, Math.max(0.1, nextScale));
      setVerticalScale(clampedScale);
    };

    const handleWindowMouseUp = () => {
      setIsDraggingPriceScale(false);
    };

    window.addEventListener("mousemove", handleWindowMouseMove);
    window.addEventListener("mouseup", handleWindowMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleWindowMouseMove);
      window.removeEventListener("mouseup", handleWindowMouseUp);
    };
  }, [isDraggingPriceScale]);

  // Window-level mouse drag-zoom tracker for vertical Delta scale dragging
  useEffect(() => {
    if (!isDraggingDeltaScale) return;

    const handleWindowMouseMove = (e: MouseEvent) => {
      const deltaY = startDeltaScaleYRef.current - e.clientY;
      const multiplier = Math.exp(deltaY / 200);
      const nextScale = startDeltaScaleRef.current * multiplier;
      const clampedScale = Math.min(200.0, Math.max(0.01, nextScale));
      setDeltaScale(clampedScale);
    };

    const handleWindowMouseUp = () => {
      setIsDraggingDeltaScale(false);
    };

    window.addEventListener("mousemove", handleWindowMouseMove);
    window.addEventListener("mouseup", handleWindowMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleWindowMouseMove);
      window.removeEventListener("mouseup", handleWindowMouseUp);
    };
  }, [isDraggingDeltaScale]);

  // Window-level mouse drag-zoom tracker for vertical CVD scale dragging
  useEffect(() => {
    if (!isDraggingCvdScale) return;

    const handleWindowMouseMove = (e: MouseEvent) => {
      const deltaY = startCvdScaleYRef.current - e.clientY;
      const multiplier = Math.exp(deltaY / 200);
      const nextScale = startCvdScaleRef.current * multiplier;
      const clampedScale = Math.min(200.0, Math.max(0.01, nextScale));
      setCvdScale(clampedScale);
    };

    const handleWindowMouseUp = () => {
      setIsDraggingCvdScale(false);
    };

    window.addEventListener("mousemove", handleWindowMouseMove);
    window.addEventListener("mouseup", handleWindowMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleWindowMouseMove);
      window.removeEventListener("mouseup", handleWindowMouseUp);
    };
  }, [isDraggingCvdScale]);

  // Window-level mouse drag-zoom tracker for horizontal timeline scale dragging
  useEffect(() => {
    if (!isDraggingTimeScale) return;

    const handleWindowMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - startTimeScaleXRef.current;
      // Linear zoom mapping starting from our cached candleWidth.
      // If we move mouse to the right, we stretch (increase candleWidth).
      // If we move mouse to the left, we squeeze (decrease candleWidth).
      const nextW = startCandleWidthRef.current + deltaX * 1.0;
      const minW = (candleType === "japanese" || candleType === "auto") ? 2 : 8;
      const clampedW = Math.min(450, Math.max(minW, nextW));

      setCandleWidth(clampedW);

      if (zoomAnchorIndexRef.current !== null && containerRef.current) {
        const targetAbsoluteX = zoomAnchorIndexRef.current * (clampedW + candleSpacing) + margin.left;
        const nextScrollLeft = targetAbsoluteX - zoomAnchorClickXRef.current;
        
        // Calculate the maximum actual scroll boundaries using the prospective width
        const scrollWidthCalculated = candles.length * (clampedW + candleSpacing) + margin.left + margin.right + scrollRightPadding;
        const maxScroll = Math.max(0, scrollWidthCalculated - (containerRef.current.clientWidth || 800));
        const clampedScrollLeft = Math.max(0, Math.min(maxScroll, nextScrollLeft));

        setVisibleScrollLeft(clampedScrollLeft);
        containerRef.current.scrollLeft = clampedScrollLeft;
      }
    };

    const handleWindowMouseUp = () => {
      setIsDraggingTimeScale(false);
    };

    window.addEventListener("mousemove", handleWindowMouseMove);
    window.addEventListener("mouseup", handleWindowMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleWindowMouseMove);
      window.removeEventListener("mouseup", handleWindowMouseUp);
    };
  }, [
    isDraggingTimeScale, 
    candleSpacing, 
    margin.left, 
    margin.right, 
    candles.length, 
    scrollRightPadding,
    candleType
  ]);

  // Find hovered candle's values in components main render scope so overlays can display them dynamically
  const hoveredCandleIdx = crosshair
    ? Math.floor((crosshair.x - margin.left) / (candleWidth + candleSpacing))
    : -1;
  const hoveredCandle = (hoveredCandleIdx >= 0 && hoveredCandleIdx < candles.length) ? candles[hoveredCandleIdx] : null;

  const deltaValueText = hoveredCandle 
    ? `${hoveredCandle.delta >= 0 ? "+" : ""}${hoveredCandle.delta.toFixed(1)}K`
    : "--";

  const cvdValueText = (hoveredCandleIdx >= 0 && hoveredCandleIdx < cumulativeDeltaPoints.length)
    ? `${cumulativeDeltaPoints[hoveredCandleIdx].value >= 0 ? "+" : ""}${cumulativeDeltaPoints[hoveredCandleIdx].value.toFixed(1)}K`
    : "--";

  useEffect(() => {
    if (candles.length === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Scale canvas for ultra-crisp Retina/High-DPI support using the visible viewport size to avoid exceeding browser canvas limits
    const dpr = window.devicePixelRatio || 1;
    const viewportWidth = visibleClientWidth || 800;
    canvas.width = viewportWidth * dpr;
    canvas.height = totalSvgHeight * dpr;
    canvas.style.width = `${viewportWidth}px`;
    canvas.style.height = `${totalSvgHeight}px`;
    ctx.scale(dpr, dpr);

    ctx.textBaseline = "middle";

    // Clear and draw background (full viewport size)
    ctx.clearRect(0, 0, viewportWidth, totalSvgHeight);
    ctx.fillStyle = isLight ? "rgba(248, 250, 252, 0.15)" : "#06080f";
    ctx.fillRect(0, 0, viewportWidth, totalSvgHeight);

    // -------------------------------------------------------------------------
    // RENDER TRADINGVIEW-STYLE INTEGRATED CHART WATERMARK
    // -------------------------------------------------------------------------
    ctx.save();
    // Center it horizontally across the active visible candle plot area (excluding margins)
    const watermarkX = margin.left + (viewportWidth - margin.left - margin.right) / 2;
    // Center it vertically in the main candles chart height
    const watermarkY = margin.top + chartHeight / 2;

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // Primary watermark string "PROCLUSTER"
    ctx.font = `bold 64px 'Space Grotesk', 'Inter', -apple-system, sans-serif`;
    ctx.fillStyle = isLight ? "rgba(15, 23, 42, 0.03)" : "rgba(255, 255, 255, 0.025)";
    ctx.fillText("PROCLUSTER", watermarkX, watermarkY - 14);

    // Secondary sub-line with active instrument details
    ctx.font = `600 12px 'JetBrains Mono', 'Fira Code', monospace`;
    ctx.fillStyle = isLight ? "rgba(15, 23, 42, 0.05)" : "rgba(255, 255, 255, 0.05)";
    const currentSymbol = activePair.symbol.toUpperCase();
    const currentMarket = marketType || "SPOT";
    ctx.fillText(`${currentSymbol} • ${currentMarket} • 1M`, watermarkX, watermarkY + 28);
    ctx.restore();
    // -------------------------------------------------------------------------

    // Save context and apply translation for scroll-relative elements
    ctx.save();
    ctx.translate(-visibleScrollLeft, 0);

    // 1. Horizontal Grid Lines (Removed per user request to hide minor horizontal grid)

    // Solid horizontal separator line between main chart panel and subcharts
    if (activeIndicators.delta || activeIndicators.cvd) {
      ctx.beginPath();
      ctx.strokeStyle = isLight ? "rgba(148, 163, 184, 0.35)" : "rgba(255, 255, 255, 0.16)";
      ctx.lineWidth = 1.0;
      ctx.moveTo(0, margin.top + chartHeight);
      ctx.lineTo(scrollWidth, margin.top + chartHeight);
      ctx.stroke();
    }

    // Dividers between Delta and CVD panels if both are active
    if (activeIndicators.delta && activeIndicators.cvd) {
      ctx.beginPath();
      ctx.strokeStyle = isLight ? "rgba(148, 163, 184, 0.35)" : "rgba(255, 255, 255, 0.16)";
      ctx.lineWidth = 1.0;
      const midDividerY = deltaTopY + deltaPanelHeight + panelGap / 2;
      ctx.moveTo(0, midDividerY);
      ctx.lineTo(scrollWidth, midDividerY);
      ctx.stroke();
    }

    // 2. Real-time active price tracker tag on chart grid
    const activePriceY = priceToY(activePair.price);
    if (activePriceY >= margin.top && activePriceY <= margin.top + chartHeight) {
      ctx.beginPath();
      ctx.strokeStyle = "rgba(245, 158, 11, 0.6)";
      ctx.lineWidth = 1.2;
      ctx.setLineDash([2, 2]);

      // Draw starting only from the current (latest) candle to the end of the chart scroll width
      const latestCandleIdx = Math.max(0, candles.length - 1);
      const latestCandleX = margin.left + latestCandleIdx * (candleWidth + candleSpacing);
      const startX = latestCandleX + candleWidth / 2;

      ctx.moveTo(startX, activePriceY);
      ctx.lineTo(scrollWidth, activePriceY);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 3. Draw Aggregated Session Profile on the left side of the chart (fixed on screen, so translate-invariant)
    if (activeIndicators.volume) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(margin.left + visibleScrollLeft, margin.top, viewportWidth, chartHeight);
      ctx.clip();

      profileBuckets.forEach((bucket) => {
        const bWidth = (bucket.volume / maxProfileVol) * 65;
        const bY = priceToY(bucket.price) - (profileBucketSize / (maxPrice - minPrice)) * chartHeight / 2;
        const bHeight = Math.max(2, (profileBucketSize / (maxPrice - minPrice)) * chartHeight - 1.5);
        
        ctx.fillStyle = isLight ? "rgba(71, 85, 105, 0.1)" : "rgba(148, 163, 184, 0.08)";
        ctx.fillRect(margin.left + visibleScrollLeft, bY, bWidth, bHeight);

        ctx.strokeStyle = isLight ? "rgba(71, 85, 105, 0.2)" : "rgba(148, 163, 184, 0.18)";
        ctx.lineWidth = 0.8;
        ctx.strokeRect(margin.left + visibleScrollLeft, bY, bWidth, bHeight);
      });
      ctx.restore();
    }



    const startIdx = Math.max(0, Math.floor((visibleScrollLeft - margin.left - candleWidth) / (candleWidth + candleSpacing)));
    const endIdx = Math.min(candles.length - 1, Math.ceil((visibleScrollLeft + viewportWidth - margin.left) / (candleWidth + candleSpacing)));
    const visibleCandlesCount = endIdx - startIdx + 1;
    const hideFootprintNumbers = visibleCandlesCount > 70;

    // 3.5 Draw Vertical Daily Session Separators (Vertical grid of daily session boundary)
    const tzOpt = selectedTimezone === "local" ? undefined : selectedTimezone;
    ctx.save();
    ctx.strokeStyle = isLight ? "rgba(15, 23, 42, 0.22)" : "rgba(255, 255, 255, 0.15)";
    ctx.lineWidth = 1.0;
    ctx.setLineDash([5, 5]);

    for (let cIdx = Math.max(1, startIdx); cIdx <= endIdx; cIdx++) {
      const prevCandle = candles[cIdx - 1];
      const currCandle = candles[cIdx];
      const d1 = new Date(prevCandle.timestamp);
      const d2 = new Date(currCandle.timestamp);
      const d1Str = d1.toLocaleDateString("en-US", { timeZone: tzOpt });
      const d2Str = d2.toLocaleDateString("en-US", { timeZone: tzOpt });

      if (d1Str !== d2Str) {
        const x = margin.left + cIdx * (candleWidth + candleSpacing) - candleSpacing / 2;
        ctx.beginPath();
        ctx.moveTo(x, margin.top);
        ctx.lineTo(x, totalSvgHeight - margin.bottom);
        ctx.stroke();
      }
    }
    ctx.restore();

    // Pre-calculate visible max total candle volume for scaling volumeOnChart
    let visibleMaxCandleVolume = 1;
    for (let cIdx = startIdx; cIdx <= endIdx; cIdx++) {
      if (candles[cIdx] && candles[cIdx].volume > visibleMaxCandleVolume) {
        visibleMaxCandleVolume = candles[cIdx].volume;
      }
    }

    // 4. Draw each visible candlestick
    for (let cIdx = startIdx; cIdx <= endIdx; cIdx++) {
      const candle = candles[cIdx];
      const x = margin.left + cIdx * (candleWidth + candleSpacing);
      const bodyY1 = priceToY(Math.max(candle.open, candle.close));
      const bodyY2 = priceToY(Math.min(candle.open, candle.close));
      const isGreen = candle.close >= candle.open;

      // Determine the dynamic/live POC cell of the candle based on the visible vertical range [minPrice, maxPrice]
      const candleCells = candle.cells || [];
      const visibleCellsOfCandle = candleCells.filter(cl => cl.price >= minPrice && cl.price <= maxPrice);
      const activePocCell = visibleCellsOfCandle.length > 0
        ? visibleCellsOfCandle.reduce((max, c) => c.volume > max.volume ? c : max, visibleCellsOfCandle[0])
        : (candleCells.length > 0 
           ? candleCells.reduce((max, c) => c.volume > max.volume ? c : max, candleCells[0])
           : null);

      const activePocPrice = activePocCell ? activePocCell.price : candle.pocPrice;

      const hoveredCandleIdx = crosshair
        ? Math.floor((crosshair.x - margin.left) / (candleWidth + candleSpacing))
        : -1;
      const isHoveredCol = crosshair && cIdx === hoveredCandleIdx;

      // Column alignment gridline removed per user request to hide minor background grids

      // Clip candlesticks, footprints and any extra overflow elements to the main chart region [margin.top, margin.top + chartHeight]
      ctx.save();
      ctx.beginPath();
      ctx.rect(margin.left, margin.top, scrollWidth - margin.left + 50, chartHeight);
      ctx.clip();

       // Draw volumeOnChart background histogram if active
       if (activeIndicators && activeIndicators.volumeOnChart) {
         const vocSettings = indicatorSettings?.volumeOnChart || {};
         const deltaThreshold = vocSettings.volumeOnChartDeltaThreshold ?? volumeOnChartIndicator.defaultSettings.volumeOnChartDeltaThreshold;
         const maxHPercent = vocSettings.volumeOnChartMaxHeightPercent ?? volumeOnChartIndicator.defaultSettings.volumeOnChartMaxHeightPercent;
         const vocOpacity = vocSettings.opacity != null ? vocSettings.opacity : volumeOnChartIndicator.defaultSettings.opacity;

         const barH = volumeOnChartIndicator.calculateBarHeight(candle.volume, visibleMaxCandleVolume, chartHeight, maxHPercent);
         const baseY = margin.top + chartHeight;
         const barY = baseY - barH;

         const { fillStyle, strokeStyle } = volumeOnChartIndicator.getStyles(candle.delta, deltaThreshold, isLight);

         ctx.save();
         ctx.globalAlpha = vocOpacity;
         ctx.fillStyle = fillStyle;
         ctx.strokeStyle = strokeStyle;
         ctx.lineWidth = 1.0;

         ctx.fillRect(x + 1, barY, candleWidth - 2, barH);
         ctx.strokeRect(x + 1, barY, candleWidth - 2, barH);
         ctx.restore();
       }

      // Determine colors based on palette
      const useAltPalette = candlePalette === "alternative";
      const bullFill = useAltPalette 
        ? (isLight ? "#E3E3E3" : "#B6B2B2") 
        : "#10b981";
      const bullBorder = useAltPalette 
        ? (isLight ? "#2F2F2F" : "#D5D5D5") 
        : "#10b981";
      const bullWick = useAltPalette 
        ? (isLight ? "#2F2F2F" : "#9D9D9D") 
        : "#10b981";

      const bearFill = useAltPalette 
        ? (isLight ? "#292929" : "#5E5E5E") 
        : "#f43f5e";
      const bearBorder = useAltPalette 
        ? (isLight ? "#3A3A3A" : "#AEA7A7") 
        : "#f43f5e";
      const bearWick = useAltPalette 
        ? (isLight ? "#3C3C3C" : "#7F7F7F") 
        : "#f43f5e";

      const candleFillColor = isGreen ? bullFill : bearFill;
      const candleBorderColor = isGreen ? bullBorder : bearBorder;
      const candleWickColor = isGreen ? bullWick : bearWick;

      // Draw vertical wick lines
      ctx.beginPath();
      ctx.strokeStyle = candleWickColor;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = isDetailedMode ? 0.45 : 0.85;
      ctx.moveTo(x + candleWidth / 2, priceToY(candle.high));
      ctx.lineTo(x + candleWidth / 2, priceToY(candle.low));
      ctx.stroke();
      ctx.globalAlpha = 1.0; // Reset

      // A. Zoomed out simple candlestick
      if (!isDetailedMode) {
        ctx.fillStyle = candleFillColor;
        ctx.strokeStyle = candleBorderColor;
        ctx.lineWidth = 1.5;
        
        const rectY = Math.min(bodyY1, bodyY2);
        const rectH = Math.max(3, Math.abs(bodyY1 - bodyY2));
        
        ctx.fillRect(x, rectY, candleWidth, rectH);
        ctx.strokeRect(x, rectY, candleWidth, rectH);
      }

      // B. Zoomed in Footprint detailed view
      if (isDetailedMode) {
        // Find maximums for normalization
        let candleMaxTotalVol = 1;
        let candleMaxSingleVal = 1;
        for (let i = 0; i < candleCells.length; i++) {
          const cell = candleCells[i];
          if (cell.volume > candleMaxTotalVol) {
            candleMaxTotalVol = cell.volume;
          }
          if (cell.bid > candleMaxSingleVal) {
            candleMaxSingleVal = cell.bid;
          }
          if (cell.ask > candleMaxSingleVal) {
            candleMaxSingleVal = cell.ask;
          }
        }
        const isClustersMode = candleType === "clusters";

        // Place the vertical separator/spine exactly in the center for symmetrical Bid/Ask columns
        const sepX = x + Math.round(candleWidth / 2);

        // 1. Draw elegant thin candlestick body core container outline box surrounding the open-close range (matches user screenshot)
        const bodyTopY = priceToY(Math.max(candle.open, candle.close));
        const bodyBottomY = priceToY(Math.min(candle.open, candle.close));
        const bodyH = Math.max(3, bodyBottomY - bodyTopY);
        
        ctx.strokeStyle = isGreen 
          ? (useAltPalette
              ? (isLight ? "rgba(47, 47, 47, 0.45)" : "rgba(213, 213, 213, 0.55)")
              : (isLight ? "rgba(16, 185, 129, 0.45)" : "rgba(16, 185, 129, 0.55)"))
          : (useAltPalette
              ? (isLight ? "rgba(58, 58, 58, 0.45)" : "rgba(174, 167, 167, 0.55)")
              : (isLight ? "rgba(239, 68, 68, 0.45)" : "rgba(239, 68, 68, 0.55)"));
        ctx.lineWidth = 1.0;
        ctx.strokeRect(x + 0.5, bodyTopY + 0.5, candleWidth - 1, bodyH - 1);

        // Draw the vertical separator line covering the entire high-low range of the cells
        if (candleCells.length > 0) {
          ctx.beginPath();
          ctx.strokeStyle = isLight ? "rgba(0, 0, 0, 0.16)" : "rgba(255, 255, 255, 0.16)";
          ctx.lineWidth = 1.0;
          const topPriceY = priceToY(candleCells[0].price + activePair.priceStep / 2);
          const bottomPriceY = priceToY(candleCells[candleCells.length - 1].price - activePair.priceStep / 2);
          ctx.moveTo(sepX, topPriceY);
          ctx.lineTo(sepX, bottomPriceY);
          ctx.stroke();
        }

        candleCells.forEach((cell, cellIdx) => {
          const cellBelow = candleCells[cellIdx + 1];
          const cellAbove = candleCells[cellIdx - 1];

          const isDiagonalBuyImbalance = !!(cellBelow && cell.ask > cellBelow.bid * 3.0 && cell.ask > 0);
          const isDiagonalSellImbalance = !!(cellAbove && cell.bid > cellAbove.ask * 3.0 && cell.bid > 0);

          const yTop = priceToY(cell.price + activePair.priceStep / 2);
          const yBottom = priceToY(cell.price - activePair.priceStep / 2);
          const cellHeight = Math.max(1.5, yBottom - yTop);
          const cellY = yTop;
          // Very neat horizontal brick gap for a crisp layout
          const drawHeight = Math.max(1.0, cellHeight - 0.6);

          const isCellPoc = cell.isPoc;

          // Compute volume normalization ratios
          const maxValSingle = visibleMaxSingleVol;
          const bidRatio = cell.bid > 0 ? cell.bid / maxValSingle : 0;
          const askRatio = cell.ask > 0 ? cell.ask / maxValSingle : 0;
          const volRatio = cell.volume > 0 ? cell.volume / visibleMaxCellVol : 0;

          // Double check Cluster Search parameters
          const csSettings = indicatorSettings?.clusterSearch || {
            mode: "Volume",
            direction: "Both",
            location: "Any",
            sensitivity: 4,
            useMinMax: false
          };
          const csSensitivity = typeof csSettings.sensitivity === "number" ? csSettings.sensitivity : 4;
          const sensFactor = 1 - csSensitivity * 0.06;
          const baseVolumeThreshold = maxCellVolume * sensFactor;

          let matchesClusterSearch = false;
          if (activeIndicators.clusterSearch) {
            let isTargetMode = false;
            if (csSettings.mode === "Delta") {
              const cellDelta = Math.abs(cell.ask - cell.bid);
              isTargetMode = cellDelta >= maxCellDelta * sensFactor;
            } else {
              isTargetMode = cell.volume >= baseVolumeThreshold;
            }

            let isTargetDirection = true;
            if (csSettings.direction === "Buy") {
              isTargetDirection = cell.ask > cell.bid;
            } else if (csSettings.direction === "Sell") {
              isTargetDirection = cell.bid > cell.ask;
            }

            let isTargetLocation = true;
            if (csSettings.location === "Body") {
              const isGreenBody = candle.close >= candle.open;
              const highBody = isGreenBody ? candle.close : candle.open;
              const lowBody = isGreenBody ? candle.open : candle.close;
              isTargetLocation = cell.price <= highBody && cell.price >= lowBody;
            } else if (csSettings.location === "Wick") {
              const isGreenBody = candle.close >= candle.open;
              const highBody = isGreenBody ? candle.close : candle.open;
              const lowBody = isGreenBody ? candle.open : candle.close;
              isTargetLocation = cell.price > highBody || cell.price < lowBody;
            }
            matchesClusterSearch = isTargetMode && isTargetDirection && isTargetLocation;
          }

          // A. Draw Cell Background Fills (Bid left, Ask right)
          if (candleDataType === "bid_ask") {
            // Keep backgrounds completely transparent like the screenshot for that neat, elegant footprint style and only use light lines
            ctx.strokeStyle = isLight ? "rgba(0, 0, 0, 0.02)" : "rgba(255, 255, 255, 0.02)";
            ctx.lineWidth = 0.5;
            ctx.strokeRect(x + 0.5, cellY + 0.5, candleWidth - 1, drawHeight);
          } else if (candleDataType === "delta") {
            const cellDeltaVal = cell.ask - cell.bid;
            const deltaRatio = Math.abs(cellDeltaVal) / maxValSingle;
            const deltaOpacity = 0.04 + deltaRatio * 0.45;
            const isBuyDelta = cellDeltaVal > 0;

            ctx.fillStyle = isBuyDelta
              ? (isLight ? `rgba(34, 197, 94, ${deltaOpacity * 0.70})` : `rgba(4, 120, 87, ${deltaOpacity})`)
              : (isLight ? `rgba(239, 68, 68, ${deltaOpacity * 0.70})` : `rgba(220, 38, 38, ${deltaOpacity})`);
            ctx.fillRect(x + 0.5, cellY + 0.5, candleWidth - 1, drawHeight);

            ctx.strokeStyle = isLight ? "rgba(0, 0, 0, 0.04)" : "rgba(255, 255, 255, 0.03)";
            ctx.lineWidth = 0.5;
            ctx.strokeRect(x + 0.5, cellY + 0.5, candleWidth - 1, drawHeight);
          } else if (candleDataType === "volume") {
            const volOpacity = 0.04 + volRatio * 0.45;
            ctx.fillStyle = isLight
              ? `rgba(100, 116, 139, ${volOpacity * 0.70})`
              : `rgba(148, 163, 184, ${volOpacity * 0.6})`;
            ctx.fillRect(x + 0.5, cellY + 0.5, candleWidth - 1, drawHeight);

            ctx.strokeStyle = isLight ? "rgba(0, 0, 0, 0.04)" : "rgba(255, 255, 255, 0.03)";
            ctx.lineWidth = 0.5;
            ctx.strokeRect(x + 0.5, cellY + 0.5, candleWidth - 1, drawHeight);
          }

          // B. Draw Beautiful Outward Growing Horizontal Profile Bars (Exactly matches the user screenshot)
          if (isClustersMode && candleDataType === "bid_ask") {
            const maxBarWidth = Math.round((candleWidth / 2) * 0.90);
            const bidBarWidth = cell.bid > 0 ? (cell.bid / maxValSingle) * maxBarWidth : 0;
            const askBarWidth = cell.ask > 0 ? (cell.ask / maxValSingle) * maxBarWidth : 0;

            const bidRatioClamped = Math.min(1.0, Math.max(0.0, bidRatio));
            const askRatioClamped = Math.min(1.0, Math.max(0.0, askRatio));

            // Histograms grow from the center line/spine (sepX) to both sides, corresponding to bids/asks volumes
            if (bidBarWidth > 0) {
              const op = isLight 
                ? (0.06 + bidRatioClamped * 0.68) 
                : (0.10 + bidRatioClamped * 0.85);
              ctx.fillStyle = isLight ? `rgba(220, 38, 38, ${op})` : `rgba(239, 68, 68, ${op})`;
              ctx.fillRect(sepX - bidBarWidth, cellY + 0.5, bidBarWidth, drawHeight);
            }
            if (askBarWidth > 0) {
              const op = isLight 
                ? (0.06 + askRatioClamped * 0.68) 
                : (0.10 + askRatioClamped * 0.85);
              ctx.fillStyle = isLight ? `rgba(22, 163, 74, ${op})` : `rgba(16, 185, 129, ${op})`;
              ctx.fillRect(sepX, cellY + 0.5, askBarWidth, drawHeight);
            }
          } else {
            const maxBarWidth = candleWidth - 2;
            const barWidth = cell.volume > 0 ? (cell.volume / visibleMaxCellVol) * maxBarWidth : 0;
            if (barWidth > 0) {
              const barIsBuy = cell.ask > cell.bid;
              ctx.fillStyle = barIsBuy
                ? (isLight ? "rgba(22, 163, 74, 0.35)" : "rgba(16, 185, 129, 0.45)")
                : (isLight ? "rgba(220, 38, 38, 0.35)" : "rgba(239, 68, 68, 0.45)");
              ctx.fillRect(x + 1, cellY + 0.5, barWidth, drawHeight);
            }
          }

          // C. Highlight Diagonal Buy / Sell Imbalance rows removed at user's request (only keep histograms)

          // D. Highlight Point of Control (POC) removed at user request

          // Old Cluster Search outline replaced by new beautiful shapes rendering

          // Stacked imbalance outline highlights removed at user request

          // Bid Ask standard text rendering or delta/volume mode
          if (cellHeight >= 4.0 && !hideFootprintNumbers) {
            ctx.save();
            ctx.shadowColor = isLight ? "rgba(255, 255, 255, 0.7)" : "rgba(0, 0, 0, 0.9)";
            ctx.shadowBlur = 1.0;
            ctx.shadowOffsetX = 0.5;
            ctx.shadowOffsetY = 0.5;
            ctx.textBaseline = "middle";

            // Intelligent adaptive precision volume formatter - prevents BTC/ETH cell numbers from showing as empty "0.0 x 0.0"
            const getFormatter = (maxSingleVal: number) => {
              if (maxSingleVal < 0.1) return (v: number) => v === 0 ? "0" : v.toFixed(4);
              if (maxSingleVal < 1.0) return (v: number) => v === 0 ? "0" : v.toFixed(3);
              if (maxSingleVal < 10.0) return (v: number) => v === 0 ? "0" : v.toFixed(2);
              if (maxSingleVal < 100.0) return (v: number) => v === 0 ? "0" : v.toFixed(1);
              return (v: number) => v === 0 ? "0" : v.toFixed(0);
            };

            const fmt = getFormatter(visibleMaxSingleVol);
            const bidValStr = fmt(cell.bid);
            const askValStr = fmt(cell.ask);
            const cellDeltaVal = cell.ask - cell.bid;
            const deltaDisplayStr = (cellDeltaVal > 0 ? "+" : cellDeltaVal < 0 ? "-" : "") + fmt(Math.abs(cellDeltaVal));
            const volStr = fmt(cell.volume);

             const ratioBid = candleMaxSingleVal > 0 ? (cell.bid / candleMaxSingleVal) : 0;
             const ratioAsk = candleMaxSingleVal > 0 ? (cell.ask / candleMaxSingleVal) : 0;
 
             const tBid = Math.pow(Math.min(1.0, Math.max(0.0, ratioBid)), 0.7);
             const tAsk = Math.pow(Math.min(1.0, Math.max(0.0, ratioAsk)), 0.7);
 
             let bidCol = "";
             if (isLight) {
               if (isDiagonalSellImbalance) {
                 const r = Math.round(195 + (180 - 195) * tBid);
                 const g = Math.round(170 + (30 - 170) * tBid);
                 const b = Math.round(170 + (40 - 170) * tBid);
                 bidCol = `rgb(${r}, ${g}, ${b})`;
               } else {
                 const r = Math.round(180 + (15 - 180) * tBid);
                 const g = Math.round(190 + (23 - 190) * tBid);
                 const b = Math.round(204 + (42 - 204) * tBid);
                 bidCol = `rgb(${r}, ${g}, ${b})`;
               }
             } else {
               if (isDiagonalSellImbalance) {
                 const r = Math.round(80 + (255 - 80) * tBid);
                 const g = Math.round(50 + (51 - 50) * tBid);
                 const b = Math.round(55 + (85 - 55) * tBid);
                 bidCol = `rgb(${r}, ${g}, ${b})`;
               } else {
                 const r = Math.round(65 + (255 - 65) * tBid);
                 const g = Math.round(78 + (255 - 78) * tBid);
                 const b = Math.round(92 + (255 - 92) * tBid);
                 bidCol = `rgb(${r}, ${g}, ${b})`;
               }
             }
 
             let askCol = "";
             if (isLight) {
               if (isDiagonalBuyImbalance) {
                 const r = Math.round(170 + (15 - 170) * tAsk);
                 const g = Math.round(195 + (120 - 195) * tAsk);
                 const b = Math.round(175 + (50 - 175) * tAsk);
                 askCol = `rgb(${r}, ${g}, ${b})`;
               } else {
                 const r = Math.round(180 + (15 - 180) * tAsk);
                 const g = Math.round(190 + (23 - 190) * tAsk);
                 const b = Math.round(204 + (42 - 204) * tAsk);
                 askCol = `rgb(${r}, ${g}, ${b})`;
               }
             } else {
               if (isDiagonalBuyImbalance) {
                 const r = Math.round(55 + (0 - 55) * tAsk);
                 const g = Math.round(80 + (245 - 80) * tAsk);
                 const b = Math.round(65 + (140 - 65) * tAsk);
                 askCol = `rgb(${r}, ${g}, ${b})`;
               } else {
                 const r = Math.round(65 + (255 - 65) * tAsk);
                 const g = Math.round(78 + (255 - 78) * tAsk);
                 const b = Math.round(92 + (255 - 92) * tAsk);
                 askCol = `rgb(${r}, ${g}, ${b})`;
               }
             }

            const textToMeasure = candleDataType === "bid_ask"
              ? `${bidValStr}x${askValStr}`
              : (candleDataType === "delta" ? deltaDisplayStr : volStr);
            const textLength = Math.max(1, textToMeasure.length);

            // Compute font sizes matching height and width perfectly, allowing vertical stretch scalability
            let idealSize = Math.max(5, Math.floor(cellHeight * 0.72));
            const maxByWidth = Math.max(7, Math.floor((candleWidth - 4) / (textLength * 0.55)));
            let finalFontSize = Math.min(idealSize, maxByWidth);
            // If the user stretched clusters vertically, allow font to upscale independently of narrow width restriction
            if (cellHeight > 24) {
              finalFontSize = Math.max(finalFontSize, Math.min(16, Math.floor(cellHeight * 0.65)));
            }
            if (finalFontSize < 5) finalFontSize = 5;
            if (finalFontSize > 28) finalFontSize = 28;
            const fontSizeVal = `${finalFontSize}px`;
            ctx.font = `${isCellPoc ? "bold" : "normal"} ${fontSizeVal} 'Inter', -apple-system, system-ui, sans-serif`;

            const drawCenteredBidAsk = (targetX: number, targetY: number) => {
              ctx.textAlign = "center";
              const separator = "x";
              const bidW = ctx.measureText(bidValStr).width;
              const sepW = ctx.measureText(separator).width;
              const askW = ctx.measureText(askValStr).width;
              // Slightly larger gap (widened) for beautiful readability across modes
              const gap = Math.max(3.5, finalFontSize * 0.32);
              const totalW = bidW + sepW + askW + gap * 2;

              const startX = targetX - totalW / 2;

              ctx.textAlign = "left";
              ctx.fillStyle = isCellPoc ? (isLight ? "#0f172a" : "#ffffff") : bidCol;
              ctx.fillText(bidValStr, startX, targetY);

              ctx.fillStyle = isCellPoc
                ? (isLight ? "rgba(15, 23, 42, 0.5)" : "rgba(255, 255, 255, 0.6)")
                : (isLight ? "rgba(15, 23, 42, 0.45)" : "rgba(255, 255, 255, 0.55)");
              ctx.fillText(separator, startX + bidW + gap, targetY);

              ctx.fillStyle = isCellPoc ? (isLight ? "#0f172a" : "#ffffff") : askCol;
              ctx.fillText(askValStr, startX + bidW + sepW + gap * 2, targetY);
            };

            const centerTextX = x + candleWidth / 2;

            if (isCellPoc) {
              // High contrast text on POC background (dark for light theme, white for dark theme)
              const pocTextCol = isLight ? "#0f172a" : "#ffffff";
              ctx.fillStyle = pocTextCol;
              if (candleDataType === "bid_ask") {
                drawCenteredBidAsk(centerTextX, cellY + cellHeight / 2);
              } else if (candleDataType === "delta") {
                ctx.textAlign = "center";
                ctx.fillText(deltaDisplayStr, centerTextX, cellY + cellHeight / 2);
              } else if (candleDataType === "volume") {
                ctx.textAlign = "center";
                ctx.fillText(volStr, centerTextX, cellY + cellHeight / 2);
              }
            } else {
              // Non-POC cells: Color depending on display type
              if (candleDataType === "bid_ask") {
                if (candleWidth >= 35) {
                  drawCenteredBidAsk(centerTextX, cellY + cellHeight / 2);
                }
              } else if (candleDataType === "delta") {
                ctx.fillStyle = isLight
                  ? (cellDeltaVal > 0 ? "#047857" : cellDeltaVal < 0 ? "#b91c1c" : "#475569")
                  : (cellDeltaVal > 0 ? "#10b981" : cellDeltaVal < 0 ? "#ef4444" : "#94a3b8");
                ctx.textAlign = "center";
                ctx.fillText(deltaDisplayStr, centerTextX, cellY + cellHeight / 2);
              } else if (candleDataType === "volume") {
                ctx.fillStyle = isLight ? "#1e293b" : "#cbd5e1";
                ctx.textAlign = "center";
                ctx.fillText(volStr, centerTextX, cellY + cellHeight / 2);
              }
            }
            ctx.restore();
          }
        });

        // Value Area Bracket removed at user request
          // No VAH/VAL vertical bracket lines
      }

      // --- DYNAMIC CLUSTER SEARCH (GEOMETRIC MULTI-LEVEL VISUALIZER) ---
      if (activeIndicators.clusterSearch && candleCells.length > 0) {
        const csSettings = indicatorSettings?.clusterSearch || {};
        
        const csMergeLevels = typeof csSettings.csMergeLevels === "number" ? csSettings.csMergeLevels : 1;
        const csImbalancePercent = typeof csSettings.csImbalancePercent === "number" ? csSettings.csImbalancePercent : 60;
        
        // Medium Filter
        const csMedMinVolume = typeof csSettings.csMedMinVolume === "number" ? csSettings.csMedMinVolume : 100;
        const csMedMaxVolume = typeof csSettings.csMedMaxVolume === "number" ? csSettings.csMedMaxVolume : 500;
        const csMedMinSize = typeof csSettings.csMedMinSize === "number" ? csSettings.csMedMinSize : 4;
        const csMedMaxSize = typeof csSettings.csMedMaxSize === "number" ? csSettings.csMedMaxSize : 12;
        const csMedShape = csSettings.csMedShape || "circle";
        const csMedColorBid = csSettings.csMedColorBid || "#ef4444";
        const csMedColorAsk = csSettings.csMedColorAsk || "#10b981";
        const csMedOpacity = typeof csSettings.csMedOpacity === "number" ? csSettings.csMedOpacity : 0.70;
        
        // Large Filter
        const csLargeMinVolume = typeof csSettings.csLargeMinVolume === "number" ? csSettings.csLargeMinVolume : 500;
        const csLargeMinSize = typeof csSettings.csLargeMinSize === "number" ? csSettings.csLargeMinSize : 10;
        const csLargeMaxSize = typeof csSettings.csLargeMaxSize === "number" ? csSettings.csLargeMaxSize : 20;
        const csLargeShape = csSettings.csLargeShape || "rhombus";
        const csLargeColorBid = csSettings.csLargeColorBid || "#f43f5e";
        const csLargeColorAsk = csSettings.csLargeColorAsk || "#34d399";
        const csLargeOpacity = typeof csSettings.csLargeOpacity === "number" ? csSettings.csLargeOpacity : 0.90;

        const sortedCells = [...candleCells].sort((a, b) => b.price - a.price);
        const maxBody = Math.max(candle.open, candle.close);
        const minBody = Math.min(candle.open, candle.close);

        const itemsToDraw: Array<{
          price: number;
          color: string;
          shape: "circle" | "square" | "rhombus";
          opacity: number;
          size: number;
        }> = [];

        // 1. Medium filter match
        const csMedEnabled = csSettings.csMedEnabled !== false;
        if (csMedEnabled) {
          const csMedMergeLevels = typeof csSettings.csMedMergeLevels === "number" ? csSettings.csMedMergeLevels : csMergeLevels;
          const csMedImbalancePercent = typeof csSettings.csMedImbalancePercent === "number" ? csSettings.csMedImbalancePercent : csImbalancePercent;
          const csMedMinDelta = typeof csSettings.csMedMinDelta === "number" ? csSettings.csMedMinDelta : 0;
          const csMedLocation = csSettings.csMedLocation || "any";

          const K_med = Math.max(1, Math.min(csMedMergeLevels, sortedCells.length));
          for (let i = 0; i <= sortedCells.length - K_med; i++) {
            let sumVolume = 0, sumBid = 0, sumAsk = 0;
            for (let j = 0; j < K_med; j++) {
              const cell = sortedCells[i + j];
              if (cell) {
                sumVolume += cell.volume;
                sumBid += cell.bid;
                sumAsk += cell.ask;
              }
            }
            if (sumVolume <= 0) continue;
            if (sumVolume < csMedMinVolume || sumVolume > csMedMaxVolume) continue;

            const bidPercent = (sumBid / sumVolume) * 100;
            const askPercent = (sumAsk / sumVolume) * 100;
            const isBidDominant = bidPercent >= csMedImbalancePercent;
            const isAskDominant = askPercent >= csMedImbalancePercent;
            if (!isBidDominant && !isAskDominant) continue;

            const absDelta = Math.abs(sumAsk - sumBid);
            if (absDelta < csMedMinDelta) continue;

            const midPrice = (sortedCells[i].price + sortedCells[i + K_med - 1].price) / 2;
            if (csMedLocation === "body" && !(midPrice >= minBody && midPrice <= maxBody)) continue;
            if (csMedLocation === "lowerWick" && !(midPrice < minBody)) continue;
            if (csMedLocation === "upperWick" && !(midPrice > maxBody)) continue;

            const color = isBidDominant ? csMedColorBid : csMedColorAsk;
            const range = csMedMaxVolume - csMedMinVolume;
            const ratio = range > 0 ? Math.min(1.0, (sumVolume - csMedMinVolume) / range) : 0;
            const size = csMedMinSize + ratio * (csMedMaxSize - csMedMinSize);

            itemsToDraw.push({
              price: midPrice,
              color,
              shape: csMedShape as any,
              opacity: csMedOpacity,
              size
            });
          }
        }

        // 2. Large filter match
        const csLargeEnabled = csSettings.csLargeEnabled !== false;
        if (csLargeEnabled) {
          const csLargeMergeLevels = typeof csSettings.csLargeMergeLevels === "number" ? csSettings.csLargeMergeLevels : csMergeLevels;
          const csLargeImbalancePercent = typeof csSettings.csLargeImbalancePercent === "number" ? csSettings.csLargeImbalancePercent : csImbalancePercent;
          const csLargeMinDelta = typeof csSettings.csLargeMinDelta === "number" ? csSettings.csLargeMinDelta : 0;
          const csLargeLocation = csSettings.csLargeLocation || "any";

          const K_large = Math.max(1, Math.min(csLargeMergeLevels, sortedCells.length));
          for (let i = 0; i <= sortedCells.length - K_large; i++) {
            let sumVolume = 0, sumBid = 0, sumAsk = 0;
            for (let j = 0; j < K_large; j++) {
              const cell = sortedCells[i + j];
              if (cell) {
                sumVolume += cell.volume;
                sumBid += cell.bid;
                sumAsk += cell.ask;
              }
            }
            if (sumVolume <= 0) continue;
            if (sumVolume < csLargeMinVolume) continue;

            const bidPercent = (sumBid / sumVolume) * 100;
            const askPercent = (sumAsk / sumVolume) * 100;
            const isBidDominant = bidPercent >= csLargeImbalancePercent;
            const isAskDominant = askPercent >= csLargeImbalancePercent;
            if (!isBidDominant && !isAskDominant) continue;

            const absDelta = Math.abs(sumAsk - sumBid);
            if (absDelta < csLargeMinDelta) continue;

            const midPrice = (sortedCells[i].price + sortedCells[i + K_large - 1].price) / 2;
            if (csLargeLocation === "body" && !(midPrice >= minBody && midPrice <= maxBody)) continue;
            if (csLargeLocation === "lowerWick" && !(midPrice < minBody)) continue;
            if (csLargeLocation === "upperWick" && !(midPrice > maxBody)) continue;

            const color = isBidDominant ? csLargeColorBid : csLargeColorAsk;
            const range = csLargeMinVolume * 2;
            const ratio = range > 0 ? Math.min(1.0, (sumVolume - csLargeMinVolume) / range) : 0;
            const size = csLargeMinSize + ratio * (csLargeMaxSize - csLargeMinSize);

            itemsToDraw.push({
              price: midPrice,
              color,
              shape: csLargeShape as any,
              opacity: csLargeOpacity,
              size
            });
          }
        }

        // Draw items
        itemsToDraw.forEach(item => {
          const centerX = x + candleWidth / 2;
          const centerY = priceToY(item.price);
          clusterSearchIndicator.drawShape(ctx, item.shape, centerX, centerY, item.size / 2, item.color, item.opacity, isLight);
        });
      }

      ctx.restore(); // Restore context from candlestick main chart area clipping

      // C. Bottom Delta Sub-panel drawing
      if (activeIndicators.delta) {
        ctx.save();
        ctx.translate(0, deltaTopY);

        const deltaMidY = deltaPanelHeight / 2;
        const maxBarScaledHeight = deltaPanelHeight * 0.40;

        // Axis
        ctx.beginPath();
        ctx.strokeStyle = isLight ? "rgba(15, 23, 42, 0.15)" : "rgba(255, 255, 255, 0.12)";
        ctx.lineWidth = 0.8;
        ctx.moveTo(x, deltaMidY);
        ctx.lineTo(x + candleWidth, deltaMidY);
        ctx.stroke();

        const barHeight = Math.max(2, (Math.abs(candle.delta) / zoomedMaxCandleDelta) * maxBarScaledHeight);
        const barY = candle.delta >= 0 ? deltaMidY - barHeight : deltaMidY;

        // Draw Delta volume bar
        const dStyles = deltaIndicator.getDeltaStyle(candle.delta, isLight);
        ctx.fillStyle = dStyles.fillStyle;
        ctx.strokeStyle = candle.delta >= 0 ? "rgba(16, 185, 129, 0.85)" : "rgba(244, 63, 94, 0.85)";
        ctx.lineWidth = 1.2;
        ctx.fillRect(x + 4, barY, candleWidth - 8, barHeight);
        ctx.strokeRect(x + 4, barY, candleWidth - 8, barHeight);

        // Delta quantity text label
        if (candleWidth >= 45) {
          ctx.font = "bold 8.5px 'Inter', sans-serif";
          ctx.textAlign = "center";
          ctx.fillStyle = dStyles.textStyle;
          const lblY = candle.delta >= 0 ? deltaMidY - barHeight - 4 : deltaMidY + barHeight + 11;
          const deltaText = (candle.delta >= 0 ? "+" : "") + candle.delta.toFixed(0) + "K";
          ctx.fillText(deltaText, x + candleWidth / 2, lblY);
        }
        ctx.restore();
      }
    }

    // 5. Drawing Cumulative Volume Delta (CVD) trend line
    if (activeIndicators.cvd && cumulativeDeltaPoints.length > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(margin.left, cvdTopY, scrollWidth - margin.left + 50, cvdPanelHeight);
      ctx.clip();
      ctx.translate(0, cvdTopY);

      // CVD subchart horizontal reference axis (mid-line)
      ctx.beginPath();
      ctx.strokeStyle = isLight ? "rgba(15, 23, 42, 0.15)" : "rgba(255, 255, 255, 0.12)";
      ctx.lineWidth = 0.8;
      ctx.setLineDash([3, 3]);
      ctx.moveTo(margin.left, cvdPanelHeight / 2);
      ctx.lineTo(scrollWidth, cvdPanelHeight / 2);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      let pathStarted = false;
      const cvdStartIdx = Math.max(0, startIdx - 1);
      const cvdEndIdx = Math.min(cumulativeDeltaPoints.length - 1, endIdx + 1);
      for (let idx = cvdStartIdx; idx <= cvdEndIdx; idx++) {
        const p = cumulativeDeltaPoints[idx];
        const cy = getCvdY(p.value, cvdPanelHeight);
        if (!pathStarted) {
          ctx.moveTo(p.cx, cy);
          pathStarted = true;
        } else {
          ctx.lineTo(p.cx, cy);
        }
      }

      // Add purple glowing effect
      ctx.shadowColor = isLight ? "rgba(124, 58, 237, 0.4)" : "rgba(192, 132, 252, 0.8)";
      ctx.shadowBlur = 6;
      ctx.strokeStyle = isLight ? "#7c3aed" : "#c084fc";
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
      ctx.shadowBlur = 0; // reset shadow
      ctx.restore();
    }

    // -------------------------------------------------------------------------
    // RENDER INTERACTIVE DRAWING OBJECTS
    // -------------------------------------------------------------------------
    const allDrawings = [...drawings, ...(drawingInProgress ? [drawingInProgress] : [])];
    allDrawings.forEach((d) => {
      const y1 = priceToY(d.startPrice);
      const y2 = priceToY(d.endPrice);
      const x1 = d.startX;
      const x2 = d.endX;

      if (d.type === "trend") {
        ctx.beginPath();
        ctx.strokeStyle = isLight ? "#1e293b" : "#e2e8f0";
        ctx.lineWidth = 2.2;
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        ctx.fillStyle = "#f59e0b";
        ctx.beginPath();
        ctx.arc(x1, y1, 4, 0, Math.PI * 2);
        ctx.arc(x2, y2, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      else if (d.type === "horizontal") {
        ctx.beginPath();
        ctx.strokeStyle = "#10b981";
        ctx.lineWidth = 1.8;
        ctx.setLineDash([5, 5]);
        ctx.moveTo(visibleScrollLeft + margin.left, y1);
        ctx.lineTo(visibleScrollLeft + viewportWidth - margin.right, y1);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = "rgba(16, 185, 129, 0.25)";
        ctx.fillRect(visibleScrollLeft + margin.left, y1 - 8, 55, 16);
        ctx.font = "bold 9px monospace";
        ctx.fillStyle = "#10b981";
        ctx.fillText(d.startPrice.toFixed(1), visibleScrollLeft + margin.left + 4, y1);
      }
      else if (d.type === "rect") {
        ctx.beginPath();
        ctx.strokeStyle = isLight ? "#3b82f6" : "#60a5fa";
        ctx.lineWidth = 1.6;
        ctx.fillStyle = isLight ? "rgba(59, 130, 246, 0.08)" : "rgba(96, 165, 250, 0.12)";
        ctx.rect(x1, y1, x2 - x1, y2 - y1);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = "#3b82f6";
        ctx.beginPath();
        ctx.arc(x1, y1, 3.5, 0, Math.PI * 2);
        ctx.arc(x2, y2, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
      else if (d.type === "fibonacci") {
        const fibLevels = [
          { ratio: 0, label: "0.0% (Start)" },
          { ratio: 0.236, label: "23.6%" },
          { ratio: 0.382, label: "38.2%" },
          { ratio: 0.5, label: "50.0%" },
          { ratio: 0.618, label: "61.8%" },
          { ratio: 0.786, label: "78.6%" },
          { ratio: 1, label: "100.0% (End)" }
        ];

        const priceDiff = d.endPrice - d.startPrice;
        ctx.lineWidth = 1.2;

        fibLevels.forEach((level) => {
          const currentLevelPrice = d.startPrice + priceDiff * level.ratio;
          const fY = priceToY(currentLevelPrice);

          ctx.beginPath();
          if (level.ratio === 0 || level.ratio === 1) {
            ctx.strokeStyle = "#ef4444";
          } else if (level.ratio === 0.5 || level.ratio === 0.618) {
            ctx.strokeStyle = "#f59e0b";
          } else {
            ctx.strokeStyle = isLight ? "rgba(100, 116, 139, 0.6)" : "rgba(148, 163, 184, 0.5)";
          }
          ctx.moveTo(x1, fY);
          ctx.lineTo(x2, fY);
          ctx.stroke();

          ctx.font = "9px sans-serif";
          ctx.fillStyle = isLight ? "#475569" : "#cbd5e1";
          ctx.fillText(`${level.label} - ${currentLevelPrice.toFixed(1)}`, Math.min(x1, x2) + 5, fY - 7);
        });
      }
      else if (d.type === "ruler") {
        ctx.beginPath();
        ctx.strokeStyle = "#0ea5e9";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 2]);
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = "rgba(14, 165, 233, 0.08)";
        ctx.fillRect(x1, y1, x2 - x1, y2 - y1);

        const pStart = d.startPrice;
        const pEnd = d.endPrice;
        const absDiff = pEnd - pStart;
        const pctDiff = (pStart !== 0) ? (absDiff / pStart) * 100 : 0;

        const candleWidthSpacing = candleWidth + candleSpacing;
        const barCount = Math.max(1, Math.round(Math.abs(x2 - x1) / candleWidthSpacing));

        const cardW = 142;
        const cardH = 54;
        const centerX = x1 + (x2 - x1) / 2;
        const centerY = y2 - 15;

        ctx.fillStyle = isLight ? "rgba(255, 255, 255, 0.95)" : "rgba(3, 7, 18, 0.88)";
        ctx.strokeStyle = "#0ea5e9";
        ctx.lineWidth = 1;
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(centerX - cardW / 2, centerY - cardH / 2, cardW, cardH, 6);
        } else {
          ctx.rect(centerX - cardW / 2, centerY - cardH / 2, cardW, cardH);
        }
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = isLight ? "#0f172a" : "#ffffff";
        ctx.font = "bold 9.5px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(`${pctDiff >= 0 ? "▲" : "▼"} ${pctDiff.toFixed(2)}% (${absDiff.toFixed(1)} USDT)`, centerX, centerY - 11);
        
        ctx.font = "9px monospace";
        ctx.fillStyle = "#a1a1aa";
        ctx.fillText(`${barCount} Бар(ов)`, centerX, centerY + 3);
        ctx.fillText(`${pStart.toFixed(1)} → ${pEnd.toFixed(1)}`, centerX, centerY + 14);
        ctx.textAlign = "left";
      }
      else if (d.type === "text") {
        ctx.fillStyle = isLight ? "#1e293b" : "#f1f5f9";
        ctx.font = "bold 11px sans-serif";
        ctx.fillText(`💬 ${d.text || "TEXT"}`, x1, y1 - 6);

        ctx.fillStyle = "#a855f7";
        ctx.beginPath();
        ctx.arc(x1, y1, 4.5, 0, Math.PI * 2);
        ctx.fill();
      }
      else if (d.type === "arrow") {
        ctx.save();
        ctx.beginPath();
        ctx.strokeStyle = isLight ? "#dc2626" : "#ef4444";
        ctx.lineWidth = 2.5;
        ctx.lineCap = "round";
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        const angle = Math.atan2(y2 - y1, x2 - x1);
        const headLength = 12;
        ctx.fillStyle = isLight ? "#dc2626" : "#ef4444";
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - headLength * Math.cos(angle - Math.PI / 6), y2 - headLength * Math.sin(angle - Math.PI / 6));
        ctx.lineTo(x2 - headLength * Math.cos(angle + Math.PI / 6), y2 - headLength * Math.sin(angle + Math.PI / 6));
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      else if (d.type === "channel") {
        ctx.save();
        const isStaging = d.stage === 1;
        const offsetVal = d.offsetPrice !== undefined ? d.offsetPrice : ((activePair.priceStep || 0.1) * 20);
        const y1_offset = priceToY(d.startPrice + offsetVal);
        const y2_offset = priceToY(d.endPrice + offsetVal);
        const y1_mid = priceToY(d.startPrice + offsetVal / 2);
        const y2_mid = priceToY(d.endPrice + offsetVal / 2);

        // Draw primary line
        ctx.beginPath();
        ctx.strokeStyle = isLight ? "#2563eb" : "#3b82f6";
        ctx.lineWidth = 2.0;
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        if (!isStaging) {
          // Draw parallel line
          ctx.beginPath();
          ctx.moveTo(x1, y1_offset);
          ctx.lineTo(x2, y2_offset);
          ctx.stroke();

          // Draw dashed midline
          ctx.beginPath();
          ctx.strokeStyle = isLight ? "rgba(37, 99, 235, 0.45)" : "rgba(96, 165, 250, 0.45)";
          ctx.lineWidth = 1.25;
          ctx.setLineDash([6, 5]);
          ctx.moveTo(x1, y1_mid);
          ctx.lineTo(x2, y2_mid);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        ctx.restore();
      }
      else if (d.type === "volume") {
        ctx.beginPath();
        ctx.strokeStyle = "rgba(168, 85, 247, 0.8)";
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.rect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "rgba(168, 85, 247, 0.03)";
        ctx.fill();

        const minX = Math.min(x1, x2);
        const maxX = Math.max(x1, x2);
        const candleWidthSpacing = candleWidth + candleSpacing;
        const startIndex = Math.max(0, Math.floor((minX - margin.left) / candleWidthSpacing));
        const endIndex = Math.min(candles.length - 1, Math.floor((maxX - margin.left) / candleWidthSpacing));

        if (startIndex <= endIndex) {
          const minPrice = Math.min(d.startPrice, d.endPrice);
          const maxPrice = Math.max(d.startPrice, d.endPrice);
          const priceDiff = maxPrice - minPrice;
          const priceStep = activePair.priceStep || 1;
          const bucketCount = Math.max(1, Math.round(priceDiff / priceStep));

          const bMinY = Math.min(y1, y2);
          const bMaxY = Math.max(y1, y2);
          const bHeight = bMaxY - bMinY;
          const bHeightStep = bHeight / bucketCount;

          const profileBins = Array.from({ length: bucketCount }, () => 0);
          
          for (let cIdx = startIndex; cIdx <= endIndex; cIdx++) {
            const c = candles[cIdx];
            if (c.cells) {
              c.cells.forEach((cell) => {
                const cellY = priceToY(cell.price);
                if (cellY >= bMinY && cellY <= bMaxY) {
                  const binIdx = Math.min(bucketCount - 1, Math.max(0, Math.floor((maxPrice - cell.price) / priceStep)));
                  if (binIdx >= 0) {
                    profileBins[binIdx] += cell.volume;
                  }
                }
              });
            } else {
              const avgY = priceToY((c.open + c.close + c.high + c.low) / 4);
              if (avgY >= bMinY && avgY <= bMaxY) {
                const avgPrice = (c.open + c.close + c.high + c.low) / 4;
                const binIdx = Math.min(bucketCount - 1, Math.max(0, Math.floor((maxPrice - avgPrice) / priceStep)));
                if (binIdx >= 0) {
                  profileBins[binIdx] += c.volume;
                }
              }
            }
          }

          // Compute total volume & identify POC (Point of Control)
          let totalVolume = 0;
          let maxBinVal = 0;
          let pocIdx = 0;
          for (let b = 0; b < bucketCount; b++) {
            const binVol = profileBins[b];
            totalVolume += binVol;
            if (binVol > maxBinVal) {
              maxBinVal = binVol;
              pocIdx = b;
            }
          }

          // Calculate 70% Value Area (VA) around POC
          let lowIdx = pocIdx;
          let highIdx = pocIdx;
          let vaVolume = profileBins[pocIdx];
          const targetVolume = totalVolume * 0.70;

          if (totalVolume > 0 && maxBinVal > 0) {
            while (vaVolume < targetVolume && (lowIdx > 0 || highIdx < bucketCount - 1)) {
              let addLowVol = 0;
              let addHighVol = 0;
              if (lowIdx > 0) addLowVol = profileBins[lowIdx - 1];
              if (highIdx < bucketCount - 1) addHighVol = profileBins[highIdx + 1];

              if (addLowVol >= addHighVol && lowIdx > 0) {
                vaVolume += addLowVol;
                lowIdx--;
              } else if (highIdx < bucketCount - 1) {
                vaVolume += addHighVol;
                highIdx++;
              } else if (lowIdx > 0) {
                vaVolume += addLowVol;
                lowIdx--;
              } else {
                break;
              }
            }
          }

          const maxDrawWidth = Math.abs(x2 - x1) * 0.82;

          ctx.save();

          // 1. Draw a clear, styled background for the 70% Value Area Zone (Зона баланса 70%)
          const vaY1 = bMinY + lowIdx * bHeightStep;
          const vaY2 = bMinY + (highIdx + 1) * bHeightStep;
          ctx.fillStyle = isLight 
            ? "rgba(59, 130, 246, 0.02)" 
            : "rgba(59, 130, 246, 0.03)";
          ctx.fillRect(minX, vaY1, Math.abs(x2 - x1), vaY2 - vaY1);

          // 2. Draw volume profile bars (Value Area vs Out-of-Value-Area)
          for (let b = 0; b < bucketCount; b++) {
            const binVol = profileBins[b];
            if (binVol === 0) continue;

            const drawW = (binVol / Math.max(1, maxBinVal)) * maxDrawWidth;
            const binY = bMinY + b * bHeightStep;
            const isInValueArea = (b >= lowIdx && b <= highIdx);

            if (isInValueArea) {
              // High contrast, clearly expressed active zone - made paler and elegant as requested
              ctx.fillStyle = isLight 
                ? "rgba(59, 130, 246, 0.18)" 
                : "rgba(59, 130, 246, 0.28)";
            } else {
              // Less noticeable, faded out-of-value-area zones
              ctx.fillStyle = isLight 
                ? "rgba(148, 163, 184, 0.06)" 
                : "rgba(148, 163, 184, 0.09)";
            }
            
            ctx.fillRect(minX, binY + 0.5, drawW, bHeightStep - 1);
          }

          // 3. Draw VAL and VAH dashed boundaries (subtle, less visible)
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 4]);
          ctx.strokeStyle = isLight 
            ? "rgba(100, 116, 139, 0.20)" 
            : "rgba(148, 163, 184, 0.20)";

          // VAH (Value Area High) line
          ctx.beginPath();
          ctx.moveTo(minX, vaY1);
          ctx.lineTo(maxX, vaY1);
          ctx.stroke();

          // VAL (Value Area Low) line
          ctx.beginPath();
          ctx.moveTo(minX, vaY2);
          ctx.lineTo(maxX, vaY2);
          ctx.stroke();
          ctx.setLineDash([]);

          // VAL/VAH Labels
          ctx.fillStyle = isLight 
            ? "rgba(100, 116, 139, 0.45)" 
            : "rgba(148, 163, 184, 0.45)";
          ctx.font = "8px 'JetBrains Mono', monospace";
          ctx.fillText("VAH (70%)", maxX - 65, vaY1 - 3);
          ctx.fillText("VAL (70%)", maxX - 65, vaY2 + 9);

          // 4. Draw POC (Point of Control) - Brilliantly expressed bold line
          const pocY = bMinY + (pocIdx + 0.5) * bHeightStep;
          ctx.strokeStyle = isLight ? "#2563eb" : "#3b82f6";
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          ctx.moveTo(minX, pocY);
          ctx.lineTo(maxX, pocY);
          ctx.stroke();

          // POC Label
          ctx.fillStyle = isLight ? "#1d4ed8" : "#60a5fa";
          ctx.font = "bold 9px 'JetBrains Mono', monospace";
          ctx.fillText("POC", minX + 5, pocY - 4);

          ctx.restore();
        }
      }
    });

    // Render Selection Highlighting & Resize Handles for the selected drawing (while still inside translated context)
    if (selectedDrawingId !== null) {
      const d = drawings.find(item => item.id === selectedDrawingId);
      if (d) {
        const y1 = priceToY(d.startPrice);
        const y2 = priceToY(d.endPrice);
        const x1 = d.startX;
        const x2 = d.endX;

        // Bounding dash box
        if (d.type !== "horizontal" && d.type !== "channel") {
          ctx.save();
          ctx.strokeStyle = isLight ? "#2563eb" : "#3b82f6";
          ctx.lineWidth = 1.2;
          ctx.setLineDash([3, 3]);
          ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
          ctx.restore();
        }

        // Draw 4 handles (TL, TR, BL, BR)
        let handles = [
          { x: x1, y: y1 },
          { x: x2, y: y2 },
          { x: x2, y: y1 },
          { x: x1, y: y2 }
        ];

        if (d.type === "channel") {
          const offsetVal = d.offsetPrice !== undefined ? d.offsetPrice : ((activePair.priceStep || 0.1) * 20);
          const y1_offset = priceToY(d.startPrice + offsetVal);
          const y2_offset = priceToY(d.endPrice + offsetVal);
          handles = [
            { x: x1, y: y1 },
            { x: x2, y: y2 },
            { x: x2, y: y2_offset },
            { x: x1, y: y1_offset }
          ];
        }

        handles.forEach((h) => {
          ctx.save();
          ctx.fillStyle = isLight ? "#2563eb" : "#60a5fa"; // high contrast theme-aware color
          ctx.strokeStyle = "#ffffff"; // always white border for maximum contrast
          ctx.lineWidth = 1.8;
          ctx.shadowBlur = 5;
          ctx.shadowColor = "rgba(37, 99, 235, 0.4)";
          ctx.beginPath();
          ctx.arc(h.x, h.y, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        });
      }
    }

    ctx.restore(); // Undoes translation of -visibleScrollLeft for viewport-wide elements

    // 5.5 Draw the solid timeline footer strip and time axis labels on top of everything else (to hide overlapping candles/wicks)
    ctx.save();
    ctx.fillStyle = isLight ? "rgba(241, 245, 249, 0.65)" : "#090b12";
    // We fill the entire bottom margin (timeline section) as a solid background to cover any overflowed elements from candles
    ctx.fillRect(0, totalSvgHeight - margin.bottom, viewportWidth, margin.bottom);
    
    ctx.beginPath();
    ctx.strokeStyle = isLight ? "rgba(15, 23, 42, 0.1)" : "rgba(255, 255, 255, 0.08)";
    ctx.lineWidth = 1.0;
    ctx.moveTo(0, totalSvgHeight - margin.bottom);
    ctx.lineTo(viewportWidth, totalSvgHeight - margin.bottom);
    ctx.stroke();
    ctx.restore();

    // Re-apply translation to draw the horizontal time axis labels at scrolled positions correctly
    ctx.save();
    ctx.translate(-visibleScrollLeft, 0);

    const allowedSteps = [1, 2, 5, 10, 15, 20, 30, 50, 100, 200, 500, 1000];
    const candleSpacingTotal = candleWidth + candleSpacing;
    const labelStep = allowedSteps.find(step => step * candleSpacingTotal >= 75) || 1000;

    const hoveredCandleIdx = crosshair
      ? Math.floor(((crosshair.x + visibleScrollLeft) - margin.left) / candleSpacingTotal)
      : -1;

    // Now draw the horizontal time axis labels for visible candles cleanly on top of this background
    for (let cIdx = startIdx; cIdx <= endIdx; cIdx++) {
      const candle = candles[cIdx];
      const x = margin.left + cIdx * candleSpacingTotal;
      const isHovered = crosshair && cIdx === hoveredCandleIdx;

      const shouldDrawStandard = cIdx % labelStep === 0;
      const isTooCloseToHovered = isHovered ? false : (hoveredCandleIdx !== -1 && Math.abs(cIdx - hoveredCandleIdx) * candleSpacingTotal < 65);

      if (isHovered || (shouldDrawStandard && !isTooCloseToHovered)) {
        const timeStr = formatTimezoneString(candle.timestamp, !!isHovered);

        ctx.save();
        if (isHovered) {
          ctx.font = "bold 9px 'Inter', sans-serif";
          const textWidth = ctx.measureText(timeStr).width;
          const padX = 6;
          const padY = 3;
          const rectW = textWidth + padX * 2;
          const rectH = 15;
          const rectX = x + candleWidth / 2 - rectW / 2;
          const rectY = totalSvgHeight - margin.bottom + 16 - rectH / 2;

          ctx.beginPath();
          if (ctx.roundRect) {
            ctx.roundRect(rectX, rectY, rectW, rectH, 3);
          } else {
            ctx.rect(rectX, rectY, rectW, rectH);
          }
          ctx.fillStyle = isLight ? "rgba(15, 23, 42, 0.08)" : "rgba(245, 158, 11, 0.15)";
          ctx.fill();

          ctx.strokeStyle = isLight ? "rgba(15, 23, 42, 0.18)" : "rgba(245, 158, 11, 0.35)";
          ctx.lineWidth = 1;
          ctx.stroke();

          ctx.fillStyle = isLight ? "#0f172a" : "#f59e0b";
          ctx.textAlign = "center";
          ctx.fillText(timeStr, x + candleWidth / 2, totalSvgHeight - margin.bottom + 16);
        } else {
          ctx.font = "bold 9px 'Inter', sans-serif";
          ctx.fillStyle = "#475569";
          ctx.textAlign = "center";
          ctx.fillText(timeStr, x + candleWidth / 2, totalSvgHeight - margin.bottom + 16);
        }
        ctx.restore();
      }
    }

    ctx.restore(); // Undoes translation for the label drawing

    // 6. Draw Crosshair cursor lines
    if (crosshair) {
      ctx.save();
      ctx.beginPath();
      ctx.strokeStyle = isLight ? "rgba(100, 116, 139, 0.6)" : "rgba(148, 163, 184, 0.4)";
      ctx.lineWidth = 0.8;
      ctx.setLineDash([3, 3]);

      // Horizontal crosshair
      ctx.moveTo(margin.left, crosshair.y);
      ctx.lineTo(viewportWidth, crosshair.y);

      // Vertical crosshair inside Price chart panel
      ctx.moveTo(crosshair.x, margin.top);
      ctx.lineTo(crosshair.x, totalSvgHeight - margin.bottom);
      
      ctx.stroke();
      ctx.restore();
    }
  }, [
    candles,
    candleWidth,
    verticalScale,
    activeIndicators,
    indicatorSettings,
    theme,
    candleType,
    candleDataType,
    crosshair,
    hoveredCell,
    priceCenterOffset,
    containerHeight,
    scrollWidth,
    totalSvgHeight,
    maxCellVolume,
    maxCandleDelta,
    zoomedMaxCandleDelta,
    maxCumDeltaVal,
    minCumDeltaVal,
    zoomedCvdMax,
    zoomedCvdMin,
    zoomedCvdDeltaRange,
    cvdCenterVal,
    deltaScale,
    cvdScale,
    profileBuckets,
    maxProfileVol,
    profileBucketSize,
    isDetailedMode,
    isLight,
    activePair.price,
    activePair.priceStep,
    visibleScrollLeft,
    visibleClientWidth,
    selectedTimezone,
    drawings,
    drawingInProgress,
    selectedDrawingId
  ]);

  // FPS Counter
  useEffect(() => {
    if (candles.length === 0) return;

    let running = true;
    const measure = () => {
      if (!running) return;
      frameCountRef.current++;
      const now = performance.now();
      const elapsed = now - lastFpsTimeRef.current;
      if (elapsed >= 1000) {
        setFps(Math.round((frameCountRef.current * 1000) / elapsed));
        frameCountRef.current = 0;
        lastFpsTimeRef.current = now;
      }
      rafIdRef.current = requestAnimationFrame(measure);
    };
    rafIdRef.current = requestAnimationFrame(measure);

    return () => {
      running = false;
      cancelAnimationFrame(rafIdRef.current);
    };
  }, [candles.length]);

  // Scroll-back history loading trigger
  useEffect(() => {
    if (!onLoadMore || isLoadingMore || candles.length === 0) return;
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const scrollLeft = container.scrollLeft;
      if (scrollLeft < 200 && candles.length > 0) {
        const oldestCandle = candles[0];
        onLoadMore(oldestCandle.timestamp);
      }
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [candles.length, onLoadMore, isLoadingMore]);

  const formatCoinsVolume = (valInCoins: number, symbol: string) => {
    const rounded = Math.round(valInCoins);
    return `${rounded.toLocaleString()} ${symbol.toUpperCase()}`;
  };

  const formatUsdtVolume = (valInUsdt: number) => {
    if (valInUsdt >= 1_000_000_000) {
      const bils = valInUsdt / 1_000_000_000;
      return `${bils.toFixed(1)}b USDT`;
    }
    const mils = valInUsdt / 1_000_000;
    return `${mils.toFixed(1)}m USDT`;
  };

  return (
    <div className={`rounded-2xl overflow-hidden flex flex-col flex-1 shadow-2xl relative transition-all duration-300 ${
      isLight ? "bg-white border border-slate-200/50" : "liquid-glass-card"
    }`}>
      {/* Chart Tools Header */}
      <div className={`px-5 py-1.5 flex items-center justify-between z-20 backdrop-blur-lg border-b transition-all duration-300 ${
        isLight ? "bg-white/35 border-slate-200/50" : "bg-slate-950/80 border-white/5"
      }`}>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse shadow-md shadow-emerald-500/30" />
          <h3 className={`text-xs font-bold font-mono uppercase tracking-wider flex items-center gap-2 ${
            isLight ? "text-slate-700" : "text-slate-200"
          }`}>
            <span className={`font-display font-extrabold text-sm tracking-tight ${
              isLight ? "text-slate-900" : "text-slate-100"
            }`}>{activePair.symbol}</span>
            <span className="text-[10px] text-slate-500">•</span>
            <button
              onClick={onToggleMarketType}
              className={`text-[10px] font-bold px-2.5 py-0.5 rounded cursor-pointer border transition-all ${
                marketType === "SPOT"
                  ? isLight
                    ? "text-cyan-900 bg-cyan-100 border-cyan-300 font-extrabold shadow-sm hover:bg-cyan-200"
                    : "text-cyan-400 bg-cyan-950/30 border-cyan-500/10 hover:bg-cyan-900/40"
                  : isLight
                    ? "text-purple-900 bg-purple-100 border-purple-300 font-extrabold shadow-sm hover:bg-purple-200"
                    : "text-purple-400 bg-purple-950/30 border-purple-500/10 hover:bg-purple-900/40"
              }`}
              title="Click to toggle Market Type"
            >
              {marketType}
            </button>
          </h3>

          {/* Display active indicators on chart header */}
          <div className="hidden md:flex items-center gap-1.5 ml-2">
            {indicators && indicators.filter(ind => ind.isActive).map(ind => {
              const isVisible = ind.isVisible !== false;
              return (
                <span 
                  key={ind.id}
                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold tracking-wider border shadow-sm transition-opacity duration-200 ${
                    !isVisible ? "opacity-40" : ""
                  } ${
                    isLight 
                      ? "bg-slate-100 border-slate-250 text-slate-600" 
                      : "bg-white/5 border-white/5 text-slate-300"
                  }`}
                  title={`${ind.label} (${ind.type}) - ${isVisible ? "Видимый" : "Скрытый"}`}
                >
                  {isVisible ? (
                    <Layers className="w-2.5 h-2.5 text-blue-450 shrink-0" />
                  ) : (
                    <EyeOff className="w-2.5 h-2.5 text-rose-500 shrink-0" />
                  )}
                  <span className={!isVisible ? "line-through" : ""}>{ind.label.replace("(PROCLUSTER) ", "")}</span>
                </span>
              );
            })}
          </div>
        </div>

        {/* Toolbar Controls */}
        <div className="flex items-center gap-2">
          {/* Zoom Buttons */}
          <div className={`flex rounded-xl p-[3px] border backdrop-blur-sm shadow-inner gap-0.5 transition-all duration-300 ${
            isLight ? "bg-slate-100 border-slate-200" : "bg-slate-950/60 border-white/5"
          }`} title="Horizontal Scale">
            <button
              onClick={() => handleZoom(15)}
              className={`p-1.5 rounded-lg transition-all duration-150 cursor-pointer ${
                isLight ? "hover:bg-slate-200 text-slate-650 hover:text-slate-900" : "hover:bg-white/5 text-slate-400 hover:text-yellow-450"
              }`}
              title="Zoom In (Expand Clusters)"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => handleZoom(-15)}
              className={`p-1.5 rounded-lg transition-all duration-150 cursor-pointer ${
                isLight ? "hover:bg-slate-200 text-slate-650 hover:text-slate-900" : "hover:bg-white/5 text-slate-400 hover:text-yellow-450"
              }`}
              title="Zoom Out"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Vertical Price Scale Buttons */}
          <div className={`flex rounded-xl p-[3px] border backdrop-blur-sm shadow-inner gap-0.5 transition-all duration-300 ${
            isLight ? "bg-slate-100 border-slate-200" : "bg-slate-950/60 border-white/5"
          }`} title="Vertical Price Scale">
            <button
              onClick={() => handleVerticalZoom(0.15)}
              className={`px-2 py-0.5 text-[10px] font-mono font-bold rounded-lg transition-all duration-150 cursor-pointer ${
                isLight ? "hover:bg-slate-200 text-slate-600 hover:text-slate-900" : "hover:bg-white/5 text-slate-400 hover:text-cyan-405"
              }`}
              title="Stretch Vertically (Narrow visible range)"
            >
              ↕ +
            </button>
            <button
              onClick={() => handleVerticalZoom(-0.15)}
              className={`px-2 py-0.5 text-[10px] font-mono font-bold rounded-lg transition-all duration-150 cursor-pointer ${
                isLight ? "hover:bg-slate-200 text-slate-600 hover:text-slate-900" : "hover:bg-white/5 text-slate-400 hover:text-cyan-405"
              }`}
              title="Compress Vertically (Widen visible range)"
            >
              ↕ -
            </button>
            <button
              onClick={handleResetZoom}
              className={`px-2 py-0.5 text-[10px] font-bold rounded-lg transition-all duration-150 font-mono cursor-pointer ${
                isLight ? "hover:bg-slate-200 text-slate-600 hover:text-yellow-600" : "hover:bg-white/5 text-slate-400 hover:text-yellow-450"
              }`}
              title="Reset Zoom & Offsets"
            >
              100%
            </button>
          </div>
          
          {/* Timezone Select Control */}
          <div className={`border px-2.5 py-1 rounded-xl text-[10px] font-mono font-bold flex items-center gap-1.5 shadow-inner transition-all duration-300 ${
            isLight ? "bg-slate-100 border-slate-200/60 text-slate-600" : "bg-slate-950/60 border-white/5 text-slate-400"
          }`}>
            <Globe className={`w-3.5 h-3.5 shrink-0 ${isLight ? "text-slate-500" : "text-slate-400"}`} />
            <select
              value={selectedTimezone}
              onChange={(e) => setSelectedTimezone(e.target.value)}
              className="bg-transparent border-none text-[10px] text-inherit font-sans font-semibold cursor-pointer focus:outline-none pr-1"
              title={language === "RU" ? "Выбор часового пояса" : "Select Timezone"}
            >
              <option value="local" className={isLight ? "bg-white text-slate-900" : "bg-slate-950 text-slate-100"}>
                {language === "RU" ? "Системное" : language === "KZ" ? "Жүйелік" : "Local Time"}
              </option>
              <option value="UTC" className={isLight ? "bg-white text-slate-900" : "bg-slate-950 text-slate-100"}>UTC (GMT)</option>
              <option value="Europe/Moscow" className={isLight ? "bg-white text-slate-900" : "bg-slate-950 text-slate-100"}>
                {language === "RU" ? "Москва (UTC+3)" : language === "KZ" ? "Мәскеу (UTC+3)" : "Moscow (UTC+3)"}
              </option>
              <option value="Asia/Almaty" className={isLight ? "bg-white text-slate-900" : "bg-slate-950 text-slate-100"}>
                {language === "RU" ? "Алматы (UTC+5)" : language === "KZ" ? "Алматы (UTC+5)" : "Almaty (UTC+5)"}
              </option>
              <option value="Asia/Aqtobe" className={isLight ? "bg-white text-slate-900" : "bg-slate-950 text-slate-100"}>
                {language === "RU" ? "Актобе (UTC+5)" : language === "KZ" ? "Ақтөбе (UTC+5)" : "Aqtobe (UTC+5)"}
              </option>
              <option value="Asia/Singapore" className={isLight ? "bg-white text-slate-900" : "bg-slate-950 text-slate-100"}>
                {language === "RU" ? "Сингапур (UTC+8)" : language === "KZ" ? "Сингапур (UTC+8)" : "Singapore (UTC+8)"}
              </option>
              <option value="Asia/Tokyo" className={isLight ? "bg-white text-slate-900" : "bg-slate-950 text-slate-100"}>
                {language === "RU" ? "Токио (UTC+9)" : language === "KZ" ? "Токио (UTC+9)" : "Tokyo (UTC+9)"}
              </option>
              <option value="Europe/Paris" className={isLight ? "bg-white text-slate-900" : "bg-slate-950 text-slate-100"}>
                {language === "RU" ? "Париж (UTC+1)" : language === "KZ" ? "Париж (UTC+1)" : "Paris (UTC+1)"}
              </option>
              <option value="America/New_York" className={isLight ? "bg-white text-slate-900" : "bg-slate-950 text-slate-100"}>
                {language === "RU" ? "Нью-Йорк (UTC-5)" : language === "KZ" ? "Нью-Йорк (UTC-5)" : "New York (UTC-5)"}
              </option>
            </select>
          </div>

          {/* Workspace Layout Control */}
          {workspaceLayout && onWorkspaceLayoutChange && (
            <div className="relative font-sans" ref={workspaceDropdownRef}>
              <button
                onClick={() => setShowWorkspaceMenu(!showWorkspaceMenu)}
                className={`flex items-center justify-between gap-1.5 px-2.5 py-1 rounded-xl text-[10px] cursor-pointer hover:scale-[1.01] active:scale-[0.99] transition-all min-w-[120px] h-[28px] select-none border font-bold ${
                  isLight
                    ? "bg-white hover:bg-slate-100 border-slate-200 text-slate-800 shadow-sm"
                    : "bg-slate-950/60 hover:bg-white/5 border-white/5 text-slate-200"
                }`}
                title={language === "RU" ? "Рабочее пространство" : "Workspace Layout"}
              >
                <div className="flex items-center gap-1.5 leading-none">
                  <LayoutGrid className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                  <span className={`font-sans text-[10px] whitespace-nowrap`}>
                    {workspaceLayout === "1"
                      ? (language === "EN" ? "1 Chart" : language === "KZ" ? "1 график" : "1 график")
                      : workspaceLayout === "2h"
                      ? (language === "EN" ? "2 Horiz" : language === "KZ" ? "2 гориз" : "2 по гориз.")
                      : (language === "EN" ? "2 Vert" : language === "KZ" ? "2 верт" : "2 по верт.")}
                  </span>
                </div>
                <ChevronDown className={`w-3 h-3 transition-transform duration-200 shrink-0 ${
                  isLight ? "text-slate-600" : "text-slate-400"
                } ${showWorkspaceMenu ? "rotate-180" : ""}`} />
              </button>

              {showWorkspaceMenu && (
                <div
                  className={`absolute right-0 mt-1.5 w-44 rounded-xl p-1.5 z-50 text-left select-none shadow-2xl border ${
                    isLight
                      ? "bg-white border-slate-300 text-slate-900 shadow-xl"
                      : "bg-[#090d16]/98 border border-white/10 text-slate-100"
                  }`}
                >
                  <div className="flex flex-col gap-0.5">
                    {[
                      { id: "1", label: language === "EN" ? "1 Chart" : language === "KZ" ? "1 график" : "1 график", icon: "🔲" },
                      { id: "2h", label: language === "EN" ? "2 Horizontal" : language === "KZ" ? "2 горизонтальді" : "2 по горизонтали", icon: "🥞" },
                      { id: "2v", label: language === "EN" ? "2 Vertical" : language === "KZ" ? "2 вертикальді" : "2 по вертикали", icon: "🪟" }
                    ].map((item) => {
                      const isSelected = workspaceLayout === item.id;
                      const isLocked = workspacesCount < 2 && item.id !== "1";
                      return (
                        <button
                          key={item.id}
                          disabled={isLocked}
                          onClick={() => {
                            if (isLocked) return;
                            onWorkspaceLayoutChange(item.id as any);
                            setShowWorkspaceMenu(false);
                          }}
                          className={`flex items-center justify-between px-2 py-1.5 rounded-lg text-left transition-all w-full ${
                            isLocked
                              ? "opacity-50 cursor-not-allowed text-slate-500"
                              : isSelected
                              ? isLight
                                ? "bg-blue-50 text-blue-800 font-extrabold border border-blue-200 shadow-sm"
                                : "bg-blue-500/10 text-blue-400 font-extrabold border border-blue-500/25"
                              : isLight
                                ? "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                                : "text-slate-300 hover:text-white hover:bg-white/5"
                          }`}
                        >
                          <div className="flex items-center gap-1.5 select-none text-left">
                            <span className="text-[12px]">{isLocked ? "🔒" : item.icon}</span>
                            <span className="font-sans text-[10px] font-bold">
                              {item.label}
                            </span>
                          </div>
                          {isSelected && !isLocked && (
                            <Check className="w-3 tracking-tight ml-1 text-blue-500 shrink-0" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
          
          <div className={`border px-2.5 py-1.5 rounded-xl text-[10px] font-mono font-bold flex items-center gap-1.5 hidden md:flex shadow-inner transition-all duration-300 ${
            isLight ? "bg-slate-100 border-slate-200/60 text-slate-600" : "bg-slate-950/60 border-white/5 text-slate-400"
          }`}>
            <Move className="w-3 h-3 text-slate-500" /> Click & Drag to Pan (2D)
          </div>
        </div>
      </div>

      {/* 2D Panning Chart Workspace */}
      <div className="flex-1 flex relative overflow-hidden">
        {/* Drawing Tools sidebar panel */}
        <div className={`w-11 flex-none flex flex-col items-center py-3 border-r select-none transition-all duration-300 relative z-30 ${
          isLight 
            ? "bg-white border-slate-200/80 text-slate-600 shadow-sm" 
            : "bg-[#06080f]/90 border-white/5 text-slate-300 backdrop-blur-md"
        }`}>
          <div className="flex flex-col gap-1.5 items-center w-full grow">
            {[
              { id: "trend", icon: Slash, titleRU: "Трендовая линия", titleEN: "Trend Line" },
              { id: "arrow", icon: ArrowUpRight, titleRU: "Стрелка направления", titleEN: "Direction Arrow" },
              { id: "channel", icon: TrendingUp, titleRU: "Параллельный канал", titleEN: "Parallel Channel" },
              { id: "horizontal", icon: Minus, titleRU: "Горизонтальный уровень", titleEN: "Horizontal Level" },
              { id: "rect", icon: Square, titleRU: "Прямоугольник", titleEN: "Rectangle" },
              { id: "fibonacci", icon: Grid3X3, titleRU: "Уровни Фибоначчи", titleEN: "Fibonacci Retracement" },
              { id: "ruler", icon: Ruler, titleRU: "Линейка диапазона", titleEN: "Range Ruler" },
              { id: "text", icon: Type, titleRU: "Текстовая заметка", titleEN: "Text Annotation" },
              { id: "volume", icon: BarChart3, titleRU: "Профиль объема диапазона", titleEN: "Range Volume Profile" },
            ].map((tool) => {
              const IconComp = tool.icon;
              const isActive = activeDrawingTool === tool.id;
              const title = language === "RU" ? tool.titleRU : tool.titleEN;
              return (
                <button
                  key={tool.id}
                  onClick={() => setActiveDrawingTool(isActive ? null : tool.id)}
                  className={`p-2 rounded-lg transition-all duration-150 relative group cursor-pointer ${
                    isActive
                      ? "bg-amber-500/15 text-amber-500 border border-amber-500/30"
                      : isLight
                        ? "hover:bg-slate-100 text-slate-600 hover:text-slate-900 border border-transparent"
                        : "hover:bg-white/5 text-slate-400 hover:text-white border border-transparent"
                  }`}
                  title={title}
                >
                  <IconComp className="w-4 h-4" />
                  
                  {/* Tooltip on Hover to the right */}
                  <div className={`absolute left-full ml-2 top-1.2 font-sans font-semibold text-[10px] px-2 py-1 rounded bg-slate-950 text-slate-100 border border-white/10 hidden group-hover:block whitespace-nowrap z-50 pointer-events-none shadow-xl`}>
                    {title}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Delete drawings option at the bottom */}
          {drawings.length > 0 && (
            <button
              onClick={() => {
                setDrawings([]);
                setSelectedDrawingId(null);
              }}
              className={`p-2 rounded-lg transition-all duration-150 relative group cursor-pointer ${
                isLight
                  ? "hover:bg-rose-50 text-rose-600 hover:text-rose-700 hover:border-rose-100"
                  : "hover:bg-rose-950/20 text-rose-505 hover:text-rose-455 hover:border-rose-955/35"
              } border border-transparent`}
              title={language === "RU" ? "Удалить все рисунки" : "Clear Drawings"}
            >
              <Trash2 className="w-4 h-4" />
              
              <div className={`absolute left-full ml-2 top-1.2 font-sans font-extrabold text-[10px] px-2 py-1 rounded bg-rose-950 text-rose-300 border border-rose-900/30 hidden group-hover:block whitespace-nowrap z-50 pointer-events-none shadow-xl`}>
                {language === "RU" ? "Удалить все рисунки" : "Clear All Drawings"}
              </div>
            </button>
          )}
        </div>

        {/* Main SVG/Zoom Panel */}
        <div
          ref={containerRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUpOrLeave}
          onMouseLeave={handleMouseUpOrLeave}
          onScroll={(e) => {
            setVisibleScrollLeft(e.currentTarget.scrollLeft);
            setVisibleClientWidth(e.currentTarget.clientWidth);
          }}
          className={`flex-1 overflow-x-auto overflow-y-hidden select-none terminal-grid relative transition-all duration-300 chart-scroll-container ${
            isLight ? "bg-[#f8fafc]" : "bg-[#06080f]"
          } ${isDraggingTimeScale ? "cursor-ew-resize" : (isDragging ? "cursor-grabbing" : "cursor-grab")}`}
          style={{ scrollBehavior: "auto" }}
        >
          {candles.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center bg-[#06080f]/80 z-25">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-yellow-500"></div>
            </div>
          ) : (
            <>
              {/* Dummy scroll spacer to enable native scrollbar and wheel scroll dynamics */}
              <div id="procluster-chart-spacer" style={{ width: `${scrollWidth}px`, height: "1px", pointerEvents: "none" }} />
              
              {/* Absolutely positioned canvas that stays in view and draws only-visible content */}
              <canvas
                ref={canvasRef}
                onMouseMove={handleSvgMouseMove}
                onMouseLeave={handleSvgMouseLeave}
                className="sticky left-0 top-0 block z-10"
              />
            </>
          )}

        {/* FPS Counter Overlay */}
        {fps > 0 && (
          <div className={`absolute top-2 left-2 z-50 px-2 py-0.5 rounded text-[10px] font-mono font-bold select-none ${
            fps >= 55
              ? theme === "light" ? "bg-green-100 text-green-800" : "bg-green-900/60 text-green-400"
              : fps >= 30
                ? theme === "light" ? "bg-yellow-100 text-yellow-800" : "bg-yellow-900/60 text-yellow-400"
                : theme === "light" ? "bg-red-100 text-red-800" : "bg-red-900/60 text-red-400"
          }`}>
            {fps} FPS
          </div>
        )}

        {/* Loading more history indicator */}
        {isLoadingMore && (
          <div className={`absolute top-2 left-1/2 -translate-x-1/2 z-50 px-3 py-1 rounded text-[10px] font-mono font-bold select-none ${
            theme === "light" ? "bg-blue-100 text-blue-800" : "bg-blue-900/60 text-blue-400"
          }`}>
            Loading history...
          </div>
        )}
        </div>

        {/* Dynamic Vector floating Watermark Overlay */}
        <div 
          className="absolute right-[106px] pointer-events-none select-none z-20 opacity-30 sm:opacity-40 transition-all duration-300 flex items-center gap-1.5"
          style={{ bottom: `${margin.bottom + deltaHeightTotal + cvdHeightTotal + 16}px` }}
        >
          <div className="w-5 h-5 rounded bg-gradient-to-br from-yellow-400 to-amber-500 flex items-center justify-center shadow">
            <Layers className="w-3 h-3 text-slate-955" strokeWidth={2.5} />
          </div>
          <span className={`text-[10px] font-black tracking-wider uppercase font-sans ${isLight ? "text-slate-800" : "text-slate-100"}`}>
            PRO<span className={isLight ? "text-amber-600" : "text-amber-400"}>CLUSTER</span>
          </span>
        </div>

      {/* Fixed Price Scale Panel on the Right */}
      <div
        onWheel={(e) => {
          e.preventDefault();
          setVerticalScale(prev => {
            const delta = e.deltaY;
            const direction = Math.sign(delta);
            if (direction === 0) return prev;
            const multiplier = direction < 0 ? 1.15 : 0.85;
            const next = prev * multiplier;
            return Math.min(2000.0, Math.max(0.1, next));
          });
        }}
        onMouseDown={(e) => {
          if (e.button !== 0) return; // Only left-click
          e.preventDefault();
          const rect = e.currentTarget.getBoundingClientRect();
          const clickY = e.clientY - rect.top;

          if (activeIndicators.delta && clickY >= deltaTopY && clickY < cvdTopY) {
            setIsDraggingDeltaScale(true);
            startDeltaScaleYRef.current = e.clientY;
            startDeltaScaleRef.current = deltaScale;
          } else if (activeIndicators.cvd && clickY >= cvdTopY) {
            setIsDraggingCvdScale(true);
            startCvdScaleYRef.current = e.clientY;
            startCvdScaleRef.current = cvdScale;
          } else {
            setIsDraggingPriceScale(true);
            startPriceScaleYRef.current = e.clientY;
            startVerticalScaleRef.current = verticalScale;
          }
        }}
        className={`w-[90px] flex-none border-l select-none transition-all duration-300 relative flex flex-col justify-between cursor-ns-resize ${
          isLight ? "bg-[#f8fafc] border-slate-200" : "bg-[#06080f] border-white/5"
        }`}
        style={{ height: totalSvgHeight }}
      >
        <svg width={90} height={totalSvgHeight} className="absolute inset-0 block pointer-events-none">
          {/* Price Scale Background Panel */}
          <rect
            x={0}
            y={0}
            width={90}
            height={totalSvgHeight}
            fill={isLight ? "#f8fafc" : "#06080f"}
          />
          
          {/* Primary left divider line to outline the scale */}
          <line
            x1={0}
            y1={0}
            x2={0}
            y2={totalSvgHeight}
            stroke={isLight ? "#cbd5e1" : "#1e293b"}
            strokeWidth="1.5"
          />

          {/* Price Ticks & Labels */}
          {Array.from({ length: 6 }).map((_, i) => {
            const ratio = i / 5;
            const price = minPrice + ratio * (maxPrice - minPrice);
            const gridY = priceToY(price);
            return (
              <g key={`fixed-grid-label-${i}`}>
                {/* Tick Line */}
                <line
                  x1={0}
                  y1={gridY}
                  x2={5}
                  y2={gridY}
                  stroke={isLight ? "#94a3b8" : "#475569"}
                  strokeWidth="1.2"
                />
                {/* Label Text */}
                <text
                  x={8}
                  y={gridY + 4}
                  fill={isLight ? "#1e293b" : "#cbd5e1"}
                  fontSize="10.5"
                  fontFamily="'Inter', -apple-system, sans-serif"
                  fontWeight="600"
                  textAnchor="start"
                >
                  ${price.toLocaleString(undefined, { minimumFractionDigits: activePair.priceStep < 0.1 ? 3 : 1 })}
                </text>
              </g>
            );
          })}

          {/* Live Active Price level label */}
          {(() => {
            const activePriceY = priceToY(activePair.price);
            if (activePriceY >= margin.top && activePriceY <= margin.top + chartHeight) {
              return (
                <g key="fixed-active-price">
                  <rect
                    x={3}
                    y={activePriceY - 8}
                    width={82}
                    height={16}
                    fill={isLight ? "#1e293b" : "#eab308"}
                    rx="2"
                    stroke={isLight ? "#1e293b" : "#f59e0b"}
                    strokeWidth="1"
                  />
                  <text
                    x={8}
                    y={activePriceY + 4}
                    fill={isLight ? "#ffffff" : "#010409"}
                    fontSize="9.5"
                    fontFamily="'Inter', -apple-system, sans-serif"
                    fontWeight="bold"
                    textAnchor="start"
                  >
                    ${activePair.price.toLocaleString(undefined, { minimumFractionDigits: activePair.priceStep < 0.1 ? 3 : 1 })}
                  </text>
                </g>
              );
            }
            return null;
          })()}

          {/* Panel Dividers for right pricing panel */}
          {(activeIndicators.delta || activeIndicators.cvd) && (
            <line
              x1={0}
              y1={margin.top + chartHeight}
              x2={90}
              y2={margin.top + chartHeight}
              stroke={isLight ? "rgba(148, 163, 184, 0.35)" : "rgba(255, 255, 255, 0.16)"}
              strokeWidth="1"
            />
          )}
          {activeIndicators.delta && activeIndicators.cvd && (
            <line
              x1={0}
              y1={deltaTopY + deltaPanelHeight + panelGap / 2}
              x2={90}
              y2={deltaTopY + deltaPanelHeight + panelGap / 2}
              stroke={isLight ? "rgba(148, 163, 184, 0.35)" : "rgba(255, 255, 255, 0.16)"}
              strokeWidth="1"
            />
          )}

          {/* Delta subchart Y-axis labels */}
          {activeIndicators.delta && (
            <g key="delta-panel-ticks">
              {/* Top Tick */}
              <text
                x={8}
                y={deltaTopY + deltaPanelHeight * 0.1 + 4}
                fill={isLight ? "#047857" : "#10b981"}
                fontSize="9"
                fontFamily="'Inter', -apple-system, sans-serif"
                fontWeight="bold"
              >
                +{zoomedMaxCandleDelta.toFixed(1)}K
              </text>
              {/* Mid Tick */}
              <text
                x={8}
                y={deltaTopY + deltaPanelHeight / 2 + 4}
                fill={isLight ? "#475569" : "#94a3b8"}
                fontSize="9"
                fontFamily="'Inter', -apple-system, sans-serif"
                fontWeight="bold"
              >
                0.0K
              </text>
              {/* Bottom Tick */}
              <text
                x={8}
                y={deltaTopY + deltaPanelHeight * 0.9 + 4}
                fill={isLight ? "#be123c" : "#f43f5e"}
                fontSize="9"
                fontFamily="'Inter', -apple-system, sans-serif"
                fontWeight="bold"
              >
                -{zoomedMaxCandleDelta.toFixed(1)}K
              </text>
            </g>
          )}

          {/* CVD subchart Y-axis labels */}
          {activeIndicators.cvd && (
            <g key="cvd-panel-ticks">
              {/* Top Tick */}
              <text
                x={8}
                y={cvdTopY + cvdPanelHeight * 0.1 + 4}
                fill={isLight ? "#7c3aed" : "#c084fc"}
                fontSize="9"
                fontFamily="'Inter', -apple-system, sans-serif"
                fontWeight="bold"
              >
                +{zoomedCvdMax.toFixed(1)}K
              </text>
              {/* Mid Tick */}
              <text
                x={8}
                y={cvdTopY + cvdPanelHeight / 2 + 4}
                fill={isLight ? "#475569" : "#94a3b8"}
                fontSize="9"
                fontFamily="'Inter', -apple-system, sans-serif"
                fontWeight="bold"
              >
                {cvdCenterVal.toFixed(1)}K
              </text>
              {/* Bottom Tick */}
              <text
                x={8}
                y={cvdTopY + cvdPanelHeight * 0.9 + 4}
                fill={isLight ? "#7c3aed" : "#c084fc"}
                fontSize="9"
                fontFamily="'Inter', -apple-system, sans-serif"
                fontWeight="bold"
              >
                {zoomedCvdMin.toFixed(1)}K
              </text>
            </g>
          )}

          {/* Hover Crosshair price label */}
          {crosshair && (
            <g key="fixed-crosshair-price">
              <rect
                x={2}
                y={crosshair.y - 8}
                width={82}
                height={16}
                fill={isLight ? "#2563eb" : "#3b82f6"}
                rx="2"
                stroke={isLight ? "#1d4ed8" : "#60a5fa"}
                strokeWidth="1"
              />
              <text
                x={8}
                y={crosshair.y + 4}
                fill="#ffffff"
                fontSize="9.5"
                fontFamily="'Inter', -apple-system, sans-serif"
                fontWeight="black"
                textAnchor="start"
              >
                ${crosshair.price.toLocaleString(undefined, { minimumFractionDigits: activePair.priceStep < 0.1 ? 3 : 1 })}
              </text>
            </g>
          )}
        </svg>
      </div>

      {/* Absolute Pinned Indicators Control Overlays (Top-right of subcharts) */}
      {activeIndicators.delta && (
        <div 
          className="absolute z-30 flex items-center gap-2 px-3 py-1 rounded-lg border shadow-xl backdrop-blur-md transition-all duration-300 select-none"
          style={{
            top: `${deltaTopY + 6}px`,
            right: "100px", // Pinned just to the left of the 90px price scale panel
            backgroundColor: isLight ? "rgba(241, 245, 249, 0.9)" : "rgba(15, 23, 42, 0.75)",
            borderColor: isLight ? "rgba(203, 213, 225, 0.8)" : "rgba(255, 255, 255, 0.08)",
          }}
        >
          {/* Label / Dynamic value indicator */}
          <div className="flex items-center gap-1.5 font-mono text-[10px] sm:text-[11px] font-bold tracking-wider">
            <span className={isLight ? "text-slate-800" : "text-white"}>(PROCLUSTER) DELTA</span>
            <span className={hoveredCandle ? (hoveredCandle.delta >= 0 ? "text-emerald-500 font-extrabold" : "text-rose-500 font-extrabold") : "text-slate-500"}>
              {deltaValueText}
            </span>
          </div>

          <div className={`w-[1px] h-3 ${isLight ? "bg-slate-300" : "bg-white/10"}`} />

          {/* Control Buttons */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => onToggleIndicator?.("delta")}
              className={`p-0.5 rounded transition-all duration-150 cursor-pointer ${
                isLight 
                  ? "hover:bg-slate-200 text-slate-500 hover:text-slate-800" 
                  : "hover:bg-white/10 text-slate-400 hover:text-white"
              }`}
              title="Hide Delta"
            >
              <Eye className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={onShowIndicatorsSettings}
              className={`p-0.5 rounded transition-all duration-150 cursor-pointer ${
                isLight 
                  ? "hover:bg-slate-200 text-slate-500 hover:text-slate-800" 
                  : "hover:bg-white/10 text-slate-400 hover:text-white"
              }`}
              title="Delta Settings"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={() => onRemoveIndicator?.("delta")}
              className={`p-0.5 rounded transition-all duration-150 cursor-pointer ${
                isLight 
                  ? "hover:bg-slate-300 hover:text-rose-600 text-slate-500" 
                  : "hover:bg-rose-500/20 hover:text-rose-450 text-slate-400"
              }`}
              title="Remove Delta Overlay"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {activeIndicators.cvd && (
        <div 
          className="absolute z-30 flex items-center gap-2 px-3 py-1 rounded-lg border shadow-xl backdrop-blur-md transition-all duration-300 select-none"
          style={{
            top: `${cvdTopY + 6}px`,
            right: "100px",
            backgroundColor: isLight ? "rgba(241, 245, 249, 0.9)" : "rgba(15, 23, 42, 0.75)",
            borderColor: isLight ? "rgba(203, 213, 225, 0.8)" : "rgba(255, 255, 255, 0.08)",
          }}
        >
          {/* Label / Dynamic value indicator */}
          <div className="flex items-center gap-1.5 font-mono text-[10px] sm:text-[11px] font-bold tracking-wider">
            <span className={isLight ? "text-slate-800" : "text-white"}>(PROCLUSTER) CVD</span>
            <span className={hoveredCandleIdx >= 0 && hoveredCandleIdx < cumulativeDeltaPoints.length ? "text-purple-400 font-extrabold" : "text-slate-500"}>
              {cvdValueText}
            </span>
          </div>

          <div className={`w-[1px] h-3 ${isLight ? "bg-slate-300" : "bg-white/10"}`} />

          {/* Control Buttons */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => onToggleIndicator?.("cvd")}
              className={`p-0.5 rounded transition-all duration-150 cursor-pointer ${
                isLight 
                  ? "hover:bg-slate-200 text-slate-500 hover:text-slate-800" 
                  : "hover:bg-white/10 text-slate-400 hover:text-white"
              }`}
              title="Hide CVD"
            >
              <Eye className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={onShowIndicatorsSettings}
              className={`p-0.5 rounded transition-all duration-150 cursor-pointer ${
                isLight 
                  ? "hover:bg-slate-200 text-slate-500 hover:text-slate-800" 
                  : "hover:bg-white/10 text-slate-400 hover:text-white"
              }`}
              title="CVD Settings"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={() => onRemoveIndicator?.("cvd")}
              className={`p-0.5 rounded transition-all duration-150 cursor-pointer ${
                isLight 
                  ? "hover:bg-slate-300 hover:text-rose-600 text-slate-500" 
                  : "hover:bg-rose-500/20 hover:text-rose-450 text-slate-400"
              }`}
              title="Remove CVD"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Interactive Drag Handles / Resizing Splitters */}
      {activeIndicators.delta && (
        <div
          onMouseDown={(e) => {
            e.preventDefault();
            setResizingPanel("delta");
          }}
          className={`absolute left-0 right-0 z-40 cursor-ns-resize flex items-center justify-center group`}
          style={{
            top: `${deltaTopY - panelGap / 2}px`,
            height: "14px",
            transform: "translateY(-7px)"
          }}
          title="Drag to resize Delta Panel"
        >
          {/* Subtle colored horizontal line that lights up when hovered */}
          <div className="w-24 h-[3px] rounded-full bg-yellow-500/0 group-hover:bg-yellow-500/85 transition-all duration-200 shadow-md shadow-yellow-500/40" />
        </div>
      )}

      {activeIndicators.cvd && (
        <div
          onMouseDown={(e) => {
            e.preventDefault();
            setResizingPanel("cvd");
          }}
          className={`absolute left-0 right-0 z-40 cursor-ns-resize flex items-center justify-center group`}
          style={{
            top: `${cvdTopY - panelGap / 2}px`,
            height: "14px",
            transform: "translateY(-7px)"
          }}
          title="Drag to resize CVD Panel"
        >
          {/* Subtle colored horizontal line that lights up when hovered */}
          <div className="w-24 h-[3px] rounded-full bg-yellow-500/0 group-hover:bg-yellow-500/85 transition-all duration-200 shadow-md shadow-yellow-500/40" />
        </div>
      )}

    </div>



      {/* Floating Cluster Search Tooltip */}
      {hoveredClusterSearch && (() => {
        const isLeftIdx = hoveredClusterSearch.x > (visibleClientWidth || 800) - 275;
        const isTopIdx = hoveredClusterSearch.y > (totalSvgHeight || 550) - 180;
        const leftPos = isLeftIdx ? hoveredClusterSearch.x - 200 : hoveredClusterSearch.x + 55;
        const topPos = isTopIdx ? hoveredClusterSearch.y - 155 : hoveredClusterSearch.y + 15;

        const maxPercent = Math.max(hoveredClusterSearch.bidPercent, hoveredClusterSearch.askPercent);
        const isBidGreater = hoveredClusterSearch.bidPercent > hoveredClusterSearch.askPercent;
        const imbalanceValueStr = isBidGreater 
          ? `-${hoveredClusterSearch.bidPercent.toFixed(1)}%` 
          : `+${hoveredClusterSearch.askPercent.toFixed(1)}%`;

        let anomalyIntensity = "Низкая";
        if (maxPercent > 70) {
          anomalyIntensity = "Высокая";
        } else if (maxPercent >= 60) {
          anomalyIntensity = "Средняя";
        } else {
          anomalyIntensity = "Низкая";
        }

        return (
          <div
            className={`absolute border rounded-[14px] p-3.5 text-xs shadow-2xl z-50 flex flex-col gap-2.5 backdrop-blur-md pointer-events-none transition-all duration-100 ${
              isLight
                ? "bg-white/95 border-slate-200 text-slate-800 shadow-xl shadow-slate-250/50"
                : "liquid-glass-card border-none text-slate-100 shadow-black/80 shadow-2xl"
            }`}
            style={{
              left: `${leftPos}px`,
              top: `${topPos}px`,
              width: "230px"
            }}
          >
            <span className="font-bold flex items-center justify-between uppercase tracking-wider border-b pb-1.5 border-dashed border-slate-200/20 font-mono text-[10px]">
              <span className="flex items-center gap-1.5 font-bold" style={{ color: hoveredClusterSearch.color }}>
                <Activity className="w-3.5 h-3.5" />
                ПОИСК АНОМАЛИЙ
              </span>
              <span className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase ${
                anomalyIntensity === "Высокая"
                  ? "bg-rose-500/25 text-rose-400 border border-rose-500/20"
                  : anomalyIntensity === "Средняя"
                    ? "bg-amber-500/25 text-amber-400 border border-amber-500/20"
                    : "bg-blue-500/25 text-blue-400 border border-blue-500/20"
              }`}>
                {anomalyIntensity}
              </span>
            </span>

            <div className={`grid grid-cols-[1.2fr_1fr] gap-x-2 gap-y-1.5 font-mono text-[11px] ${
              isLight ? "text-slate-600" : "text-slate-400"
            }`}>
              <span>Объем (монеты):</span>
              <span className={`font-bold text-right ${isLight ? "text-slate-900" : "text-white"}`}>
                {formatCoinsVolume(hoveredClusterSearch.sumVolume, hoveredClusterSearch.baseAsset)}
              </span>

              <span>Объем в USDT:</span>
              <span className={`font-bold text-right ${isLight ? "text-slate-900" : "text-white"}`}>
                {formatUsdtVolume(hoveredClusterSearch.usdtVolume)}
              </span>

              <div className={`col-span-2 border-t border-dashed my-0.5 ${
                isLight ? "border-slate-200" : "border-white/5"
              }`} />

              <span>Дисбаланс:</span>
              <span style={{ color: hoveredClusterSearch.color }} className="font-extrabold text-right">
                {imbalanceValueStr}
              </span>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
