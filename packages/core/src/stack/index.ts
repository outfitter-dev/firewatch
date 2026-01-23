/**
 * Stack Provider Module
 *
 * Provides abstraction for stack-based PR workflows across different providers
 * (Graphite, future GitHub native stacks, etc.).
 */

import { graphiteStackProvider } from "./graphite";
import type { StackProvider } from "./types";

export type {
  Stack,
  StackBranch,
  StackDirection,
  StackPosition,
  StackProvider,
  StackPRs,
} from "./types";

export { clearGraphiteCache, graphiteStackProvider } from "./graphite";

/**
 * Registry of available stack providers.
 * Add new providers here as they become available.
 */
const providers: StackProvider[] = [graphiteStackProvider];

/**
 * Get the first available stack provider.
 * Returns null if no provider is available.
 */
export async function getStackProvider(): Promise<StackProvider | null> {
  for (const provider of providers) {
    if (await provider.isAvailable()) {
      return provider;
    }
  }
  return null;
}

/**
 * Get a specific stack provider by name.
 */
export function getStackProviderByName(name: string): StackProvider | null {
  return providers.find((p) => p.name === name) ?? null;
}

/**
 * Register a custom stack provider.
 * Useful for testing or custom integrations.
 */
export function registerStackProvider(provider: StackProvider): void {
  providers.push(provider);
}
