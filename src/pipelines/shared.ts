import Anthropic from "@anthropic-ai/sdk";
import { queryGeneralStats, queryMatchEvents, queryPassEvents } from "../genie";
import { saveTweetDraft } from "../notion";
import tweetSamples from "../../data/tweet-samples.json";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const DEFAULT_TWEET_MODEL = "claude-sonnet-4-6";

// ── League selection ──────────────────────────────────────────────────────────

const LEAGUE_WEIGHTS = [
  { league: "premier_league", weight: 50 },
  { league: "all",            weight: 40 },
  { league: "la_liga",        weight: 5 },
  { league: "bundesliga",     weight: 1 },
  { league: "serie_a",        weight: 4 },
];

const FLASHBACK_LEAGUE_WEIGHTS = [
  { league: "premier_league", weight: 70 },
  { league: "all",            weight: 25 },
  { league: "la_liga",        weight: 5 },
  { league: "bundesliga",     weight: 0 },
  { league: "serie_a",        weight: 0 },
];

function pickFromWeights(weights: { league: string; weight: number }[]): string {
  const total = weights.reduce((s, l) => s + l.weight, 0);
  let r = Math.random() * total;
  for (const l of weights) {
    r -= l.weight;
    if (r <= 0) return l.league;
  }
  return weights[0]!.league;
}

export function pickLeague(): string {
  return pickFromWeights(LEAGUE_WEIGHTS);
}

export function pickFlashbackLeague(): string {
  return pickFromWeights(FLASHBACK_LEAGUE_WEIGHTS);
}

export function getSamplesForLeague(league: string): typeof tweetSamples {
  if (league === "all") return tweetSamples;
  return tweetSamples.filter((s) => s.league === league || s.league === "all");
}

