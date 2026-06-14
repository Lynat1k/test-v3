/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";

export const AutoIcon = ({ className }: { className?: string }) => (
  <span className={`font-sans text-xs font-black select-none ${className || ""}`}>A</span>
);

export const JapaneseIcon = ({ className }: { className?: string }) => (
  <svg className={className || "w-4 h-4"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="8" y1="3" x2="8" y2="21" strokeWidth="2" />
    <rect x="5" y="7" width="6" height="10" rx="1" fill="currentColor" fillOpacity="0.3" strokeWidth="2" />
    <line x1="16" y1="3" x2="16" y2="21" strokeWidth="2" />
    <rect x="13" y="5" width="6" height="12" rx="1" fill="currentColor" fillOpacity="0.3" strokeWidth="2" />
  </svg>
);

export const FootprintIcon = ({ className }: { className?: string }) => (
  <svg className={className || "w-4 h-4"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="4" y1="6" x2="16" y2="6" strokeWidth="2.8" />
    <line x1="4" y1="12" x2="20" y2="12" strokeWidth="2.8" />
    <line x1="4" y1="18" x2="12" y2="18" strokeWidth="2.8" />
  </svg>
);

export const ClustersIcon = ({ className }: { className?: string }) => (
  <svg className={className || "w-4 h-4"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="5" y="3" width="14" height="18" rx="2" strokeWidth="2" />
    <line x1="5" y1="9" x2="19" y2="9" strokeWidth="1.5" />
    <line x1="5" y1="15" x2="19" y2="15" strokeWidth="1.5" />
    <line x1="12" y1="3" x2="12" y2="21" strokeWidth="1.2" strokeDasharray="2,2" />
  </svg>
);

export const CandlePreviewIcon = ({ palette, theme }: { palette: "default" | "alternative"; theme?: string }) => {
  const isDefault = palette === "default";
  const isLight = theme === "light";
  const bullColor = isDefault 
    ? "#10b981" 
    : (isLight ? "#E3E3E3" : "#B6B2B2");
  const bearColor = isDefault 
    ? "#f43f5e" 
    : (isLight ? "#292929" : "#5E5E5E");
  const bullBorder = isDefault 
    ? "#10b981" 
    : (isLight ? "#2F2F2F" : "#D5D5D5");
  const bearBorder = isDefault 
    ? "#f43f5e" 
    : (isLight ? "#3A3A3A" : "#AEA7A7");

  return (
    <svg width="22" height="18" viewBox="0 0 22 18" className="inline-block shrink-0 select-none">
      {/* Bullish Candle (Green or Light Alt) */}
      <line x1="6" y1="2" x2="6" y2="16" stroke={bullBorder} strokeWidth="1.5" strokeLinecap="round" />
      <rect x="3.5" y="5" width="5" height="8" fill={bullColor} stroke={bullBorder} strokeWidth="1" rx="0.5" />

      {/* Bearish Candle (Red or Dark Alt) */}
      <line x1="16" y1="2" x2="16" y2="16" stroke={bearBorder} strokeWidth="1.5" strokeLinecap="round" />
      <rect x="13.5" y="7" width="5" height="7" fill={bearColor} stroke={bearBorder} strokeWidth="1" rx="0.5" />
    </svg>
  );
};
