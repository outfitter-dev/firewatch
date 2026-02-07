import {
  PATHS,
  getConfigPaths,
  getProjectConfigPath,
  loadConfig,
  type FirewatchConfig,
} from "@outfitter/firewatch-core";

import type { FirewatchParams, McpToolResult } from "../types";
import { textResult } from "../utils/formatting";

function redactConfig(config: FirewatchConfig): FirewatchConfig {
  if (!config.github_token) {
    return config;
  }

  return {
    ...config,
    github_token: "***",
  };
}

function getConfigValue(config: FirewatchConfig, key: string): unknown {
  const normalized = key.replaceAll("-", "_");
  const segments = normalized.split(".");
  let current: unknown = config;

  for (const segment of segments) {
    if (!current || typeof current !== "object") {
      return undefined;
    }
    const record = current as Record<string, unknown>;
    if (!(segment in record)) {
      return undefined;
    }
    current = record[segment];
  }

  return current;
}

export async function handleConfig(
  params: FirewatchParams
): Promise<McpToolResult> {
  if (params.value !== undefined) {
    throw new Error("config updates are not supported via MCP. Use the CLI.");
  }

  const config = await loadConfig();
  const configPaths = await getConfigPaths();
  const projectPath = await getProjectConfigPath();

  if (params.path) {
    return textResult(
      JSON.stringify({
        paths: {
          user: configPaths.user,
          project: projectPath,
          cache: PATHS.cache,
          repos: PATHS.repos,
          meta: PATHS.meta,
        },
      })
    );
  }

  if (params.key) {
    const value = getConfigValue(redactConfig(config), params.key);
    return textResult(
      JSON.stringify({
        ok: value !== undefined,
        key: params.key,
        value,
      })
    );
  }

  return textResult(
    JSON.stringify({
      config: redactConfig(config),
      paths: {
        user: configPaths.user,
        project: projectPath,
      },
    })
  );
}
