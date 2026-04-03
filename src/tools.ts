import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { queryPlayerStats, queryMatchEvents } from "./genie";

export function registerTools(server: McpServer): void {
  server.tool(
    "query_player_stats",
    `Query player and team season-level statistics from Databricks.
Use this tool for questions about: player rankings and leaderboards, team performance metrics,
season aggregates (goals, assists, xG, passes, defensive stats), player comparisons,
and benchmarking across leagues or teams — when no shot-event timing or game-state context is needed.
Do NOT use this for questions about "last N minutes", "while winning/losing/drawing", shot build-up,
or anything requiring per-event minute-level detail.`,
    {
      question: z.string().describe("The natural language question to ask Genie"),
    },
    async ({ question }) => {
      try {
        const result = await queryPlayerStats(question);
        return { content: [{ type: "text", text: result }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
      }
    }
  );

  server.tool(
    "query_match_events",
    `Query shot and goal event data with timing and game-state context from Databricks.
Use this tool when the question involves: goals or shots in a specific time range (e.g. "last 10 minutes",
"after minute 80", "first half"), score-state context ("while losing", "while drawing", "when 1-0 down"),
shot build-up analysis (corners, free kicks, crosses, interceptions), shot location or body part,
player minutes split by winning/drawing/losing, or any per-shot minute-level analysis.
This is the ONLY space with per-shot event data — always use it when timing or game-state is part of the question.`,
    {
      question: z.string().describe("The natural language question to ask Genie"),
    },
    async ({ question }) => {
      try {
        const result = await queryMatchEvents(question);
        return { content: [{ type: "text", text: result }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
      }
    }
  );
}