export function pickUniqueRandom<T>(arr: T[], count: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

export function pickWeighted<T extends { weight: number }>(items: readonly T[]): T {
  const total = items.reduce((s, x) => s + x.weight, 0);
  let r = Math.random() * total;
  for (const x of items) {
    r -= x.weight;
    if (r <= 0) return x;
  }
  return items[items.length - 1]!;
}

export const LEAGUE_GENIE_MAP: Record<string, string> = {
  premier_league: "england-premier-league",
  la_liga: "spain-laliga",
  bundesliga: "germany-bundesliga",
  serie_a: "italy-serie-a",
};

export function leagueHumanLabel(league: string): string {
  return league === "all"
    ? "cross-league comparison (England Premier League, Spain La Liga, Germany Bundesliga, Italy Serie A)"
    : league.replace(/_/g, " ");
}

export function genieLeaguePromptFragment(league: string): string {
  if (league === "all") {
    return `Genie league identifiers: use explicit cross-league comparison across england-premier-league, spain-laliga, germany-bundesliga, and italy-serie-a where relevant. Do not mix other leagues unless the user scope requires it.`;
  }
  const slug = LEAGUE_GENIE_MAP[league] ?? league;
  return `Genie league identifier: use "${slug}" for all league-scoped references (country-prefixed slug form).`;
}

// ── Data collection (agent loop) ─────────────────────────────────────────────

export const GENIE_TOOLS: Anthropic.Tool[] = [
  {
    name: "query_general_stats",
    description: `Query player statistics, team statistics, standings, and season-level aggregations from Databricks.

Use this tool for:
- Player stats: goals, assists, shots, minutes played, position, rankings, leaderboards, crosses, dribbles, defensive actions, and other individual performance metrics
- Team stats: standings, season totals, aggregated attacking/defensive metrics
- Cross-entity queries joining players and teams (e.g. "top 5 players with more shots for teams with fewer than 10 goals")
- Defensive / conceded metrics: goals conceded, shots conceded, xG conceded, corners conceded, passes conceded
- Season-level aggregations NOT tied to a specific match event

AVOID:
Do NOT use this for questions about shot timing, set-pieces goals or shots, game-state (winning/drawing/losing), goals in specific match minutes,
or shot build-up sequences — use goals_and_shots_events for those.

For follow-up questions in the same conversation, pass the conversation_id returned by the previous call.
Each response includes a conversation_id at the bottom — always pass it back on follow-ups so Genie retains context.`,
    input_schema: {
      type: "object" as const,
      properties: {
        question:        { type: "string", description: "Natural language question for Genie" },
        conversation_id: { type: "string", description: "Pass back the conversation_id from a previous call to this same tool to retain session context for follow-up questions" },
      },
      required: ["question"],
    },
  },
  {
    name: "goals_and_shots_events",
    description: `Query shot and goal event data with timing and game-state context from Databricks. Also for goal or shots origin type.

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
    input_schema: {
      type: "object" as const,
      properties: {
        question:        { type: "string", description: "Natural language question for Genie" },
        conversation_id: { type: "string", description: "Pass back the conversation_id from a previous call to this same tool to retain session context for follow-up questions" },
      },
      required: ["question"],
    },
  },
  {
    name: "query_pass_events",
    description: `Query detailed pass event data from Databricks (passes_long table — one row per pass event). It DONT include shot or goals.

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
    input_schema: {
      type: "object" as const,
      properties: {
        question:        { type: "string", description: "Natural language question for Genie" },
        conversation_id: { type: "string", description: "Pass back the conversation_id from a previous call to this same tool to retain session context for follow-up questions" },
      },
      required: ["question"],
    },
  },
];

export async function collectDataWithAgent(question: string): Promise<{ summary: string; inputTokens: number; outputTokens: number }> {
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `You are a football data analyst whose main job is to translate a user's football question into the best possible natural-language query for Genie.

Your objective:
- Understand the real analytical intent behind the user's question
- Choose the best Genie space based on the tool descriptions
- Rewrite the question into a clearer, richer, more explicit request that Genie can use effectively
- Gather enough concrete data to answer with factual numbers, rankings, and comparisons

User question:
${question}

Context:
- The current season is 2025/2026
- Be explicit with league naming
- Always include the country in the league name when referring to a league
- Use league names in this format:
  - england-premier-league
  - germany-bundesliga
  - italy-serie-a
  - spain-laliga
- If the user asks for a metric in the current season, interpret it as 2025/2026
- If the question is only about the current season, do not compare against previous seasons, historical records, or league-wide context unless the user explicitly asks for that comparison

Available Genie spaces:
- Each Genie tool represents a different data space
- Read the MCP tool descriptions carefully and choose the best-fit space first
- Only use another Genie space if the question truly requires information from a different data domain

Core behavior:
1. Interpret the football question, not just the wording
2. Infer the likely analytical need behind it
3. Rewrite it into a detailed natural-language Genie prompt
4. Prefer solving it in 1 Genie call
5. You may make up to 2 additional Genie calls only if:
   - the first answer is incomplete
   - you need supporting comparison/context
   - the question spans multiple data spaces
6. Stop once you have enough concrete data to answer accurately
7. Return immediately once you have enough correct information to answer the question, or when you reach the limit of 3 Genie calls, whichever happens first
8. If the question cannot be fully answered with the available results, return the best factual partial answer rather than continuing beyond the 3-call limit

How to rewrite for Genie:
- Make vague questions specific
- Expand implicit requests into explicit analytical tasks
- Include relevant entities when available:
  - player
  - team
  - match
  - opponent
  - league
  - season
  - competition
  - gameweek / round
  - metric of interest
  - ranking/comparison target
  - historical or seasonal context
- Be explicit with season references
- If the user says "current season," interpret that as 2025/2026
- Be explicit with league naming, always using the country-prefixed format
- If the user asks only about the current season, keep the query focused on that season only unless they explicitly ask for comparisons
- Ask for supporting stats, not just one headline number
- Prefer ranked outputs, comparisons, and shortlists when useful
- Ask for concrete values and context that can support a stat-led answer
- Do not write SQL
- Do not mention schemas, joins, or tables unless Genie explicitly needs that language
- Write as if speaking to an expert football data assistant in natural language
- ALWAYS INCLUDE AT LEAST LIMIT 30 OF RESULTS WHEN NOT ASKING FOR TOP N RESULTS

Tool-use rules:
- Start with the single best Genie space
- If the first result is partial or ambiguous, follow up with a more specific query in the same space
- Use conversation_id only for follow-up within the same Genie tool
- Never pass a conversation_id from one Genie tool to another
- Only call a second or third Genie tool if the question genuinely requires another data space
- Maximum Genie usage:
  - 1 primary call preferred
  - up to 2 extra calls if necessary
  - total maximum: 3 Genie calls

Decision rules:
- If the user asks about one player, one team, one match, or one comparison, try to solve it in one well-written Genie question
- If the user asks something broad like records, trends, or historical comparison, ask Genie for both the main result and the most relevant supporting context in the same query
- If the user asks something ambiguous like "who was the best" or "how good was he," convert it into measurable criteria and request the key metrics behind the answer
- If the user asks for a metric in the current season, keep the request narrowly focused on 2025/2026 unless they explicitly ask for broader comparison
- Do not keep exploring once you already have enough evidence

Your final response:
- Do not return the rewritten Genie prompt
- Return a concise summary of the collected facts only
- Include:
  - key numbers
  - rankings
  - comparisons
  - relevant context
- Keep it factual, compact, and useful for writing a stat-led tweet or report

Example:
User question:
"Who has the most goals in the current Premier League season?"

Better Genie question:
"In england-premier-league 2025/2026, identify the player with the most goals so far. Return the top scorers ranking with exact goal totals and team names. Focus only on the current season."

Example:
User question:
"How good was Bellingham this season?"

Better Genie question:
"In spain-laliga 2025/2026, summarize Jude Bellingham's performance this season using his key attacking and overall contribution metrics. Return the main numbers that best describe his season. Focus only on the current season and do not compare against previous seasons unless needed by the question."`,
    },
  ];

  const conversationIds: Record<string, string> = {};
  const MAX_ITERATIONS = 3;
  let inputTokens = 0;
  let outputTokens = 0;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const isLastIteration = i === MAX_ITERATIONS - 1;
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4000,
      ...(isLastIteration ? {} : { tools: GENIE_TOOLS }),
      messages,
    });

    messages.push({ role: "assistant", content: response.content });
    inputTokens += response.usage.input_tokens;
    outputTokens += response.usage.output_tokens;

    if (response.stop_reason === "end_turn") {
      const summary = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      return { summary, inputTokens, outputTokens };
    }

    if (response.stop_reason === "tool_use") {
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of response.content) {
        if (block.type !== "tool_use") continue;

        const input = block.input as { question: string; conversation_id?: string };
        const convId = input.conversation_id ?? conversationIds[block.name];

        let result: string;
        try {
          switch (block.name) {
            case "goals_and_shots_events": result = await queryMatchEvents(input.question, convId); break;
            case "query_pass_events":  result = await queryPassEvents(input.question, convId); break;
            default:                   result = await queryGeneralStats(input.question, convId); break;
          }
          const convMatch = result.match(/conversation_id[:\s]+([a-zA-Z0-9_-]+)/i);
          if (convMatch) conversationIds[block.name] = convMatch[1];
        } catch (err: any) {
          result = `Error: ${err.message}`;
        }

        console.log(`[collect-data] tool=${block.name} chars=${result.length}`);
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
      }

      messages.push({ role: "user", content: toolResults });
    }
  }

  throw new Error("collectDataWithAgent: reached max iterations without a final answer");
}

