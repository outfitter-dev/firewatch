import { $ } from "bun";
import { Command } from "commander";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { applyCommonOptions } from "../query-helpers";

interface ClaudePluginOptions {
  uninstall?: boolean;
  status?: boolean;
  debug?: boolean;
  noColor?: boolean;
}

const MARKETPLACE_NAME = "firewatch";
const PLUGIN_ID = "firewatch@firewatch";

/**
 * Validate that a path contains a valid plugin marketplace.
 */
function isValidPluginPath(path: string): boolean {
  const marketplaceJson = join(path, ".claude-plugin", "marketplace.json");
  return existsSync(marketplaceJson);
}

/**
 * Check if we're running as a compiled Bun binary.
 * Compiled binaries have Bun.main pointing to a virtual path like /$bunfs/root/...
 */
function isCompiledBinary(): boolean {
  return typeof Bun !== "undefined" && Bun.main?.startsWith("/$bunfs/");
}

/**
 * Get the directory where the executable is located.
 * Works for both compiled binaries and development mode.
 */
function getExecutableDir(): string {
  // For compiled Bun binaries, process.execPath is the actual binary path
  if (isCompiledBinary()) {
    return dirname(process.execPath);
  }
  // For development mode, use import.meta.dirname
  return import.meta.dirname;
}

/**
 * Find the claude-plugin directory.
 *
 * Resolution order:
 * 1. FIREWATCH_PLUGIN_PATH environment variable (explicit override)
 * 2. Bundled path relative to executable (compiled/installed case)
 * 3. Walk up from module location (development case)
 */
