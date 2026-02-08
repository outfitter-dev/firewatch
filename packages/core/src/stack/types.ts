/**
 * Stack Provider Types
 *
 * Abstractions for stack-based PR workflows. Currently supports Graphite,
 * designed to accommodate future GitHub native stacks.
 */

/**
 * A branch in a stack with optional PR association.
 */
export interface StackBranch {
  /** Branch name */
  name: string;
  /** PR number if the branch has an open PR */
  pr?: number;
}

/**
 * A stack of branches from trunk to tip.
 */
export interface Stack {
  /** Stack identifier (typically the tip branch name) */
  id: string;
  /** Trunk branch this stack is based on */
  trunk: string;
  /** Branches in order from trunk to tip */
  branches: StackBranch[];
}

/**
 * Position of a branch within its stack.
 */
export interface StackPosition {
  /** The stack containing this branch */
  stack: Stack;
  /** Zero-based index in the stack's branches array */
  index: number;
  /** The branch at this position */
  branch: StackBranch;
}

/**
 * Direction for filtering stack PRs.
 */
export type StackDirection = "all" | "up" | "down";

/**
 * Result of stack PR query.
 */
export interface StackPRs {
  /** PR numbers matching the direction filter */
  prs: number[];
  /** The current branch's PR (if any) */
  currentPr?: number;
  /** Stack context */
  stack: Stack;
  /** Direction used for filtering */
  direction: StackDirection;
}

/**
 * Stack provider interface for abstracting stack detection.
 *
 * Implementations should handle their specific tooling (Graphite, GitHub native, etc.)
 * and return normalized stack information.
 */
export interface StackProvider {
  /** Provider name for identification */
  readonly name: string;

  /**
   * Check if this provider is available in the current environment.
   */
  isAvailable(): Promise<boolean>;

  /**
   * Get all stacks in the repository.
   */
  getStacks(): Promise<Stack[]>;

  /**
   * Get the stack containing a specific branch.
   * Returns null if the branch is not part of any stack.
   */
  getStackForBranch(branch: string): Promise<StackPosition | null>;

  /**
   * Get PR numbers for a branch's stack, optionally filtered by direction.
   *
   * @param branch - Branch name to find stack for
   * @param direction - Which PRs to include:
   *   - "all": All PRs in the stack
   *   - "down": Current PR + PRs toward trunk (ancestors)
   *   - "up": Current PR + PRs toward tip (descendants)
   */
  getStackPRs(
    branch: string,
    direction?: StackDirection
  ): Promise<StackPRs | null>;
}
