import {
  doctorHandler,
  getDatabase,
  loadConfig,
} from "@outfitter/firewatch-core";
import { silentLogger } from "@outfitter/firewatch-shared";
import { Command, Option } from "commander";

import { applyCommonOptions } from "../query-helpers";
import { formatCheckResult, renderHeader } from "../render";
import { outputStructured } from "../utils/json";
import { shouldOutputJson } from "../utils/tty";

interface DoctorCommandOptions {
  jsonl?: boolean;
  json?: boolean;
  fix?: boolean;
  debug?: boolean;
  noColor?: boolean;
}

export const doctorCommand = new Command("doctor")
  .description("Diagnose Firewatch setup")
  .option("--jsonl", "Force structured output")
  .option("--no-jsonl", "Force human-readable output")
  .addOption(new Option("--json").hideHelp())
  .option("--fix", "Attempt to fix issues automatically")
  .option("--debug", "Enable debug logging")
  .option("--no-color", "Disable color output")
  .action(async (options: DoctorCommandOptions) => {
    applyCommonOptions(options);
    try {
      const config = await loadConfig();
      const db = getDatabase();
      const ctx = { config, db, logger: silentLogger };

      const result = await doctorHandler({ fix: options.fix }, ctx);
      if (result.isErr()) {
        console.error("Doctor failed:", result.error.message);
        process.exit(1);
      }

      const output = result.value;
      const { checks, graphite, counts } = output;

      if (shouldOutputJson(options, config.output?.default_format)) {
        await outputStructured(
          {
            ok: counts.failed === 0,
            checks,
            graphite: {
              available: graphite.available,
              stackCount: graphite.stacks ?? 0,
            },
            counts,
          },
          "jsonl"
        );
        return;
      }

      // Render header
      const headerLines = renderHeader(["Firewatch Health Check"], {
        width: 24,
      });
      for (const line of headerLines) {
        console.log(line);
      }
      console.log("");

      // Render checks with colored markers
      for (const check of checks) {
        const lines = formatCheckResult(
          check.name,
          check.ok,
          check.message,
          check.hint
        );
        for (const line of lines) {
          console.log(line);
        }
      }

      // Show Graphite stack info if CLI is available
      const graphiteCheck = checks.find((c) => c.name === "Graphite CLI");
      if (graphiteCheck?.ok && graphite.stacks && graphite.stacks > 0) {
        console.log(`  ${graphite.stacks} active stack(s)`);
      }

      // Summary
      console.log("");
      console.log(`${counts.ok} passed, ${counts.failed} failed`);
    } catch (error) {
      console.error(
        "Doctor failed:",
        error instanceof Error ? error.message : error
      );
      process.exit(1);
    }
  });