// ── Tweet drafting ────────────────────────────────────────────────────────────

export interface DraftResult {
  tweetDraft: string;
  dataSummary: string;
  notionUrl: string;
}

export async function draftAndSave(params: {
  league: string;
  question: string;
  genieData: string;
  inspirationSamples: typeof tweetSamples;
  agentInputTokens?: number;
  agentOutputTokens?: number;
}): Promise<DraftResult> {
  const samplesText = [...params.inspirationSamples].sort(() => Math.random() - 0.5).slice(0, 10).map((s) => `- ${s.text}`).join("\n");
  const leagueLabel = params.league === "all" ? "cross-league" : params.league.replace(/_/g, " ");

  const response = await anthropic.messages.create({
    model: DEFAULT_TWEET_MODEL,
    max_tokens: 1000,
    messages: [{
      role: "user",
      content: `You are writing football stats tweets for X.

Write like a sharp football-data account, not like a match reporter and not like a generic AI summary tool.

Before writing, identify the strongest angle from the data. Choose only one:
- record
- milestone
- comparison
- ranking
- streak
- outlier
- all-round stat line
- team/context impact

Then write the tweet around that angle only.
Do not mix multiple angles unless they naturally reinforce each other.

Core style:
- Lead with the single most interesting angle, stat, record, comparison, or contextual fact
- Sound native to football Twitter/X
- Be concise, punchy, and stat-led
- Prioritize one strong takeaway over a complete summary
- The tweet should feel like a post built from notes, not a recap article

What to optimize for:
- Strong hook in the first line
- Clear statistical framing
- A tweetable angle: milestone, ranking, comparison, streak, record, outlier, or contextual benchmark
- High information density
- Natural football-stat-account phrasing

Avoid:
- Generic recap phrasing like "had a standout performance", "directly contributed to the win", "in this important match"
- Overexplaining obvious context
- Sounding like a news report or autogenerated match summary
- Using internal metrics unless they are central to the account's identity and easy to understand
- Forced neutrality or robotic wording
- Restating as a percentage what the raw numbers already show (e.g. "100% of team's goals" when the reader can already see he scored both goals in a 2-goal win)
- Appending match type labels as standalone lines ("Top-table clash.", "Derby.", "Relegation battle.") — if match importance is relevant, weave it into a sentence naturally or omit it

Formatting:
- Use line breaks to improve readability
- Emojis are allowed sparingly if they improve the post
- Hashtags for player, team and or league names. Max 3 hashtags per tweet.
- Capitalization for emphasis is allowed sparingly
- Do not add calls to action

Writing rules:
- If there is a record, lead with the record
- If there is a comparison, lead with the comparison, always targeting against current season.
- If there is a ranking, lead with the ranking
- If there is a weird or rare stat, lead with the weird stat
- Do not try to include every stat available
- Cut anything that feels like filler
- End on a sharp contextual note, milestone, or implication
- If it is a top 5 metric, include the top 5 and not just the leader.
- Include the information for the bottom fo the ranking as well if exist. 

Tone:
- Analytical, but not flat
- Punchy, but not cringeworthy
- Confident, but not exaggerated
- More stat-account than scout report
- More "this is the number that matters" than "here is a full explanation"

When given raw stats, first identify the best tweet angle, then write the tweet around that angle only.

---

Style examples — match this voice:
${samplesText}

---

The tweet tries to answer the question: ${params.question}
League: ${leagueLabel}

Data retrieved from the database:
${params.genieData}

The tweet must be factual and grounded in the data above.

Also write a data summary of the key insight (for internal reference, not published).

Respond ONLY as valid JSON with no additional text:
{
  "tweetDraft": "<tweet text>",
  "dataSummary": "<data summary>"
}`,
    }],
  });

  const draftIn = response.usage.input_tokens;
  const draftOut = response.usage.output_tokens;
  console.log(`[draft] tokens: in=${draftIn} out=${draftOut}`);
  const text = (response.content[0] as any).text as string;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`draftAndSave: Claude did not return valid JSON. Response: ${text}`);
  const { tweetDraft, dataSummary } = JSON.parse(match[0]);

  const agentIn = params.agentInputTokens ?? 0;
  const agentOut = params.agentOutputTokens ?? 0;
  const totalIn = agentIn + draftIn;
  const totalOut = agentOut + draftOut;
  const tokenUsage = `agent_in=${agentIn.toLocaleString()} agent_out=${agentOut.toLocaleString()} | draft_in=${draftIn.toLocaleString()} draft_out=${draftOut.toLocaleString()} | total_in=${totalIn.toLocaleString()} total_out=${totalOut.toLocaleString()}`;

  const notionUrl = await saveTweetDraft({
    topic: params.question,
    league: leagueLabel,
    tweetDraft,
    dataSummary,
    tokenUsage,
  });

  return { tweetDraft, dataSummary, notionUrl };
}
