import {
  CONFIG_SCHEMA_DOC,
  ENTRY_SCHEMA_DOC,
  FB_SCHEMA_DOC,
  STATUS_SCHEMA_DOC,
  WORKLIST_SCHEMA_DOC,
} from "@outfitter/firewatch-core/schema";
import { Command } from "commander";

import { emitAliasHint } from "../utils/alias-hint";
import { outputStructured } from "../utils/json";

/**
 * Command names that map to their output schemas.
 * These are the primary, documented schema names.
 */
export type SchemaCommand = "query" | "fb" | "status" | "config";

/**
 * Legacy type names kept as hidden aliases for backward compatibility.
 */
type SchemaAlias = "entry" | "worklist";

type SchemaName = SchemaCommand | SchemaAlias;

const VALID_COMMANDS = new Set<SchemaCommand>([
  "query",
  "fb",
  "status",
  "config",
]);

const schemaMap: Record<SchemaCommand, unknown> = {
  query: ENTRY_SCHEMA_DOC,
  fb: FB_SCHEMA_DOC,
  status: STATUS_SCHEMA_DOC,
  config: CONFIG_SCHEMA_DOC,
};

/**
 * Hidden aliases for backward compatibility.
 * Maps old type names to their canonical command names.
 */
const aliasMap: Record<
  SchemaAlias,
  { canonical: SchemaCommand; hint: string }
> = {
  entry: { canonical: "query", hint: "fw schema query" },
  worklist: {
    canonical: "query",
    hint: "worklist is a legacy alias (use fw --summary for worklist output)",
  },
};

function isSchemaCommand(name: string): name is SchemaCommand {
  return VALID_COMMANDS.has(name as SchemaCommand);
}

function isSchemaAlias(name: string): name is SchemaAlias {
  return name in aliasMap;
}

export async function printSchema(name: SchemaName): Promise<void> {
  // Handle aliases with deprecation hint
  if (isSchemaAlias(name)) {
    const alias = aliasMap[name];
    emitAliasHint(`fw schema ${name}`, alias.hint);

    // For worklist, show WORKLIST_SCHEMA_DOC since it's a distinct schema
    if (name === "worklist") {
      await outputStructured(WORKLIST_SCHEMA_DOC, "json");
      return;
    }

    // For entry, show the canonical query schema
    await outputStructured(schemaMap[alias.canonical], "json");
    return;
  }

  const schema = schemaMap[name];
  await outputStructured(schema, "json");
}

export const schemaCommand = new Command("schema")
  .description("Print JSON schema for command outputs")
  .argument(
    "[command]",
    "Command to show schema for: query, fb, status, config",
    "query"
  )
  .option("--debug", "Enable debug logging")
  .option("--no-color", "Disable color output")
  .action(async (name: string) => {
    if (!isSchemaCommand(name) && !isSchemaAlias(name)) {
      console.error(
        `Unknown schema: ${name}\n\nValid schemas:\n  query   - Entry schema (fw query output)\n  fb      - Feedback item schema (fw fb output)\n  status  - Status output schema (fw status output)\n  config  - Configuration file schema`
      );
      process.exit(1);
    }
    await printSchema(name as SchemaName);
  });
