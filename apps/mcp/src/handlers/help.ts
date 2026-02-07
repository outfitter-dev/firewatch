import {
  CONFIG_SCHEMA_DOC,
  ENTRY_SCHEMA_DOC,
  WORKLIST_SCHEMA_DOC,
} from "@outfitter/firewatch-core/schema";

import type { SchemaName } from "../types";

export function schemaDoc(name: SchemaName | undefined): object {
  switch (name) {
    case "worklist":
      return WORKLIST_SCHEMA_DOC;
    case "config":
      return CONFIG_SCHEMA_DOC;
    case "query":
    case "entry":
    case undefined:
      // "query" returns entry schema — queries produce entries
      return ENTRY_SCHEMA_DOC;
  }
}

export function buildHelpText(writeToolsAvailable: boolean): string {
  const baseText = `Firewatch MCP Tools

fw_query - Query cached PR activity
  Filter by: since, type, pr, author, state, label
  Options: summary=true (per-PR aggregation), summary_short=true (compact)
  Example: {"since":"24h","type":"review","summary":true}

fw_status - Cache and auth status
  Options: short=true (compact output)

fw_doctor - Diagnose and fix issues
  Options: fix=true (auto-repair)

fw_help - Usage documentation
  schema: "query" | "entry" | "worklist" | "config" - field definitions
  config_key: show config value
  config_path: show config file location`;

  const writeToolsText = `

fw_pr - PR mutations
  action="edit" - Update title, body, base, draft/ready, milestone, labels, reviewers, assignees
  action="rm" - Remove labels, reviewers, assignees, milestone
  action="review" - Submit review (approve/request-changes/comment)

fw_fb - Unified feedback operations
  PR-level:
    {pr} - List needs-attention feedback
    {pr, all} - List all including resolved/acked
    {pr, body} - Add comment to PR
    {pr, ack} - Bulk ack all
  Comment-level:
    {id} - View comment
    {id, body} - Reply
    {id, resolve} - Resolve thread (or ack issue_comment)
    {id, ack} - Acknowledge with thumbs-up`;

  const lockedText = `

Note: Write tools (fw_pr, fw_fb) require authentication.
Use fw_doctor to check auth status.`;

  return writeToolsAvailable
    ? baseText + writeToolsText
    : baseText + lockedText;
}
