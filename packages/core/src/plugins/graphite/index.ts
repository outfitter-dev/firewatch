import { $ } from "bun";

import type { FirewatchEntry, FileProvenance } from "../../schema/entry";
import type { FirewatchPlugin } from "../types";

interface GraphiteStackBranch {
  name: string;
  prNumber?: number;
}

export interface GraphiteStack {
  name: string;
  branches: GraphiteStackBranch[];
}

type FileProvenanceMap = Map<string, FileProvenance>;
type FileProvenanceIndex = Map<string, FileProvenanceMap>;

let cachedStacks: GraphiteStack[] | null | undefined;
let stackPromise: Promise<GraphiteStack[] | null> | null = null;
let cachedProvenance: FileProvenanceIndex | null | undefined;
let provenancePromise: Promise<FileProvenanceIndex | null> | null = null;

function stripAnsi(text: string): string {
  let result = "";
  let index = 0;

  while (index < text.length) {
    const code = text.codePointAt(index);
    if (code === undefined) {
      break;
    }
    if (code === 0x1B || code === 0x9B) {
      index += 1;
      if (code === 0x1B && text[index] === "[") {
        index += 1;
      }

      while (index < text.length) {
        const char = text[index]!;
        if (
          (char >= "A" && char <= "Z") ||
          (char >= "a" && char <= "z")
        ) {
          index += 1;
          break;
        }
        index += 1;
      }

      continue;
    }

    result += text[index]!;
    index += 1;
  }

  return result;
}

export function parseGraphiteLog(output: string): GraphiteStack[] {
  const branches: GraphiteStackBranch[] = [];
  let current: GraphiteStackBranch | null = null;

  const lines = stripAnsi(output).split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const branchMatch = trimmed.match(/^[◉◯]\s+(.+?)(?:\s+\(current\))?\s*$/);
    if (branchMatch) {
      current = { name: branchMatch[1]!.trim() };
      branches.push(current);
      continue;
    }

    const prMatch = trimmed.match(/PR\s+#(\d+)/);
    if (prMatch && current) {
      current.prNumber = Number.parseInt(prMatch[1]!, 10);
    }
  }

  const prBranches = branches.filter((branch) => branch.prNumber);
  if (prBranches.length === 0) {
    return [];
  }

  const ordered = prBranches.toReversed();
  const stackName = ordered[0]?.name ?? "stack";
  return [{ name: stackName, branches: ordered }];
}

function loadStacks(): Promise<GraphiteStack[] | null> {
  if (cachedStacks !== undefined) {
    return Promise.resolve(cachedStacks);
  }

  if (!stackPromise) {
    stackPromise = (async () => {
      const result = await $`gt log --stack --no-interactive`.nothrow().quiet();
      if (result.exitCode !== 0) {
        cachedStacks = null;
        return cachedStacks;
      }

      const stacks = parseGraphiteLog(result.text());
      cachedStacks = stacks.length > 0 ? stacks : null;
      return cachedStacks;
    })();
  }

  return stackPromise;
}

export function getGraphiteStacks(): Promise<GraphiteStack[] | null> {
  return loadStacks();
}

async function resolveTrunkBranch(): Promise<string> {
  const result = await $`git rev-parse --abbrev-ref origin/HEAD`
    .nothrow()
    .quiet();
  if (result.exitCode === 0) {
    const ref = result.text().trim();
    if (ref.startsWith("origin/")) {
      return ref.slice("origin/".length);
    }
  }
  return "main";
}

async function getChangedFiles(
  parent: string,
  branch: string
): Promise<string[]> {
  const result = await $`git diff --name-only ${parent}..${branch}`
    .nothrow()
    .quiet();
  if (result.exitCode !== 0) {
    return [];
  }
  const text = result.text().trim();
  if (!text) {
    return [];
  }
  return text.split("\n").map((line) => line.trim()).filter(Boolean);
}

async function getBranchCommit(branch: string): Promise<string | null> {
  const result = await $`git rev-parse --short ${branch}`.nothrow().quiet();
  if (result.exitCode !== 0) {
    return null;
  }
  const sha = result.text().trim();
  return sha.length > 0 ? sha : null;
}

async function buildStackProvenance(
  stack: GraphiteStack,
  trunk: string
): Promise<FileProvenanceMap> {
  const map: FileProvenanceMap = new Map();
  const branches = stack.branches;

  for (const [index, branch] of branches.entries()) {
    if (!branch.prNumber) {
      continue;
    }
    const parent = index === 0 ? trunk : branches[index - 1]?.name;
    if (!parent) {
      continue;
    }
    const files = await getChangedFiles(parent, branch.name);
    if (files.length === 0) {
      continue;
    }
    const commit = await getBranchCommit(branch.name);
    if (!commit) {
      continue;
    }

    for (const file of files) {
      map.set(file, {
        origin_pr: branch.prNumber,
        origin_branch: branch.name,
        origin_commit: commit,
        stack_position: index + 1,
      });
    }
  }

  return map;
}

function loadFileProvenance(): Promise<FileProvenanceIndex | null> {
  if (cachedProvenance !== undefined) {
    return Promise.resolve(cachedProvenance);
  }

  if (!provenancePromise) {
    provenancePromise = (async () => {
      const stacks = await getGraphiteStacks();
      if (!stacks) {
        cachedProvenance = null;
        return cachedProvenance;
      }

      const trunk = await resolveTrunkBranch();
      const index: FileProvenanceIndex = new Map();

      for (const stack of stacks) {
        const map = await buildStackProvenance(stack, trunk);
        if (map.size > 0) {
          index.set(stack.name, map);
        }
      }

      cachedProvenance = index;
      return cachedProvenance;
    })();
  }

  return provenancePromise;
}

export function getFileProvenanceIndex(): Promise<FileProvenanceIndex | null> {
  return loadFileProvenance();
}

/**
 * Graphite plugin for stack-aware PR activity tracking.
 *
 * Enriches entries with Graphite stack context, enabling queries like:
 * fw query --type review | jq 'select(.graphite.stack_id == "feat-auth")'
 */
export const graphitePlugin: FirewatchPlugin = {
  name: "graphite",
  version: "1.0.0",

  async enrich(entry: FirewatchEntry): Promise<FirewatchEntry> {
    try {
      // Get stack info for the PR's branch
      const stacks = await getGraphiteStacks();
      if (!stacks) {
        return entry;
      }

      const stack = stacks.find((s) =>
        s.branches.some((b) => b.prNumber === entry.pr)
      );

      if (stack) {
        const position = stack.branches.findIndex(
          (b) => b.prNumber === entry.pr
        );

        if (position !== -1) {
          entry.graphite = {
            stack_id: stack.name,
            stack_position: position + 1,
            stack_size: stack.branches.length,
            parent_pr:
              position > 0 ? stack.branches[position - 1]?.prNumber : undefined,
          };
        }
      }

      if (entry.file && entry.graphite?.stack_id) {
        const provenanceIndex = await getFileProvenanceIndex();
        const stackMap = provenanceIndex?.get(entry.graphite.stack_id);
        const provenance = stackMap?.get(entry.file);
        if (provenance) {
          entry.file_provenance = provenance;
        }
      }
    } catch {
      // Graphite not available or not in a repo, skip enrichment
    }

    return entry;
  },

  queryFilters() {
    return {
      stack: (entry, value) => entry.graphite?.stack_id === value,
      "stack-position": (entry, value) =>
        entry.graphite?.stack_position === Number.parseInt(value, 10),
    };
  },
};
