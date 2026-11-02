/**
 * treeman MCP server. Tools: plan_worktrees.
 *
 * Why the low-level Server instead of McpServer: the high-level
 * helper converts zod schemas to JSON Schema and injects keys
 * not in this tool's defined spec ("$schema" and
 * "additionalProperties"), which breaks exact tool-list/schema
 * parity with the spec. This file serves tools/list with the
 * spec's exact input schema as an explicit literal, and every
 * tools/call is validated by the core, which names the
 * offending path on invalid input.
 *
 * The computation is pure and local: no git, no filesystem,
 * no network, and no configuration — the caller supplies
 * every worktree fact the plan is based on.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { formatPayload, planWorktrees, VERSION } from "./treeman.js";

const TOOLS = [
  {
    name: "plan_worktrees",
    description:
      "Plan parallel-agent git worktrees from caller-supplied worktree facts: the ownership map, each tree's status, and which trees are safe to remove. Returns the plan only; git and the filesystem are never touched.",
    inputSchema: {
      type: "object" as const,
      properties: {
        worktrees: {
          type: "array",
          description: "Worktrees to plan, in the caller's order",
          items: {
            type: "object",
            properties: {
              path: {
                type: "string",
                description: "Worktree path",
              },
              branch: {
                type: "string",
                description: "Branch checked out in the worktree",
              },
              owner: {
                type: "string",
                description: "Agent or person who owns the worktree (optional)",
              },
              dirty: {
                type: "boolean",
                description: "Whether the worktree has uncommitted changes",
              },
              last_activity_days: {
                type: "integer",
                description: "Days since the worktree last changed",
              },
              locked: {
                type: "boolean",
                description: "Whether the worktree is locked",
              },
            },
            required: ["path", "branch", "dirty", "last_activity_days"],
          },
        },
        stale_days: {
          type: "integer",
          description:
            "Inactivity threshold in days; beyond it a worktree is stale",
        },
        main_path: {
          type: "string",
          description:
            "Path of the primary worktree, which is never cleaned up (optional)",
        },
      },
      required: ["worktrees", "stale_days"],
    },
  },
];

function textResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function errorResult(err: unknown) {
  return {
    content: [
      { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
    ],
    isError: true,
  };
}

const server = new Server(
  { name: "treeman", version: VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    let out: unknown;
    if (name === "plan_worktrees") {
      out = planWorktrees(args ?? {});
    } else {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
    return textResult(formatPayload(out));
  } catch (err) {
    if (err instanceof McpError) throw err;
    return errorResult(err);
  }
});

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

void main();
