import type { PrState } from "@outfitter/firewatch-core";

const VALID_STATES = new Set(["open", "closed", "merged", "draft"]);

export interface StateOptions {
  state?: string;
  open?: boolean;
  closed?: boolean;
  draft?: boolean;
  active?: boolean;
}

export function parseStates(value: string): PrState[] {
  const states = value
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const invalid = states.filter((state) => !VALID_STATES.has(state));
  if (invalid.length > 0) {
    throw new Error(`Invalid state(s): ${invalid.join(", ")}`);
  }
  return states as PrState[];
}

export function resolveStates(options: StateOptions): PrState[] {
  if (options.state) {
    return parseStates(options.state);
  }

  const states = new Set<PrState>();

  if (options.active) {
    states.add("open");
    states.add("draft");
  }

  if (options.open) {
    states.add("open");
  }

  if (options.draft) {
    states.add("draft");
  }

  if (options.closed) {
    states.add("closed");
    states.add("merged");
  }

  if (states.size > 0) {
    return [...states];
  }

  return ["open", "draft"];
}
