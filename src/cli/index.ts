import { Command } from "commander";

import { configCommand } from "./commands/config";
import { queryCommand } from "./commands/query";
import { syncCommand } from "./commands/sync";

const program = new Command();

program
  .name("fw")
  .description(
    "GitHub PR activity logger with pure JSONL output for jq-based workflows"
  )
  .version("0.1.0");

program.addCommand(syncCommand);
program.addCommand(queryCommand);
program.addCommand(configCommand);

export { program };

export function run(): void {
  program.parse();
}
