/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Type-safe and exception-guarded localStorage utility methods.
 * Ensures UI components do not directly access the global localStorage object.
 */
export const storage = {
  /**
   * Reads a raw string value from localStorage.
   */
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      console.warn(`[Storage] Failed to read key "${key}" from localStorage:`, e);
      return null;
    }
  },

  /**
   * Writes a raw string value to localStorage.
   */
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      console.warn(`[Storage] Failed to write key "${key}" to localStorage:`, e);
    }
  },

  /**
   * Removes a key from localStorage.
   */
  remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      console.warn(`[Storage] Failed to remove key "${key}" from localStorage:`, e);
    }
  },

  /**
   * Safely reads and parses a JSON object from localStorage, returning a fallback on failure.
   */
  getJson<T>(key: string, fallback: T): T {
    const raw = this.get(key);
    if (raw === null) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch (e) {
      console.warn(`[Storage] Failed to parse JSON for key "${key}":`, e);
      return fallback;
    }
  },

  /**
   * Safely writes a JSON object as a stringified value to localStorage.
   */
  setJson<T>(key: string, value: T): void {
    try {
      this.set(key, JSON.stringify(value));
    } catch (e) {
      console.warn(`[Storage] Failed to stringify JSON for key "${key}":`, e);
    }
  }
};
