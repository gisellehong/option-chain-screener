import raw from "../../config/screeners.json";
import type { ScreenerConfig } from "../lib/types";

/** Frontend and scheduled collection read this same versioned configuration. */
export const screenerConfigs = raw as ScreenerConfig[];
export function getScreenerConfig(id: string): ScreenerConfig {
  const config = screenerConfigs.find(item => item.id === id);
  if (!config) throw new Error(`Unknown screener config: ${id}`);
  return config;
}