function findPluginPath(): string | null {
  // 1. Environment variable override
  const envPath = process.env.FIREWATCH_PLUGIN_PATH;
  if (envPath) {
    const resolved = resolve(envPath);
    if (isValidPluginPath(resolved)) {
      return resolved;
    }
    // If explicitly set but invalid, warn but continue
    console.warn(`FIREWATCH_PLUGIN_PATH set but invalid: ${envPath}`);
  }

  const execDir = getExecutableDir();

  // 2. Bundled path - check relative to executable location
  // For compiled binary: plugin is at ./claude-plugin relative to binary
  const bundledPath = join(execDir, "claude-plugin");
  if (isValidPluginPath(bundledPath)) {
    return resolve(bundledPath);
  }

  // Also check parent directory (in case binary is in bin/ subdirectory)
  const bundledPathParent = join(dirname(execDir), "claude-plugin");
  if (isValidPluginPath(bundledPathParent)) {
    return resolve(bundledPathParent);
  }

  // 3. Development mode - walk up looking for packages/claude-plugin
  let current = dirname(execDir);
  for (let i = 0; i < 10; i++) {
    const candidate = join(current, "packages", "claude-plugin");
    if (isValidPluginPath(candidate)) {
      return resolve(candidate);
    }

    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return null;
}

async function checkClaudeCli(): Promise<boolean> {
  try {
    const result = await $`claude --version`.quiet();
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

async function installPlugin(pluginPath: string): Promise<void> {
  console.log(`Registering marketplace at: ${pluginPath}`);

  // Add marketplace
  const marketplaceResult =
    await $`claude plugin marketplace add ${pluginPath}`.quiet();
  if (marketplaceResult.exitCode === 0) {
    console.log("Marketplace registered");
  } else {
    const stderr = marketplaceResult.stderr.toString().trim();
    // Check if it's already registered (not an error)
    if (stderr.includes("already") || !stderr) {
      console.log("Marketplace already registered");
    } else {
      throw new Error(`Failed to add marketplace: ${stderr}`);
    }
  }

  // Install plugin
  console.log(`Installing plugin: ${PLUGIN_ID}`);
  const pluginResult = await $`claude plugin install ${PLUGIN_ID}`.quiet();
  if (pluginResult.exitCode === 0) {
    console.log("Plugin installed");
  } else {
    const stderr = pluginResult.stderr.toString().trim();
    if (stderr.includes("already") || !stderr) {
      console.log("Plugin already installed");
    } else {
      throw new Error(`Failed to install plugin: ${stderr}`);
    }
  }

  console.log("\nFirewatch Claude plugin ready!");
  console.log("Available commands in Claude Code:");
  console.log("  /firewatch:help     - Show usage");
  console.log("  /firewatch:sync     - Sync PR activity");
  console.log("  /firewatch:reviews  - Query review comments");
  console.log("  /firewatch:status   - Check status");
}

async function uninstallPlugin(): Promise<void> {
  console.log(`Removing plugin: ${PLUGIN_ID}`);

  const pluginResult = await $`claude plugin uninstall ${PLUGIN_ID}`.quiet();
  if (pluginResult.exitCode === 0) {
    console.log("Plugin removed");
  } else {
    const stderr = pluginResult.stderr.toString().trim();
    const isNotInstalled =
      stderr.includes("not found") ||
      stderr.includes("not installed") ||
      !stderr;
    if (isNotInstalled) {
      console.log("Plugin was not installed");
    } else {
      throw new Error(`Failed to remove plugin: ${stderr}`);
    }
  }

  console.log(`Removing marketplace: ${MARKETPLACE_NAME}`);
  const marketplaceResult =
    await $`claude plugin marketplace remove ${MARKETPLACE_NAME}`.quiet();
  if (marketplaceResult.exitCode === 0) {
    console.log("Marketplace removed");
  } else {
    const stderr = marketplaceResult.stderr.toString().trim();
    if (stderr.includes("not found") || !stderr) {
      console.log("Marketplace was not registered");
    } else {
      throw new Error(`Failed to remove marketplace: ${stderr}`);
    }
  }

  console.log("\nFirewatch Claude plugin uninstalled.");
}

async function checkPluginStatus(): Promise<void> {
  // Check if marketplace is registered
  const marketplaceResult = await $`claude plugin marketplace list`.quiet();
  const marketplaceOutput = marketplaceResult.stdout.toString();
  const hasMarketplace = marketplaceOutput.includes(MARKETPLACE_NAME);

  // Check if plugin is installed
  const pluginResult = await $`claude plugin list`.quiet();
  const pluginOutput = pluginResult.stdout.toString();
  const hasPlugin = pluginOutput.includes(PLUGIN_ID);

  console.log("Firewatch Claude Plugin Status");
  console.log("─".repeat(30));
  console.log(`Marketplace registered: ${hasMarketplace ? "✓" : "✗"}`);
  console.log(`Plugin installed:       ${hasPlugin ? "✓" : "✗"}`);

  if (hasMarketplace && hasPlugin) {
    console.log("\nStatus: Ready");
  } else if (!hasMarketplace && !hasPlugin) {
    console.log("\nStatus: Not installed");
    console.log("Run 'fw claude-plugin' to install");
  } else {
    console.log("\nStatus: Partial installation");
    console.log(
      "Run 'fw claude-plugin --uninstall' then 'fw claude-plugin' to fix"
    );
  }
}

export const claudePluginCommand = new Command("claude-plugin")
  .description("Install or uninstall the Firewatch Claude Code plugin")
  .option("-u, --uninstall", "Uninstall the plugin")
  .option("-s, --status", "Check plugin installation status")
  .option("--debug", "Enable debug logging")
  .option("--no-color", "Disable color output")
  .action(async (options: ClaudePluginOptions) => {
    applyCommonOptions(options);
    try {
      // Check claude CLI is available
      const hasClaudeCli = await checkClaudeCli();
      if (!hasClaudeCli) {
        console.error(
          "Claude CLI not found. Install it from: https://claude.ai/code"
        );
        process.exit(1);
      }

      if (options.status) {
        await checkPluginStatus();
        return;
      }

      if (options.uninstall) {
        await uninstallPlugin();
        return;
      }

      // Find plugin path
      const pluginPath = findPluginPath();
      if (!pluginPath) {
        console.error("Could not find claude-plugin directory.");
        console.error("Expected at: <firewatch-root>/packages/claude-plugin");
        console.error("Or bundled at: <binary-dir>/claude-plugin");
        process.exit(1);
      }

      await installPlugin(pluginPath);
    } catch (error) {
      console.error(
        "Operation failed:",
        error instanceof Error ? error.message : error
      );
      process.exit(1);
    }
  });
