import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  detectAuth,
  loadConfig,
  type AuthInfo,
} from "@outfitter/firewatch-core";

import { version as mcpVersion } from "../package.json";
import { handleConfig } from "./handlers/config";
import { handleFeedback } from "./handlers/feedback";
import { buildHelpText, schemaDoc } from "./handlers/help";
import { handleAdd, handleEdit, handleRm } from "./handlers/mutations";
import { handleQuery } from "./handlers/query";
import { handleDoctor, handleStatus } from "./handlers/status";
import {
  type DoctorParams,
  DoctorParamsShape,
  type FeedbackParams,
  FeedbackParamsShape,
  type HelpParams,
  HelpParamsShape,
  type PrParams,
  PrParamsShape,
  type QueryParams,
  QueryParamsShape,
  type StatusParams,
  StatusParamsShape,
  TOOL_DESCRIPTIONS,
} from "./schemas";
import type { McpToolResult } from "./types";
import { textResult } from "./utils/formatting";
import { hasEditFields } from "./utils/parsing";

/**
 * FirewatchMCPServer wraps McpServer to provide auth-gated dynamic tool registration.
 *
 * Base tools (fw_query, fw_status, fw_doctor, fw_help) are always available.
 * Write tools (fw_pr, fw_fb) require authentication and are
 * dynamically registered after auth verification.
 */
export class FirewatchMCPServer {
  readonly server: McpServer;
  private _isAuthenticated = false;
  private _writeToolsRegistered = false;
  private _authInfo: AuthInfo | null = null;

  constructor() {
    this.server = new McpServer(
      { name: "firewatch", version: mcpVersion },
      {
        instructions:
          "Query GitHub PR activity including reviews, comments, commits, and CI status. Use when checking PR status, finding review comments, querying activity, resolving feedback, or working with GitHub pull requests. Outputs JSONL for jq composition.",
      }
    );

    this.registerBaseTools();
  }

  /**
   * Check if write tools are available (auth verified).
   */
  get writeToolsAvailable(): boolean {
    return this._writeToolsRegistered;
  }

  /**
   * Verify authentication and enable write tools if authenticated.
   * Safe to call multiple times - will only register tools once.
   * Sends list_changed notification when tools are newly registered.
   */
  async verifyAuthAndEnableWriteTools(): Promise<{
    authenticated: boolean;
    toolsEnabled: boolean;
    source?: string | undefined;
    error?: string | undefined;
  }> {
    // If already registered, return current state
    if (this._writeToolsRegistered) {
      return {
        authenticated: this._isAuthenticated,
        toolsEnabled: true,
        ...(this._authInfo?.source && { source: this._authInfo.source }),
      };
    }

    // Check auth
    const config = await loadConfig();
    const auth = await detectAuth(config.github_token);

    if (auth.isErr()) {
      return {
        authenticated: false,
        toolsEnabled: false,
        error: auth.error.message,
      };
    }

    // Auth succeeded - register write tools
    this._authInfo = auth.value;
    this._isAuthenticated = true;
    this.registerWriteTools();
    this._writeToolsRegistered = true;

    // Notify client that tool list has changed
    this.server.sendToolListChanged();

    return {
      authenticated: true,
      toolsEnabled: true,
      source: auth.value.source,
    };
  }

  /**
   * Register base tools that are always available (read-only operations).
   */
  private registerBaseTools(): void {
    // fw_query - Query cached PR activity
    this.server.tool(
      "fw_query",
      TOOL_DESCRIPTIONS.query,
      QueryParamsShape,
      (params: QueryParams) => handleQuery(params)
    );

    // fw_status - Show cache and auth status
    this.server.tool(
      "fw_status",
      TOOL_DESCRIPTIONS.status,
      StatusParamsShape,
      this.handleStatusWithRecheck.bind(this)
    );

    // fw_doctor - Diagnose and fix issues
    this.server.tool(
      "fw_doctor",
      TOOL_DESCRIPTIONS.doctor,
      DoctorParamsShape,
      (params: DoctorParams) => handleDoctor(params)
    );

    // fw_help - Usage documentation
    this.server.tool(
      "fw_help",
      TOOL_DESCRIPTIONS.help,
      HelpParamsShape,
      this.handleHelp.bind(this)
    );
  }

