import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { queryGeneralStats, queryMatchEvents, queryPassEvents } from "./genie";
import { postTweet } from "./twitter";
import { triggerScrape, monitorScrape, stopScrapeTasks } from "./ecs";
import { runQuestionGenerationPipeline, runTweetDraftPipeline } from "./daily-tweet";

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
    "query_pass_events",
    `Query detailed pass event data from Databricks (passes_long table — one row per pass event).

Use this tool when the question involves:
- Pass accuracy rates (overall, by player, team, zone, or game state)
- Pass types: regular passes, crosses (passCross), throw-ins — note these are mutually exclusive event types
- Progressive passes (forward passes from the middle third into the attacking third)
- Passes into the danger zone (central box area: endX >= 83, endY 30–70)
- Pass origin or destination zones (defensive / middle / attacking third × left / central / right lane)
- Pass flow matrices (where passes go from/to across pitch zones)
- Long balls or through balls
- Game-state passing patterns ("while losing", "while drawing", "while winning")
- Player or team passing profiles filtered by league, season, or position

Do NOT use this for shot events, goals, or general season stats — use query_match_events or query_general_stats for those.

League name mapping: Premier League → england-premier-league, La Liga → spain-laliga, Bundesliga → germany-bundesliga, Serie A → italy-serie-a, Ligue 1 → ligue_1, Champions League → europe-champions-league.
Current season = 2025/2026.

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
        const result = await queryPassEvents(question, conversation_id);
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

  server.tool(
    "generate_draft_questions",
    "Generate football data tweet questions and save them as Draft in the Draft Questions Notion database. Use this when asked to generate tweet ideas or draft questions.",
    {
      count: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .describe("Number of questions to generate (default: 5)"),
    },
    async ({ count }) => {
      try {
        const result = await runQuestionGenerationPipeline(count ?? 3);
        return { content: [{ type: "text", text: result }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
      }
    }
  );

  server.tool(
    "draft_ready_tweets",
    "Process all Ready questions in the Draft Questions Notion database: queries Genie for data, drafts tweets, saves them to the Matches DB, and marks each question as Processed.",
    {},
    async () => {
      try {
        const result = await runTweetDraftPipeline();
        return { content: [{ type: "text", text: result }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
      }
    }
  );

  server.tool(
    "trigger_scrape",
    "Launch one ECS Fargate scrape job per (league, season) pair. Returns task IDs for monitoring. Pass league and season exactly as the user provides them — do not reformat or translate values.",
    {
      tasks: z
        .array(
          z.object({
            league: z.string().describe("League identifier — pass exactly as provided by the user"),
            season: z.string().describe("Season identifier — pass exactly as provided by the user"),
          })
        )
        .describe("List of (league, season) pairs to scrape"),
      extra_env: z
        .record(z.string(), z.string())
        .optional()
        .describe("Optional extra environment variables forwarded to every container"),
    },
    async ({ tasks, extra_env }) => {
      try {
        const results = await triggerScrape(tasks, extra_env);
        const launched = results.filter((r) => r.status === "LAUNCHED").length;
        const lines = results.map((r) =>
          r.status === "LAUNCHED"
            ? `✓ ${r.league} ${r.season} → \`${r.taskId}\``
            : `✗ ${r.league} ${r.season} → FAILED: ${JSON.stringify(r.failures)}`
        );
        return {
          content: [{ type: "text", text: `${launched}/${results.length} tasks launched.\n\n${lines.join("\n")}` }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
      }
    }
  );

  server.tool(
    "monitor_scrape",
    `Check the current status of previously launched ECS scrape tasks.
Pass the full task ARNs returned by trigger_scrape.`,
    {
      task_arns: z
        .array(z.string())
        .describe("Task ARNs to check (from trigger_scrape output)"),
    },
    async ({ task_arns }) => {
      try {
        const statuses = await monitorScrape(task_arns);
        if (!statuses.length) return { content: [{ type: "text", text: "No tasks found." }] };
        const lines = statuses.map(
          (s) => `${s.taskId}  ${s.status.padEnd(12)}  ${s.league} ${s.season}`
        );
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
      }
    }
  );

  server.tool(
    "stop_scrape_tasks",
    "Stop all currently running ECS scrape tasks in the cluster.",
    {
      reason: z
        .string()
        .optional()
        .describe("Reason for stopping (default: 'Manual stop via Claude')"),
    },
    async ({ reason }) => {
      try {
        const stopped = await stopScrapeTasks(reason);
        if (!stopped.length) return { content: [{ type: "text", text: "No running tasks found." }] };
        return {
          content: [
            {
              type: "text",
              text: `Stopped ${stopped.length} task(s):\n${stopped.map((id) => `• ${id}`).join("\n")}`,
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
      }
    }
  );
}
