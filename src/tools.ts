import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { queryGeneralStats, queryMatchEvents } from "./genie";
import { postTweet } from "./twitter";

export function registerTools(server: McpServer): void {
  server.tool(
    "query_general_stats",
    `Query player statistics, team statistics, standings, and season-level aggregations from Databricks.

Use this tool for:
- Player stats: goals, assists, shots, minutes played, position, rankings, leaderboards
- Team stats: standings, season totals, aggregated attacking/defensive metrics
- Cross-entity queries joining players and teams (e.g. "top 5 players with more shots for teams with fewer than 10 goals")
- Defensive / conceded metrics: goals conceded, shots conceded, xG conceded, corners conceded, passes conceded
- Season-level aggregations NOT tied to a specific match event
- Impact features: player single-game performance percentiles vs position peers

Do NOT use this for questions about shot timing, game-state (winning/drawing/losing), goals in specific match minutes,
or shot build-up sequences — use query_match_events for those.

For follow-up questions in the same conversation, pass the conversation_id returned by the previous call.
Each response includes a conversation_id at the bottom — always pass it back on follow-ups so Genie retains context.`,
    {
      question: z.string().describe("The natural language question to ask Genie"),
      conversation_id: z
        .string()
        .optional()
        .describe(
          "The conversation_id from a previous call to this tool. Pass it to continue the conversation with Genie context intact."
        ),
    },
    async ({ question, conversation_id }) => {
      try {
        const result = await queryGeneralStats(question, conversation_id);
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

Use this tool when the question involves:
- Goals or shots in a specific time range ("last 10 minutes", "after minute 80", "first half")
- Score-state context ("while losing", "while drawing", "when 1-0 down", "while winning")
- Shot build-up analysis (corners, free kicks, crosses, interceptions leading to a shot)
- Shot location or body part (inside the box, headers, right foot, etc.)
- Player minutes split by game state (minutes winning/drawing/losing)
- Any per-shot minute-level analysis or "when in the match" questions

This is the ONLY space with per-shot event data — always use it when timing or game-state is part of the question.

For follow-up questions in the same conversation, pass the conversation_id returned by the previous call.
Each response includes a conversation_id at the bottom — always pass it back on follow-ups so Genie retains context.`,
    {
      question: z.string().describe("The natural language question to ask Genie"),
      conversation_id: z
        .string()
        .optional()
        .describe(
          "The conversation_id from a previous call to this tool. Pass it to continue the conversation with Genie context intact."
        ),
    },
    async ({ question, conversation_id }) => {
      try {
        const result = await queryMatchEvents(question, conversation_id);
        return { content: [{ type: "text", text: result }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
      }
    }
  );

  server.tool(
    "post_tweet",
    `Post a tweet to X (Twitter). Optionally attach an image by providing its URL (e.g. a Cloudinary image URL).
Returns the URL of the posted tweet on success.`,
    {
      text: z.string().max(280).describe("The tweet text content (max 280 characters)"),
      image_url: z
        .string()
        .url()
        .optional()
        .describe("Optional URL of an image to attach to the tweet (e.g. a Cloudinary URL)"),
    },
    async ({ text, image_url }) => {
      try {
        const tweetUrl = await postTweet(text, image_url);
        return { content: [{ type: "text", text: `Tweet posted: ${tweetUrl}` }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
      }
    }
  );
}
