import type {
  FirewatchEntry,
  PrState,
  SyncScope,
  WorklistEntry,
} from "@outfitter/firewatch-core";

import type { FirewatchParams } from "../types";

const ENTRY_TYPES = ["comment", "review", "commit", "ci", "event"] as const;
const ENTRY_TYPE_SET = new Set<string>(ENTRY_TYPES);
const PR_STATES = ["open", "closed", "merged", "draft"] as const;
const PR_STATE_SET = new Set<string>(PR_STATES);

export const DEFAULT_STALE_THRESHOLD = "5m";

export function toStringList(value?: string | string[]): string[] {
  if (!value) {
    return [];
  }

  const items = Array.isArray(value) ? value : [value];
  return items
    .flatMap((item) => item.split(","))
    .map((item) => item.trim())
    .filter(Boolean);
}

export function toNumberList(value?: number | number[] | string): number[] {
  if (value === undefined) {
    return [];
  }

  const items = Array.isArray(value) ? value : [value];
  const results: number[] = [];

  for (const item of items) {
    if (typeof item === "number") {
      results.push(item);
      continue;
    }

    if (typeof item === "string") {
      const parts = item
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
      for (const part of parts) {
        const parsed = Number.parseInt(part, 10);
        if (Number.isNaN(parsed)) {
          throw new TypeError(`Invalid PR number: ${part}`);
        }
        results.push(parsed);
      }
    }
  }

  return results;
}

export function requirePrNumber(
  value: FirewatchParams["pr"],
  action: string
): number {
  if (typeof value !== "number" || Number.isNaN(value) || value <= 0) {
    throw new Error(`${action} requires pr.`);
  }
  return value;
}

export function resolveStates(params: FirewatchParams): PrState[] {
  if (params.states && params.states.length > 0) {
    return params.states;
  }

  const explicit = toStringList(params.state);
  if (explicit.length > 0) {
    const resolved: PrState[] = [];
    for (const value of explicit) {
      const normalized = value.toLowerCase();
      if (!PR_STATE_SET.has(normalized)) {
        throw new Error(`Invalid state: ${value}`);
      }
      if (!resolved.includes(normalized as PrState)) {
        resolved.push(normalized as PrState);
      }
    }
    return resolved;
  }

  const combined: PrState[] = [];
  if (params.open) {
    combined.push("open", "draft");
  }
  if (params.ready) {
    combined.push("open");
    if (!params.draft) {
      const draftIndex = combined.indexOf("draft");
      if (draftIndex !== -1) {
        combined.splice(draftIndex, 1);
      }
    }
  }
  if (params.closed) {
    combined.push("closed", "merged");
  }
  if (params.draft) {
    combined.push("draft");
  }

  if (combined.length > 0) {
    return [...new Set(combined)];
  }

  // Orphaned implies merged/closed PRs (unresolved comments on finished PRs)
  if (params.orphaned) {
    return ["closed", "merged"];
  }

  return ["open", "draft"];
}

export function resolveSyncScopes(states: PrState[]): SyncScope[] {
  if (states.length === 0) {
    return ["open"];
  }

  const scopes = new Set<SyncScope>();
  for (const state of states) {
    if (state === "open" || state === "draft") {
      scopes.add("open");
    }
    if (state === "closed" || state === "merged") {
      scopes.add("closed");
    }
  }

  if (scopes.size === 0) {
    return ["open"];
  }

  const ordered: SyncScope[] = [];
  if (scopes.has("open")) {
    ordered.push("open");
  }
  if (scopes.has("closed")) {
    ordered.push("closed");
  }
  return ordered;
}

export function resolveTypeList(
  value: FirewatchParams["type"]
): FirewatchEntry["type"][] {
  const types = toStringList(value as string | string[]);
  if (types.length === 0) {
    return [];
  }

  const resolved: FirewatchEntry["type"][] = [];
  for (const type of types) {
    const normalized = type.toLowerCase();
    if (!ENTRY_TYPE_SET.has(normalized)) {
      throw new Error(`Invalid type: ${type}`);
    }
    if (!resolved.includes(normalized as FirewatchEntry["type"])) {
      resolved.push(normalized as FirewatchEntry["type"]);
    }
  }

  return resolved;
}

export function resolveLabelFilter(
  value: FirewatchParams["label"]
): string | undefined {
  if (!value) {
    return undefined;
  }

  const labels = toStringList(value);
  if (labels.length > 1) {
    throw new Error("Label filter supports a single value.");
  }

  return labels[0];
}

export function resolveAuthorLists(value: FirewatchParams["author"]): {
  include: string[];
  exclude: string[];
} {
  const authors = toStringList(value);
  const include: string[] = [];
  const exclude: string[] = [];

  for (const author of authors) {
    if (author.startsWith("!")) {
      const trimmed = author.slice(1).trim();
      if (trimmed) {
        exclude.push(trimmed);
      }
    } else if (author) {
      include.push(author);
    }
  }

  return { include, exclude };
}

export function formatStatusShort(items: WorklistEntry[]) {
  return items.map((item) => ({
    repo: item.repo,
    pr: item.pr,
    pr_title: item.pr_title,
    pr_state: item.pr_state,
    pr_author: item.pr_author,
    last_activity_at: item.last_activity_at,
    comments: item.counts.comments,
    changes_requested: item.review_states?.changes_requested ?? 0,
    ...(item.graphite?.stack_id && {
      stack_id: item.graphite.stack_id,
      stack_position: item.graphite.stack_position,
    }),
  }));
}

/** Check if params contain any PR edit fields (title, body, base, draft, ready, milestone) */
export function hasEditFields(
  params: Pick<
    FirewatchParams,
    "title" | "body" | "base" | "draft" | "ready" | "milestone"
  >
): boolean {
  return !!(
    params.title ||
    params.body ||
    params.base ||
    params.draft ||
    params.ready ||
    params.milestone
  );
}
