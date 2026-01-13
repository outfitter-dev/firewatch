import type { FirewatchConfig, PrState } from "@outfitter/firewatch-core";

export interface StateOptions {
  state?: string;
  open?: boolean;
  draft?: boolean;
  active?: boolean;
}

export function parseStates(value: string): PrState[] {
  return value.split(",").map((s) => s.trim() as PrState);
}

export function resolveStates(
  options: StateOptions,
  config: FirewatchConfig
): PrState[] {
  if (options.state) {
    return parseStates(options.state);
  }
  if (options.active) {
    return ["open", "draft"];
  }
  if (options.open && options.draft) {
    return ["open", "draft"];
  }
  if (options.open) {
    return ["open"];
  }
  if (options.draft) {
    return ["draft"];
  }
  return config.default_states ?? ["open", "draft"];
}
