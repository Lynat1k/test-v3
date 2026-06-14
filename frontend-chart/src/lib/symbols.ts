/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Returns the base tick size for a given trading symbol.
 */
export const getBaseTickSize = (symbol: string): number => {
  const norm = symbol.toUpperCase().replace("/", "");
  if (norm.includes("BTC")) return 0.1;
  if (norm.includes("ETH")) return 0.01;
  if (norm.includes("SOL")) return 0.01;
  if (norm.includes("BNB")) return 0.01;
  if (norm.includes("XRP")) return 0.0001;
  return 0.01; // default fallback
};
