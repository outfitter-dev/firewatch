/**
 * Core types for the render module.
 */

/** Viewport dimensions for terminal-aware rendering */
export interface Viewport {
  width: number;
  height?: number;
}

/** Tree node for hierarchical rendering */
export interface TreeNode {
  content: string;
  detail?: string;
  children?: TreeNode[];
}

/** Options for tree rendering */
export interface TreeOptions {
  indent?: number;
  viewport?: Viewport;
}

/** Header level for visual hierarchy */
export type HeaderLevel = "primary" | "secondary" | "tertiary";

/** Output target affects rendering decisions */
export type OutputTarget = "tty" | "pipe" | "file";
