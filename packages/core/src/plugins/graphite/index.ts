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

/**
 * Output format from `gt state` command
 */
interface GtStateBranch {
  trunk: boolean;
  needs_restack?: boolean;
  parents?: Array<{ ref: string; sha: string }>;
}
type GtStateOutput = Record<string, GtStateBranch>;

/**
 * Output format from `gh pr list --json`
 */
interface GhPrListItem {
  number: number;
  headRefName: string;
}

type FileProvenanceMap = Map<string, FileProvenance>;
type FileProvenanceIndex = Map<string, FileProvenanceMap>;

let cachedStacks: GraphiteStack[] | null | undefined;
let stackPromise: Promise<GraphiteStack[] | null> | null = null;
let cachedProvenance: FileProvenanceIndex | null | undefined;
let provenancePromise: Promise<FileProvenanceIndex | null> | null = null;

/**
 * Transform flat gt state output into ordered GraphiteStack[] structure.
 *
 * Strategy:
 * 1. Find trunk branch (where trunk: true)
 * 2. Build child relationships by inverting parent refs
 * 3. Find leaf branches (no children, not trunk)
 * 4. Walk each leaf up to trunk to build ordered stack
 */
function transformGtStateToStacks(
  gtState: GtStateOutput,
  prMap: Map<string, number>
): GraphiteStack[] {
  // Find trunk branch
  let trunkBranch: string | undefined;
  for (const [branch, data] of Object.entries(gtState)) {
    if (data.trunk) {
      trunkBranch = branch;
      break;
    }
  }

  if (!trunkBranch) {
    return [];
  }

  // Build child relationships by inverting parent refs
  const children = new Map<string, string[]>();
  for (const [branch, data] of Object.entries(gtState)) {
    if (data.trunk) continue;

    // A branch's parent is the first entry in parents array
    const parentRef = data.parents?.[0]?.ref;
    if (parentRef) {
      const existing = children.get(parentRef) ?? [];
      existing.push(branch);
      children.set(parentRef, existing);
    }
  }

  // Find leaf branches (branches with no children, not trunk)
  const leaves: string[] = [];
  for (const [branch, data] of Object.entries(gtState)) {
    if (data.trunk) continue;
    const branchChildren = children.get(branch) ?? [];
    if (branchChildren.length === 0) {
      leaves.push(branch);
    }
  }

  // Walk each leaf up to trunk to build ordered stacks
  const stacks: GraphiteStack[] = [];
  for (const leaf of leaves) {
    const stackBranches: GraphiteStackBranch[] = [];
    let current: string | undefined = leaf;

    // Walk up the parent chain until we hit trunk
    while (current && current !== trunkBranch) {
      const branchData: GtStateBranch | undefined = gtState[current];
      if (!branchData) break;

      const prNumber = prMap.get(current);
      stackBranches.unshift({
        name: current,
        ...(prNumber !== undefined && { prNumber }),
      });

      // Move to parent
      current = branchData.parents?.[0]?.ref;
    }

    if (stackBranches.length > 0) {
      // Use the leaf branch name as stack name
      stacks.push({
        name: leaf,
        branches: stackBranches,
      });
    }
  }

  return stacks;
}

function loadStacks(): Promise<GraphiteStack[] | null> {
  if (cachedStacks !== undefined) {
    return Promise.resolve(cachedStacks);
  }

  if (!stackPromise) {
    stackPromise = (async () => {
      // Fetch gt state and gh pr list in parallel
      const [gtStateResult, ghPrResult] = await Promise.all([
        $`gt state`.nothrow().quiet(),
        $`gh pr list --state open --json number,headRefName --limit 100`
          .nothrow()
          .quiet(),
      ]);

      // gt state must succeed
      if (gtStateResult.exitCode !== 0) {
        cachedStacks = null;
        return cachedStacks;
      }

      try {
        const gtState = JSON.parse(gtStateResult.text()) as GtStateOutput;

        // Build PR number map from gh pr list (may fail if not in a gh repo)
        const prMap = new Map<string, number>();
        if (ghPrResult.exitCode === 0) {
          const prList = JSON.parse(ghPrResult.text()) as GhPrListItem[];
          for (const pr of prList) {
            prMap.set(pr.headRefName, pr.number);
          }
        }

        const stacks = transformGtStateToStacks(gtState, prMap);
        cachedStacks = stacks;
        return stacks;
      } catch {
        cachedStacks = null;
        return cachedStacks;
      }
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
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
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
 * fw --type review | jq 'select(.graphite.stack_id == "feat-auth")'
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
