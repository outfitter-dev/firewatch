/**
 * Cross-platform script to copy the claude-plugin directory to dist.
 * Used during build to bundle the plugin alongside the compiled binary.
 */
import { cp, rm } from "node:fs/promises";
import { join } from "node:path";

const src = join(import.meta.dirname, "../../../packages/claude-plugin");
const dest = join(import.meta.dirname, "../dist/claude-plugin");

// Remove existing dest if present
await rm(dest, { recursive: true, force: true });

// Copy recursively
await cp(src, dest, { recursive: true });

console.log("Copied claude-plugin to dist/");
