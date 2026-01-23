/**
 * Graphite Stack Provider
 *
 * Implements StackProvider using Graphite CLI (gt) for stack detection.
 * Uses `gt state` for branch relationships and `gh pr list` for PR numbers.
 */

import { $ } from "bun";

import type {
  Stack,
  StackBranch,
  StackDirection,
  StackPosition,
  StackPRs,
  StackProvider,
} from "./types";

/**
 * Raw branch state from `gt state` output.
 */
interface GraphiteBranchState {
  trunk: boolean;
  needs_restack?: boolean;
  parents?: { ref: string; sha: string }[];
}

/**
 * Parsed `gt state` output.
 */
type GraphiteState = Record<string, GraphiteBranchState>;

/**
 * Cache for expensive operations.
 */
interface GraphiteCache {
  state: GraphiteState | null;
  stacks: Stack[] | null;
  prNumbers: Map<string, number | null>;
}

const cache: GraphiteCache = {
  state: null,
  stacks: null,
  prNumbers: new Map(),
};

/**
 * Check if Graphite CLI is available.
 */
async function checkGraphiteAvailable(): Promise<boolean> {
  const result = await $`gt --version`.nothrow().quiet();
  return result.exitCode === 0;
}

/**
 * Get raw state from `gt state`.
 */
async function getGraphiteState(): Promise<GraphiteState | null> {
  if (cache.state) {
    return cache.state;
  }

  const result = await $`gt state`.nothrow().quiet();
  if (result.exitCode !== 0) {
    return null;
  }

  try {
    const state = JSON.parse(result.text()) as GraphiteState;
    cache.state = state;
    return state;
  } catch {
    return null;
  }
}

/**
 * Get PR number for a branch using gh CLI.
 */
async function getPRNumber(branch: string): Promise<number | null> {
  if (cache.prNumbers.has(branch)) {
    return cache.prNumbers.get(branch) ?? null;
  }

  const result = await $`gh pr list --head ${branch} --json number --limit 1`
    .nothrow()
    .quiet();

  if (result.exitCode !== 0) {
    cache.prNumbers.set(branch, null);
    return null;
  }

  try {
    const prs = JSON.parse(result.text()) as { number: number }[];
    const prNumber = prs[0]?.number ?? null;
    cache.prNumbers.set(branch, prNumber);
    return prNumber;
  } catch {
    cache.prNumbers.set(branch, null);
    return null;
  }
}

/**
 * Build a stack from trunk to a given branch.
 */
function buildStackToBranch(
  state: GraphiteState,
  targetBranch: string
): string[] | null {
  const path: string[] = [];
  let current = targetBranch;

  // Walk from target back to trunk
  while (current) {
    const branchState = state[current];
    if (!branchState) {
      return null;
    }

    path.unshift(current);

    if (branchState.trunk) {
      break;
    }

    const parent = branchState.parents?.[0]?.ref;
    if (!parent) {
      return null;
    }
    current = parent;
  }

  return path;
}

/**
 * Find all tip branches (branches with no children).
 */
function findTipBranches(state: GraphiteState): string[] {
  const hasChildren = new Set<string>();

  for (const branchState of Object.values(state)) {
    if (branchState.parents) {
      for (const parent of branchState.parents) {
        hasChildren.add(parent.ref);
      }
    }
  }

  return Object.entries(state)
    .filter(([name, s]) => !s.trunk && !hasChildren.has(name))
    .map(([name]) => name);
}

/**
 * Build all stacks from state.
 */
async function buildStacks(state: GraphiteState): Promise<Stack[]> {
  const tips = findTipBranches(state);
  const stacks: Stack[] = [];
  const processedBranches = new Set<string>();

  for (const tip of tips) {
    const path = buildStackToBranch(state, tip);
    if (!path || path.length < 2) {
      continue;
    }

    // First element is trunk
    const trunk = path[0];
    if (!trunk) {
      continue;
    }
    const branchNames = path.slice(1);

    // Skip if we've already processed these branches in another stack
    if (branchNames.some((b) => processedBranches.has(b))) {
      continue;
    }

    // Get PR numbers for each branch
    const branches: StackBranch[] = await Promise.all(
      branchNames.map(async (name) => {
        const pr = await getPRNumber(name);
        processedBranches.add(name);
        return { name, ...(pr && { pr }) };
      })
    );

    stacks.push({
      id: tip,
      trunk,
      branches,
    });
  }

  return stacks;
}

/**
 * Clear the cache (useful for testing or forcing refresh).
 */
export function clearGraphiteCache(): void {
  cache.state = null;
  cache.stacks = null;
  cache.prNumbers.clear();
}

/**
 * Graphite stack provider implementation.
 */
export const graphiteStackProvider: StackProvider = {
  name: "graphite",

  async isAvailable(): Promise<boolean> {
    return await checkGraphiteAvailable();
  },

  async getStacks(): Promise<Stack[]> {
    if (cache.stacks) {
      return cache.stacks;
    }

    const state = await getGraphiteState();
    if (!state) {
      return [];
    }

    const stacks = await buildStacks(state);
    cache.stacks = stacks;
    return stacks;
  },

  async getStackForBranch(branch: string): Promise<StackPosition | null> {
    const stacks = await this.getStacks();

    for (const stack of stacks) {
      const index = stack.branches.findIndex((b) => b.name === branch);
      if (index !== -1) {
        const stackBranch = stack.branches[index];
        if (stackBranch) {
          return {
            stack,
            index,
            branch: stackBranch,
          };
        }
      }
    }

    return null;
  },

  async getStackPRs(
    branch: string,
    direction: StackDirection = "all"
  ): Promise<StackPRs | null> {
    const position = await this.getStackForBranch(branch);
    if (!position) {
      return null;
    }

    const { stack, index, branch: currentBranch } = position;
    let filteredBranches: StackBranch[];

    switch (direction) {
      case "down":
        // Current + ancestors (toward trunk)
        filteredBranches = stack.branches.slice(0, index + 1);
        break;
      case "up":
        // Current + descendants (toward tip)
        filteredBranches = stack.branches.slice(index);
        break;
      default:
        // "all" - entire stack
        filteredBranches = stack.branches;
        break;
    }

    const prs = filteredBranches
      .map((b) => b.pr)
      .filter((pr): pr is number => pr !== undefined);

    return {
      prs,
      ...(currentBranch.pr !== undefined && { currentPr: currentBranch.pr }),
      stack,
      direction,
    };
  },
};
