import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { queryGeneralStats, queryMatchEvents, queryPassEvents } from "./genie";
import { postTweet } from "./twitter";
import { triggerScrape, monitorScrape, stopScrapeTasks } from "./ecs";
import { runQuestionGenerationPipeline, runTweetDraftPipeline, runFlashbackQuestionGenerationPipeline, runFlashbackTweetDraftPipeline, runPlotDraftPipeline } from "./pipelines";
import { scatterPipeline } from "./scatter";
import { linePipeline } from "./line";
import { barPipeline } from "./bar";
import { beeswarmPipeline } from "./beeswarm";

export function registerTools(server: McpServer): void {
  server.tool(
    "query_general_stats",
    `Query player statistics, team statistics, standings, and season-level aggregations from Databricks.

Use this tool for:
- Player stats: goals, assists, shots, minutes played, position, rankings, leaderboards, crosses, dribbles, defensive actions, and other individual performance metrics
- Team stats: standings, season totals, aggregated attacking/defensive metrics
- Cross-entity queries joining players and teams (e.g. "top 5 players with more shots for teams with fewer than 10 goals")
- Defensive / conceded metrics: goals conceded, shots conceded, xG conceded, corners conceded, passes conceded
- Season-level aggregations NOT tied to a specific match event
- Impact features: player single-game performance percentiles vs position peers

Do NOT use this for questions about shot timing, game-state (winning/drawing/losing), goals in specific match minutes,
or shot build-up sequences — use goals_and_shots_events for those.

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
    "goals_and_shots_events",
    `Query shot and goal event data with timing and game-state context from Databricks. Also for goal or shots origin type.

Use this tool when the question involves:
- Goals or shots in a specific time range ("last 10 minutes", "after minute 80", "first half")
- Score-state context ("while losing", "while drawing", "when 1-0 down", "while winning")
- Shot build-up analysis (corners, free kicks, crosses, interceptions leading to a shot)
- Shot location or body part (inside the box, headers, right foot, etc.)
- Player minutes split by game state (minutes winning/drawing/losing)
- Any per-shot minute-level analysis or "when in the match" questions

This is the ONLY space with per-shot event data. 
It does not contain general stats, general attempted metrics, only the ones related to shots. For general player or team stats, use query_general_stats instead.

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
    `Query detailed pass event data from Databricks (passes_long table — one row per pass event). It DONT include shot or goals.

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

Do NOT use this for shot events, goals, or general season stats — use goals_and_shots_events or query_general_stats for those.

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
    "Process the next Ready question in the Draft Questions Notion database: queries Genie for data, drafts a tweet, saves it to the Matches DB, and marks the question as Processed. Processes one question per call — if the result says more questions are pending, call this tool again to continue until all are done.",
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
    "generate_flashback_questions",
    "Generate historically nostalgic football flashback questions and save them as Draft in the Flashback Questions Notion database. Questions focus on past seasons (2010/11–2022/23), legendary players, and records from previous eras.",
    {
      count: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .describe("Number of questions to generate (default: 3)"),
    },
    async ({ count }) => {
      try {
        const result = await runFlashbackQuestionGenerationPipeline(count ?? 3);
        return { content: [{ type: "text", text: result }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
      }
    }
  );

  server.tool(
    "draft_ready_flashback_tweets",
    "Process the next Ready question in the Flashback Questions Notion database: queries Genie for historical data, drafts a nostalgic flashback tweet, saves it to the Flashback Tweets DB, and marks the question as Processed. Processes one question per call — if the result says more questions are pending, call this tool again to continue until all are done.",
    {},
    async () => {
      try {
        const result = await runFlashbackTweetDraftPipeline();
        return { content: [{ type: "text", text: result }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
      }
    }
  );

  server.tool(
    "draft_ready_plots",
    "Process the next Ready plot in the Draft Plots Notion database: generates the chart, uploads it to Cloudinary, writes the Image URL back, and marks the row as Processed. Processes one plot per call — if the result says more plots are pending, call this tool again to continue.",
    {},
    async () => {
      try {
        const result = await runPlotDraftPipeline();
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

  server.tool(
    "create_scatter_plot",
    `Generate a scatter plot image from a natural language request, querying Databricks directly, and upload to Google Drive.
Returns a drive_url (publicly accessible raw image) that can be passed to post_tweet as image_url.

The pipeline automatically:
1. Asks Genie to discover the correct table and column names for the requested metrics
2. Runs a direct SQL query to fetch player data
3. Generates a dark-themed scatter plot with average reference lines and player labels
4. Uploads to Google Drive (overwrites previous version with same filename for stable URLs)

Use this when the user wants a visual scatter plot comparing two player metrics (e.g. "interceptions vs key passes for PL midfielders").`,
    {
      request: z
        .string()
        .describe(
          "Natural language description of the scatter plot, e.g. 'interceptions per 90 vs key passes per 90 for Premier League midfielders'"
        ),
      highlight_players: z
        .array(z.string())
        .optional()
        .describe("Player names to highlight in red on the plot"),
      min_minutes: z
        .number()
        .optional()
        .describe("Minimum minutes played filter (default: 900)"),
      season: z
        .string()
        .optional()
        .describe("Season string (default: '2025/2026')"),
      genie_space: z
        .enum(["general", "shots_events", "passes_events"])
        .optional()
        .describe(
          "Which Genie space to query. 'general' (default): player/team stats, standings, season aggregates. 'match_events': per-shot/goal events with timing, game-state, score context. 'passes': pass events — accuracy, zones, progressive passes, crosses."
        ),
    },
    async ({ request, highlight_players, min_minutes, season, genie_space }) => {
      try {
        const result = await scatterPipeline({ request, highlight_players, min_minutes, season, genie_space: genie_space as any });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[scatter] Pipeline error: ${message}`, err instanceof Error ? err.stack : "");
        return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
      }
    }
  );

  server.tool(
    "create_line_chart",
    `Generate a line chart image from any football data. The X-axis, Y-axis, and grouping dimension are all inferred automatically from the request by Genie — no preset structure required.
Returns a Cloudinary URL (drive_url) that can be passed to post_tweet as image_url.

The pipeline automatically:
1. Asks Genie to write and execute the correct SQL for the requested metric
2. Maps the result to x_axis / series (optional) / value columns
3. Generates a dark-themed line chart — one line per series if grouping exists, or a single line if not
4. Uploads to Cloudinary

Use this for any line chart request: trends over game weeks, seasons, months, etc., grouped by team, league, player, or ungrouped.
Examples: "goals conceded by team per game week", "total dribbles per league since 2010", "Arsenal's xG per match this season".`,
    {
      request: z
        .string()
        .describe(
          "Natural language description of what to plot, e.g. 'goals conceded by team in each game week' or 'total dribbles per league since 2010'"
        ),
      season_start: z
        .string()
        .optional()
        .describe("Lower bound for the X-axis range, e.g. '2010/2011' for seasons or '1' for game weeks"),
      season_end: z
        .string()
        .optional()
        .describe("Upper bound for the X-axis range, e.g. '2025/2026' for seasons or '38' for game weeks"),
      show_avg: z
        .boolean()
        .optional()
        .describe("Show a horizontal dashed line for the overall average across all series. Defaults to false."),
      genie_space: z
        .enum(["general", "shots_events", "passes_events"])
        .optional()
        .describe(
          "Which Genie space to query. 'general' (default): player/team stats, standings, season aggregates, goals conceded. 'match_events': per-shot/goal events with timing, game-state, score context, build-up sequences. 'passes': pass events — accuracy, zones, progressive passes, crosses, pass flow."
        ),
    },
    async ({ request, season_start, season_end, show_avg, genie_space }) => {
      try {
        const result = await linePipeline({ request, season_start, season_end, show_avg, genie_space: genie_space as any });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[line] Pipeline error: ${message}`, err instanceof Error ? err.stack : "");
        return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
      }
    }
  );

  server.tool(
    "create_bar_chart",
    `Generate a horizontal bar chart image from any football data and upload to Cloudinary.
Returns a drive_url (publicly accessible) that can be passed to post_tweet as image_url.

The pipeline automatically:
1. Interprets the request to understand what goes on each axis
2. Asks Genie to execute the appropriate SQL query
3. Uses Claude to map the result columns into bar chart data (no rigid column naming required)
4. Generates a dark-themed horizontal bar chart with optional in-bar labels and value annotations
5. Uploads to Cloudinary

Use this for ranked or categorical comparisons:
- "Which player scored the most goals in each PL season since 2010?" (Y: season, X: goals, inside bar: player name)
- "Total goals per team in 2023/24 Premier League" (Y: team, X: goals)
- "Most assists by a midfielder in any single season across Europe's top 5 leagues"

The sort_order controls bar ordering: desc (highest first, default), asc (lowest first), or natural (preserve Genie's order — useful for chronological seasons).`,
    {
      request: z
        .string()
        .describe(
          "Natural language description of the chart, e.g. 'top scorer in each Premier League season since 2010, show player name inside bar'"
        ),
      sort_order: z
        .enum(["desc", "asc", "natural"])
        .optional()
        .describe(
          "Bar sort order: desc = highest value first (default), asc = lowest first, natural = preserve Genie's result order (use for chronological y-axes like seasons)"
        ),
      genie_space: z
        .enum(["general", "shots_events", "passes_events"])
        .optional()
        .describe(
          "Which Genie space to query. 'general' (default): player/team stats, standings, season aggregates. 'shots_events': per-shot/goal events with timing and game-state. 'passes_events': pass events — accuracy, zones, progressive passes."
        ),
    },
    async ({ request, sort_order, genie_space }) => {
      try {
        const result = await barPipeline({ request, sort_order: sort_order as any, genie_space: genie_space as any });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[bar] Pipeline error: ${message}`, err instanceof Error ? err.stack : "");
        return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
      }
    }
  );

  server.tool(
    "create_beeswarm_chart",
    `Generate a multi-metric beeswarm chart for a single player. Each metric appears as its own horizontal strip, stacked vertically in one card. The target player is highlighted in orange; all other players are shown as muted dots. The player's club logo appears in the top-left corner.

Use this when the user wants to see how a player compares to the rest of the player pool across several stats at once.

Choose genie_space based on the metrics requested:
- "general" (default): season aggregate stats — goals, assists, xG, shots, interceptions, aerial duels, passes, minutes, etc.
- "shots_events": per-shot event data — shot location, xG per shot, body part, game state
- "passes_events": per-pass event data — pass length, zone, progressive passes, crosses, key passes

Example request: "Beeswarm for Enzo Fernandez showing shots_on_target, passes_into_final_third, interceptions, aerial_duels_won"`,
    {
      request: z
        .string()
        .describe(
          "Natural language request naming the player and the metrics to show, e.g. 'Beeswarm for Enzo Fernandez showing shots_on_target, interceptions, passes_into_final_third, aerial_duels_won'"
        ),
      min_minutes: z
        .number()
        .optional()
        .describe("Minimum minutes played to include a player in the distribution (default: 50)"),
      season: z
        .string()
        .optional()
        .describe("Season to filter by, e.g. '2025/2026' (default: current season)"),
      genie_space: z
        .enum(["general", "shots_events", "passes_events"])
        .optional()
        .describe(
          "Data source: 'general' for season aggregate stats (default), 'shots_events' for shot event data, 'passes_events' for pass event data"
        ),
    },
    async ({ request, min_minutes = 50, season = "2025/2026", genie_space }) => {
      try {
        const result = await beeswarmPipeline({
          request,
          min_minutes,
          season,
          genie_space: genie_space as any,
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[beeswarm] Pipeline error: ${message}`, err instanceof Error ? err.stack : "");
        return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
      }
    }
  );
}
