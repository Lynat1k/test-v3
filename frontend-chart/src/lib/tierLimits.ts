/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { storage } from "./storage";

export interface TierLimits {
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
}

export type TierGroup = "guest" | "free" | "pro" | "vip" | "admin";

export const defaultTierSettings: Record<TierGroup, TierLimits> = {
  guest: { 
    maxHistory: 700, 
    compressionLevels: 1, 
    maxIndicators: 3, 
    customIndicatorSettings: false, 
    telegramNotifications: false, 
    historyDays_1m: 1, 
    historyDays_5m: 3, 
    historyDays_15m: 7, 
    historyDays_30m: 14, 
    historyDays_1h: 30, 
    historyDays_4h: 90, 
    workspacesCount: 1 
  },
  free: { 
    maxHistory: 700, 
    compressionLevels: 1, 
    maxIndicators: 3, 
    customIndicatorSettings: false, 
    telegramNotifications: false, 
    historyDays_1m: 1, 
    historyDays_5m: 3, 
    historyDays_15m: 7, 
    historyDays_30m: 14, 
    historyDays_1h: 30, 
    historyDays_4h: 90, 
    workspacesCount: 1 
  },
  pro: { 
    maxHistory: 1400, 
    compressionLevels: 2, 
    maxIndicators: 5, 
    customIndicatorSettings: true, 
    telegramNotifications: false, 
    historyDays_1m: 3, 
    historyDays_5m: 7, 
    historyDays_15m: 14, 
    historyDays_30m: 30, 
    historyDays_1h: 60, 
    historyDays_4h: 180, 
    workspacesCount: 2 
  },
  vip: { 
    maxHistory: 10000, 
    compressionLevels: 6, 
    maxIndicators: 15, 
    customIndicatorSettings: true, 
    telegramNotifications: true, 
    historyDays_1m: 7, 
    historyDays_5m: 14, 
    historyDays_15m: 30, 
    historyDays_30m: 60, 
    historyDays_1h: 120, 
    historyDays_4h: 360, 
    workspacesCount: 2 
  },
  admin: { 
    maxHistory: 10000, 
    compressionLevels: 6, 
    maxIndicators: 99, 
    customIndicatorSettings: true, 
    telegramNotifications: true, 
    historyDays_1m: 14, 
    historyDays_5m: 30, 
    historyDays_15m: 60, 
    historyDays_30m: 120, 
    historyDays_1h: 240, 
    historyDays_4h: 720, 
    workspacesCount: 2 
  }
};

/**
 * Calculates current user's subscription tier and returns the active limit settings.
 */
export function getActiveGroupLimits(
  userRole?: string | null,
  profileUser?: any
): { group: TierGroup; limits: TierLimits } {
  let group: TierGroup = "guest";
  
  if (userRole) {
    const r = userRole.toLowerCase();
    if (r === "admin") group = "admin";
    else if (r === "vip") group = "vip";
    else if (r === "pro") group = "pro";
    else if (r === "free") group = "free";
    else if (r === "guest") group = "guest";
  } else {
    // Check direct role override first
    const savedRole = storage.get("procluster_role");
    if (savedRole) {
      const r = savedRole.toLowerCase();
      if (r === "admin") group = "admin";
      else if (r === "vip") group = "vip";
      else if (r === "pro") group = "pro";
      else if (r === "free") group = "free";
      else if (r === "guest") group = "guest";
    } else {
      const userObj = profileUser || (() => {
        const savedUser = storage.getJson<any>("procluster_user", null);
        if (savedUser) {
          return savedUser;
        }
        return null;
      })();

      if (userObj) {
        const tier = (userObj.tier || "Free").toLowerCase();
        if (tier === "admin" || userObj.role === "Admin" || userObj.subscriptionLevel === "Admin") {
          group = "admin";
        } else if (tier === "vip" || userObj.subscriptionLevel === "VIP") {
          group = "vip";
        } else if (tier === "pro" || tier === "rpo" || userObj.subscriptionLevel === "RPO") {
          group = "pro";
        } else if (tier === "free") {
          group = "free";
        } else {
          group = "guest";
        }
      }
    }
  }

  let settings = { ...defaultTierSettings };
  const savedSettings = storage.getJson<any>("procluster_tier_settings", null);
  if (savedSettings) {
    try {
      const parsed = savedSettings;
      if (parsed) {
        for (const k of ["guest", "free", "pro", "vip", "admin"] as const) {
          if (!parsed[k]) {
            parsed[k] = { ...settings[k] };
          } else {
            parsed[k] = { ...settings[k], ...parsed[k] };
          }
          const s = parsed[k];
          if (s && typeof s.compressionLevels === "number") {
            s.compressionLevels = Math.min(6, Math.max(1, s.compressionLevels));
          }
        }
        settings = parsed;
      }
    } catch (e) {
      // ignore
    }
  }

  return {
    group,
    limits: settings[group] || settings.guest
  };
}
