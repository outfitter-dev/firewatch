import type { FirewatchConfig } from "../schema/config";
import type { FirewatchEntry } from "../schema/entry";

/**
 * Plugin contract for Firewatch extensions.
 *
 * Plugins can enrich entries during sync, provide additional query filters,
 * and perform initialization on CLI startup.
 */
export interface FirewatchPlugin {
  /** Unique plugin name */
  name: string;

  /** Plugin version (semver) */
  version: string;

  /**
   * Called during sync to enrich entries with plugin-specific data.
   * @param entry - The entry to enrich
   * @returns The enriched entry (may be mutated or replaced)
   */
  enrich?(entry: FirewatchEntry): Promise<FirewatchEntry>;

  /**
   * Called to provide additional query filters.
   * @returns A map of filter names to filter functions
   */
  queryFilters?(): Record<
    string,
    (entry: FirewatchEntry, value: string) => boolean
  >;

  /**
   * Called on CLI init to set up the plugin.
   * @param config - The current Firewatch configuration
   */
  init?(config: FirewatchConfig): Promise<void>;
}