  /**
   * Handle help tool requests.
   */
  private async handleHelp(params: HelpParams): Promise<McpToolResult> {
    if (params.schema) {
      return textResult(JSON.stringify(schemaDoc(params.schema), null, 2));
    }
    if (params.config_key || params.config_path) {
      return await handleConfig({
        key: params.config_key,
        path: params.config_path,
      });
    }
    return textResult(buildHelpText(this._writeToolsRegistered));
  }

  /**
   * Handle status tool requests with optional auth recheck.
   * Allows clients to trigger auth re-verification to enable write tools.
   */
  private async handleStatusWithRecheck(
    params: StatusParams
  ): Promise<McpToolResult> {
    // If recheck_auth is requested, verify auth and possibly enable write tools
    if (params.recheck_auth) {
      const authResult = await this.verifyAuthAndEnableWriteTools();
      // Include auth recheck result in status output
      const status = await handleStatus(params);
      // Append auth recheck info to response
      if (status.content[0]?.type === "text") {
        const original = JSON.parse(status.content[0].text);
        const enhanced = {
          ...original,
          auth_recheck: {
            authenticated: authResult.authenticated,
            tools_enabled: authResult.toolsEnabled,
            ...(authResult.source && { source: authResult.source }),
            ...(authResult.error && { error: authResult.error }),
          },
        };
        return textResult(JSON.stringify(enhanced));
      }
      return status;
    }
    return handleStatus(params);
  }

  /**
   * Register write tools that require authentication.
   * Called after auth verification succeeds.
   */
  private registerWriteTools(): void {
    // fw_pr - PR mutations: edit fields, manage metadata, submit reviews
    this.server.tool(
      "fw_pr",
      TOOL_DESCRIPTIONS.pr,
      PrParamsShape,
      (params: PrParams) => {
        if (params.action === "review") {
          // Submit PR review - validate review type is provided
          if (!params.review) {
            throw new Error(
              "action=review requires review type (approve, request-changes, comment)."
            );
          }
          return handleAdd({
            pr: params.pr,
            repo: params.repo,
            review: params.review,
            body: params.body,
          });
        }
        if (params.action === "edit") {
          // Handle metadata additions via edit
          const hasMetadata =
            params.labels || params.label || params.reviewer || params.assignee;
          if (hasMetadata && !hasEditFields(params)) {
            // Pure metadata add
            return handleAdd({
              pr: params.pr,
              repo: params.repo,
              labels: params.labels,
              label: params.label,
              reviewer: params.reviewer,
              assignee: params.assignee,
            });
          }
          return handleEdit(params);
        }
        return handleRm(params);
      }
    );

    // fw_fb - Unified feedback operations (fw fb parity)
    this.server.tool(
      "fw_fb",
      TOOL_DESCRIPTIONS.fb,
      FeedbackParamsShape,
      (params: FeedbackParams) => handleFeedback(params)
    );
  }

  /**
   * Connect to transport and optionally verify auth immediately.
   */
  async connect(
    transport: StdioServerTransport,
    options: { verifyAuthOnConnect?: boolean } = {}
  ): Promise<void> {
    await this.server.connect(transport);

    // Optionally verify auth on connect to enable write tools early
    if (options.verifyAuthOnConnect) {
      await this.verifyAuthAndEnableWriteTools();
    }
  }

  /**
   * Close the server connection.
   */
  async close(): Promise<void> {
    await this.server.close();
  }
}

/**
 * Create a new FirewatchMCPServer instance.
 * For backward compatibility with existing code.
 */
export function createServer(): FirewatchMCPServer {
  return new FirewatchMCPServer();
}

export async function run(): Promise<void> {
  const firewatch = createServer();
  const transport = new StdioServerTransport();

  // Connect to transport and verify auth to enable write tools
  await firewatch.connect(transport, { verifyAuthOnConnect: true });
}
