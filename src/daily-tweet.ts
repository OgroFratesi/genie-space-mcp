import Anthropic from "@anthropic-ai/sdk";
import { queryGeneralStats, queryMatchEvents, queryPassEvents } from "./genie";
import {
  saveTweetDraft,
  saveDraftQuestion,
  getReadyQuestions,
  updateQuestionStatus,
  getScheduledTweets,
  updateTweetStatus,
  saveFlashbackQuestion,
  saveFlashbackTweetDraft,
  getReadyFlashbackQuestions,
  updateFlashbackQuestionStatus,
} from "./notion";
import { postTweet } from "./twitter";
import tweetSamples from "../data/tweet-samples.json";
import {
  AVAILABLE_METRICS,
  AVOID_METRICS,
  QUESTION_GUIDES,
  QUESTION_SEEDS,
  SEASON_SCOPE_DEFINITIONS,
  HISTORICAL_SEASONS_FOR_SAMPLE,
  type SeasonScopeId,
} from "./draft-question-helper";
import {
  FLASHBACK_QUESTION_GUIDES,
  FLASHBACK_QUESTION_SEEDS,
  pickFlashbackSeasonScope,
  type FlashbackSeasonScopeId,
} from "./flashback-question-helper";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const DEFAULT_TWEET_MODEL = "claude-sonnet-4-6";

// ── League selection ──────────────────────────────────────────────────────────

const LEAGUE_WEIGHTS = [
  { league: "premier_league", weight: 50 },
  { league: "all",            weight: 20 },
  { league: "la_liga",        weight: 10 },
  { league: "bundesliga",     weight: 10 },
  { league: "serie_a",        weight: 10 },
];

function pickLeague(): string {
  const total = LEAGUE_WEIGHTS.reduce((s, l) => s + l.weight, 0);
  let r = Math.random() * total;
  for (const l of LEAGUE_WEIGHTS) {
    r -= l.weight;
    if (r <= 0) return l.league;
  }
  return LEAGUE_WEIGHTS[0].league;
}

export function getSamplesForLeague(league: string): typeof tweetSamples {
  if (league === "all") return tweetSamples;
  return tweetSamples.filter((s) => s.league === league || s.league === "all");
}

function pickUniqueRandom<T>(arr: T[], count: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

function pickWeighted<T extends { weight: number }>(items: readonly T[]): T {
  const total = items.reduce((s, x) => s + x.weight, 0);
  let r = Math.random() * total;
  for (const x of items) {
    r -= x.weight;
    if (r <= 0) return x;
  }
  return items[items.length - 1]!;
}

const LEAGUE_GENIE_MAP: Record<string, string> = {
  premier_league: "england-premier-league",
  la_liga: "spain-laliga",
  bundesliga: "germany-bundesliga",
  serie_a: "italy-serie-a",
};

function leagueHumanLabel(league: string): string {
  return league === "all"
    ? "cross-league comparison (England Premier League, Spain La Liga, Germany Bundesliga, Italy Serie A)"
    : league.replace(/_/g, " ");
}

function genieLeaguePromptFragment(league: string): string {
  if (league === "all") {
    return `Genie league identifiers: use explicit cross-league comparison across england-premier-league, spain-laliga, germany-bundesliga, and italy-serie-a where relevant. Do not mix other leagues unless the user scope requires it.`;
  }
  const slug = LEAGUE_GENIE_MAP[league] ?? league;
  return `Genie league identifier: use "${slug}" for all league-scoped references (country-prefixed slug form).`;
}

function resolveSeasonScopeForPrompt(): { id: SeasonScopeId; instruction: string } {
  const def = pickWeighted(SEASON_SCOPE_DEFINITIONS);
  if (def.needsConcreteSeason) {
    const seasons = HISTORICAL_SEASONS_FOR_SAMPLE;
    const season = seasons[Math.floor(Math.random() * seasons.length)]!;
    return { id: def.id, instruction: def.instruction.split("{{SEASON}}").join(season) };
  }
  return { id: def.id, instruction: def.instruction };
}

interface QuestionRebuildScenario {
  league: string;
  seedQuestion: string;
  seasonId: SeasonScopeId;
  seasonInstruction: string;
}

function buildQuestionScenarios(count: number): QuestionRebuildScenario[] {
  const out: QuestionRebuildScenario[] = [];
  for (let i = 0; i < count; i++) {
    const league = pickLeague();
    const seedQuestion = QUESTION_SEEDS[Math.floor(Math.random() * QUESTION_SEEDS.length)]!;
    const { id, instruction } = resolveSeasonScopeForPrompt();
    out.push({ league, seedQuestion, seasonId: id, seasonInstruction: instruction });
  }
  return out;
}

interface FlashbackQuestionRebuildScenario {
  league: string;
  seedQuestion: string;
  seasonId: FlashbackSeasonScopeId;
  seasonInstruction: string;
}

function buildFlashbackQuestionScenarios(count: number): FlashbackQuestionRebuildScenario[] {
  const out: FlashbackQuestionRebuildScenario[] = [];
  for (let i = 0; i < count; i++) {
    const league = pickLeague();
    const seedQuestion = FLASHBACK_QUESTION_SEEDS[Math.floor(Math.random() * FLASHBACK_QUESTION_SEEDS.length)]!;
    const { id, instruction } = pickFlashbackSeasonScope();
    out.push({ league, seedQuestion, seasonId: id, seasonInstruction: instruction });
  }
  return out;
}

// ── Question generation ───────────────────────────────────────────────────────

interface TopicSelection {
  topic: string;
  genieQuestion: string;
}

async function generateQuestions(
  scenarios: QuestionRebuildScenario[],
): Promise<{ questions: TopicSelection[]; inputTokens: number; outputTokens: number }> {
  const count = scenarios.length;
  const scenarioBlocks = scenarios
    .map((s, idx) => {
      const leagueLabel = leagueHumanLabel(s.league);
      const slugHint = genieLeaguePromptFragment(s.league);
      return `Scenario ${idx + 1}:
- League key: ${s.league}
- League focus (human): ${leagueLabel}
- ${slugHint}
- Seed question (preserve analytical intent — metric family, filters, comparison shape; do NOT copy wording verbatim):
${s.seedQuestion}
- ${s.seasonInstruction}`;
    })
    .join("\n\n");

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    messages: [{
      role: "user",
      content: `You are a football data analyst. REBUILD each seed question into a new, specific natural-language question for Genie (Databricks), using ONLY the assigned league and season scope for that scenario.

For EVERY scenario:
- Preserve the seed's analytical intent (what is measured, ranked, or compared).
- Rewrite in fresh wording; do not paste the seed.
- The genieQuestion MUST satisfy the season scope lines for that scenario exactly (correct season labels and window).
- The genieQuestion MUST satisfy the league lines: if league key is "all", compare across the four leagues given; otherwise use only that scenario's Genie slug.
- Prefer concrete asks: top N lists, thresholds (e.g. minutes played), and supporting context when the seed implies it.


When generating question for current season, remember that current season is 2025/2026, so "this season" or "current season" should refer to that. For historical questions, you can specify any season from 2010/2011 up to 2025/2026

When considering per 90 minutes stats, remember to filter by players with at least 1200 minutes played in the season

When considering accuracy metrics, consider the total number of attempts and the number of successful attempts. Low number of attempts could be misleading.

When requesting games against top 4 of the table, consider adding a filter for GW over 10 to ensure enough data points

Try to collect information from all angles of the question. Not only provide the top 1 results but top 10. Look for extra metadata information, like game dates, seasons, etc.


${scenarioBlocks}

Respond ONLY as valid JSON with no additional text — an array of exactly ${count} objects in the SAME ORDER as scenarios (first object = Scenario 1, etc.):
[
  {
    "topic": "<short topic description, 5-10 words>",
    "genieQuestion": "<detailed natural language question for Genie, 2-4 sentences; explicit slug(s) and season per scope>"
  }
]`,
    }],
  });

  const text = (response.content[0] as any).text as string;
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error(`generateQuestions: Claude did not return valid JSON. Response: ${text}`);
  const questions = JSON.parse(match[0]) as TopicSelection[];
  if (!Array.isArray(questions) || questions.length !== count) {
    throw new Error(
      `generateQuestions: expected ${count} questions, got ${Array.isArray(questions) ? questions.length : typeof questions}`,
    );
  }
  return {
    questions,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

// ── Data collection (agent loop) ─────────────────────────────────────────────

export const GENIE_TOOLS: Anthropic.Tool[] = [
  {
    name: "query_general_stats",
    description: `Query player statistics, team statistics, standings, and season-level aggregations from Databricks.

Use this tool for:
- Player stats: goals, assists, shots, minutes played, position, rankings, leaderboards
- Team stats: standings, season totals, aggregated attacking/defensive metrics
- Cross-entity queries joining players and teams (e.g. "top 5 players with more shots for teams with fewer than 10 goals")
- Defensive / conceded metrics: goals conceded, shots conceded, corners conceded
- Season-level aggregations NOT tied to a specific match event
- Big chances created, big chances missed

Do NOT use this for questions about shot timing, game-state (winning/drawing/losing), goals in specific match minutes,
or shot build-up sequences — use query_match_events for those.`,
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
    name: "query_match_events",
    description: `Query shot and goal event data with timing and game-state context from Databricks.

Use this tool when the question involves:
- Goals or shots in a specific time range ("last 10 minutes", "after minute 80", "first half")
- Score-state context ("while losing", "while drawing", "when 1-0 down", "while winning")
- Shot build-up analysis (corners, free kicks, crosses, interceptions leading to a shot)
- Shot location or body part (inside the box, headers, right foot, etc.)
- Any per-shot minute-level analysis or "when in the match" questions

This is the ONLY space with per-shot event data — always use it when timing or game-state is part of the question.`,
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
    description: `Query detailed pass event data from Databricks (one row per pass event).

Use this tool when the question involves:
- Pass accuracy rates (overall, by player, team, zone, or game state)
- Pass types: regular passes, crosses, throw-ins
- Passes into the danger zone or attacking third
- Pass origin or destination zones (defensive / middle / attacking third)
- Long balls or through balls
- Game-state passing patterns ("while losing", "while drawing", "while winning")
- Player or team passing profiles filtered by league, season, or position

Do NOT use this for shot events, goals, or general season stats.`,
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
- Understand the real analytical intent behind the user’s question
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
- If the user says “current season,” interpret that as 2025/2026
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
- If the user asks something ambiguous like “who was the best” or “how good was he,” convert it into measurable criteria and request the key metrics behind the answer
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
“Who has the most goals in the current Premier League season?”

Better Genie question:
“In england-premier-league 2025/2026, identify the player with the most goals so far. Return the top scorers ranking with exact goal totals and team names. Focus only on the current season.”

Example:
User question:
“How good was Bellingham this season?”

Better Genie question:
“In spain-laliga 2025/2026, summarize Jude Bellingham’s performance this season using his key attacking and overall contribution metrics. Return the main numbers that best describe his season. Focus only on the current season and do not compare against previous seasons unless needed by the question.”`,
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
      // On the last iteration remove tools to force a text answer
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
            case "query_match_events": result = await queryMatchEvents(input.question, convId); break;
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
  topic: string;
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
- Max 280 characters
- Prefer 2–6 short lines
- Use line breaks to improve readability
- Emojis are allowed sparingly if they improve the post
- Hashtags only if clearly natural; usually avoid them
- Capitalization for emphasis is allowed sparingly
- Do not add calls to action

Writing rules:
- If there is a record, lead with the record
- If there is a comparison, lead with the comparison
- If there is a ranking, lead with the ranking
- If there is a weird or rare stat, lead with the weird stat
- Do not try to include every stat available
- Cut anything that feels like filler
- End on a sharp contextual note, milestone, or implication

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

Topic: ${params.topic}
League: ${leagueLabel}

Data retrieved from the database:
${params.genieData}

The tweet must be factual and grounded in the data above.

Also write a data summary of the key insight (for internal reference, not published).

Respond ONLY as valid JSON with no additional text:
{
  "tweetDraft": "<tweet text, max 280 chars>",
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
    topic: params.topic,
    league: leagueLabel,
    tweetDraft,
    dataSummary,
    tokenUsage,
  });

  return { tweetDraft, dataSummary, notionUrl };
}

// ── Pipeline 1: Question generation ──────────────────────────────────────────

export async function runQuestionGenerationPipeline(count = 3): Promise<string> {
  console.log("[generate-questions] Starting pipeline...");

  const scenarios = buildQuestionScenarios(count);
  scenarios.forEach((s, i) => {
    const seedShort = s.seedQuestion.length > 90 ? `${s.seedQuestion.slice(0, 90)}…` : s.seedQuestion;
    console.log(
      `[generate-questions] Scenario ${i + 1}: league=${s.league} season=${s.seasonId} seed=${JSON.stringify(seedShort)}`,
    );
  });

  console.log(`[generate-questions] Generating ${count} questions...`);
  const { questions, inputTokens: qIn, outputTokens: qOut } = await generateQuestions(scenarios);
  console.log(`[generate-questions] Got ${questions.length} questions from Claude`);
  console.log(`[generate-questions] tokens: in=${qIn} out=${qOut}`);

  const tokenUsage = `questions_in=${qIn.toLocaleString()} | questions_out=${qOut.toLocaleString()}`;
  const urls: string[] = [];
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]!;
    const league = scenarios[i]!.league;
    const url = await saveDraftQuestion({
      topic: q.topic,
      question: q.genieQuestion,
      league,
      tokenUsage,
    });
    urls.push(url);
    console.log(`[generate-questions] Saved: "${q.topic}" (league=${league})`);
  }

  const leagueSummary = [...new Set(scenarios.map((s) => s.league))].join(", ");
  return `Saved ${urls.length} draft questions to Notion (leagues: ${leagueSummary}).\n${urls.join("\n")}`;
}

// ── Pipeline 2: Tweet drafting from Ready questions ───────────────────────────

export async function runTweetDraftPipeline(): Promise<string> {
  console.log("[draft-tweets] Starting pipeline...");

  const readyQuestions = await getReadyQuestions();
  if (!readyQuestions.length) {
    console.log("[draft-tweets] No Ready questions found.");
    return "No questions with status Ready found in Draft Questions database.";
  }

  console.log(`[draft-tweets] Found ${readyQuestions.length} Ready question(s)`);
  const results: string[] = [];

  for (let i = 0; i < readyQuestions.length; i++) {
    if (i > 0) {
      console.log("[draft-tweets] Waiting 60s before next question...");
      await new Promise((resolve) => setTimeout(resolve, 60_000));
    }
    const q = readyQuestions[i];
    console.log(`[draft-tweets] Processing: "${q.topic}"`);
    await updateQuestionStatus(q.pageId, "Processing");

    try {
      const { summary: genieData, inputTokens: agentIn, outputTokens: agentOut } = await collectDataWithAgent(q.question);
      console.log(`[draft-tweets] Data collected (${genieData.length} chars)`);

      const samples = getSamplesForLeague(q.league);
      const inspirationSamples = pickUniqueRandom(samples, 5);

      const { tweetDraft, notionUrl } = await draftAndSave({
        league: q.league,
        topic: q.topic,
        genieData,
        inspirationSamples,
        agentInputTokens: agentIn,
        agentOutputTokens: agentOut,
      });

      await updateQuestionStatus(q.pageId, "Processed", notionUrl);
      results.push(`✓ "${q.topic}" → ${notionUrl}\n  ${tweetDraft}`);
      console.log(`[draft-tweets] Done: "${q.topic}"`);
    } catch (err: any) {
      await updateQuestionStatus(q.pageId, "Failed");
      results.push(`✗ "${q.topic}" — Error: ${err.message}`);
      console.error(`[draft-tweets] Failed: "${q.topic}"`, err.message);
    }
  }

  return results.join("\n\n");
}

// ── Flashback: Question generation ───────────────────────────────────────────

async function generateFlashbackQuestions(
  scenarios: FlashbackQuestionRebuildScenario[],
): Promise<{ questions: TopicSelection[]; inputTokens: number; outputTokens: number }> {
  const count = scenarios.length;
  const scenarioBlocks = scenarios
    .map((s, idx) => {
      const leagueLabel = leagueHumanLabel(s.league);
      const slugHint = genieLeaguePromptFragment(s.league);
      return `Scenario ${idx + 1}:
- League key: ${s.league}
- League focus (human): ${leagueLabel}
- ${slugHint}
- Seed question (preserve nostalgic / historical analytical intent — record type, era, comparison shape; do NOT copy wording verbatim):
${s.seedQuestion}
- ${s.seasonInstruction}`;
    })
    .join("\n\n");

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    messages: [{
      role: "user",
      content: `You are a football data analyst. REBUILD each seed into a new, specific natural-language question for Genie (Databricks) — historically nostalgic "flashback" content only.

For EVERY scenario:
- Preserve the seed's analytical intent (records, era comparisons, team/player historical angles).
- Rewrite in fresh wording; do not paste the seed.
- Flashback only: never use 2025/2026 or "current season" as the primary answer window. Historical seasons through 2016/2017 (or the span explicitly given in the season scope lines) only.
- The genieQuestion MUST satisfy the season scope lines for that scenario exactly.
- The genieQuestion MUST satisfy the league lines: if league key is "all", compare across the four leagues given; otherwise use only that scenario's Genie slug.

${scenarioBlocks}

Respond ONLY as valid JSON with no additional text — an array of exactly ${count} objects in the SAME ORDER as scenarios (first object = Scenario 1, etc.):
[
  {
    "topic": "<short topic description, 5-10 words>",
    "genieQuestion": "<detailed natural language question for Genie, 2-4 sentences; explicit slug(s) and historical season(s) per scope>"
  }
]`,
    }],
  });

  const text = (response.content[0] as any).text as string;
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error(`generateFlashbackQuestions: Claude did not return valid JSON. Response: ${text}`);
  const questions = JSON.parse(match[0]) as TopicSelection[];
  if (!Array.isArray(questions) || questions.length !== count) {
    throw new Error(
      `generateFlashbackQuestions: expected ${count} questions, got ${Array.isArray(questions) ? questions.length : typeof questions}`,
    );
  }
  return {
    questions,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

// ── Flashback: Tweet drafting ─────────────────────────────────────────────────

async function draftAndSaveFlashback(params: {
  league: string;
  topic: string;
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
      content: `You are writing football stats tweets for X — specifically "flashback" posts that celebrate historical moments and past-era statistics.

Write like a sharp football-data account posting nostalgic content, not like a match reporter and not like a generic AI summary tool.

Before writing, identify the strongest nostalgic angle from the data. Choose only one:
- all-time record (still unbroken)
- iconic season milestone
- legendary player era-defining stat
- historical comparison across eras
- forgotten or surprising piece of history
- streak or run from the past
- historical outlier

Then write the tweet around that angle only.

Core style:
- Lead with a nostalgic hook: "Back in [season]...", "[Season] flashback:", "Forgotten stat:", or "Still unmatched:"
- Sound native to football Twitter/X
- Be concise, punchy, and stat-led
- Prioritize one strong historical takeaway over a complete recap
- The tweet should feel like a genuine "did you know?" for football fans who lived through those eras

What to optimize for:
- Strong nostalgic hook in the first line
- Clear statistical framing with season or era reference
- A tweetable angle: record, historical milestone, era comparison, or forgotten fact
- High information density
- Natural football-stat-account phrasing with a nostalgic flavour

Avoid:
- Generic recap phrasing like "had a standout performance", "dominated the league"
- Overexplaining obvious context
- Sounding like a Wikipedia article or autogenerated history summary
- Mentioning current season (2025/26) unless directly comparing past to present
- Forced neutrality or robotic wording
- Restating as a percentage what the raw numbers already show

Formatting:
- Max 280 characters
- Prefer 2–6 short lines
- Use line breaks to improve readability
- Emojis allowed sparingly if they improve the post
- Hashtags only if clearly natural; usually avoid them
- Capitalization for emphasis is allowed sparingly
- Do not add calls to action

Writing rules:
- If there is an all-time record, lead with the record
- If there is an iconic player season, lead with the player and season
- If there is a forgotten stat, lead with the surprise
- Cut anything that feels like filler
- End on a sharp contextual note or implication

Tone:
- Nostalgic but factual, not sentimental
- Punchy, not cringeworthy
- Confident, not exaggerated
- More "this number from history is remarkable" than "let me walk you through the full story"

When given raw historical stats, first identify the best nostalgic tweet angle, then write the tweet around that angle only.

---

Style examples — match this voice:
${samplesText}

---

Topic: ${params.topic}
League: ${leagueLabel}

Data retrieved from the database:
${params.genieData}

The tweet must be factual and grounded in the data above.

Also write a data summary of the key historical insight (for internal reference, not published).

Respond ONLY as valid JSON with no additional text:
{
  "tweetDraft": "<tweet text, max 280 chars>",
  "dataSummary": "<data summary>"
}`,
    }],
  });

  const draftIn = response.usage.input_tokens;
  const draftOut = response.usage.output_tokens;
  console.log(`[flashback-draft] tokens: in=${draftIn} out=${draftOut}`);
  const text = (response.content[0] as any).text as string;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`draftAndSaveFlashback: Claude did not return valid JSON. Response: ${text}`);
  const { tweetDraft, dataSummary } = JSON.parse(match[0]);

  const agentIn = params.agentInputTokens ?? 0;
  const agentOut = params.agentOutputTokens ?? 0;
  const totalIn = agentIn + draftIn;
  const totalOut = agentOut + draftOut;
  const tokenUsage = `agent_in=${agentIn.toLocaleString()} agent_out=${agentOut.toLocaleString()} | draft_in=${draftIn.toLocaleString()} draft_out=${draftOut.toLocaleString()} | total_in=${totalIn.toLocaleString()} total_out=${totalOut.toLocaleString()}`;

  const notionUrl = await saveFlashbackTweetDraft({
    topic: params.topic,
    league: leagueLabel,
    tweetDraft,
    dataSummary,
    tokenUsage,
  });

  return { tweetDraft, dataSummary, notionUrl };
}

// ── Flashback Pipeline 1: Question generation ─────────────────────────────────

export async function runFlashbackQuestionGenerationPipeline(count = 3): Promise<string> {
  console.log("[flashback-questions] Starting pipeline...");

  const scenarios = buildFlashbackQuestionScenarios(count);
  scenarios.forEach((s, i) => {
    const seedShort = s.seedQuestion.length > 90 ? `${s.seedQuestion.slice(0, 90)}…` : s.seedQuestion;
    console.log(
      `[flashback-questions] Scenario ${i + 1}: league=${s.league} season=${s.seasonId} seed=${JSON.stringify(seedShort)}`,
    );
  });

  console.log(`[flashback-questions] Generating ${count} questions...`);
  const { questions, inputTokens: qIn, outputTokens: qOut } = await generateFlashbackQuestions(scenarios);
  console.log(`[flashback-questions] Got ${questions.length} questions from Claude`);
  console.log(`[flashback-questions] tokens: in=${qIn} out=${qOut}`);

  const tokenUsage = `questions_in=${qIn.toLocaleString()} | questions_out=${qOut.toLocaleString()}`;
  const urls: string[] = [];
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]!;
    const league = scenarios[i]!.league;
    const url = await saveFlashbackQuestion({
      topic: q.topic,
      question: q.genieQuestion,
      league,
      tokenUsage,
    });
    urls.push(url);
    console.log(`[flashback-questions] Saved: "${q.topic}" (league=${league})`);
  }

  const leagueSummary = [...new Set(scenarios.map((s) => s.league))].join(", ");
  return `Saved ${urls.length} flashback draft questions to Notion (leagues: ${leagueSummary}).\n${urls.join("\n")}`;
}

// ── Flashback Pipeline 2: Tweet drafting from Ready flashback questions ────────

export async function runFlashbackTweetDraftPipeline(): Promise<string> {
  console.log("[flashback-tweets] Starting pipeline...");

  const readyQuestions = await getReadyFlashbackQuestions();
  if (!readyQuestions.length) {
    console.log("[flashback-tweets] No Ready questions found.");
    return "No flashback questions with status Ready found in Flashback Questions database.";
  }

  console.log(`[flashback-tweets] Found ${readyQuestions.length} Ready question(s)`);
  const results: string[] = [];

  for (let i = 0; i < readyQuestions.length; i++) {
    if (i > 0) {
      console.log("[flashback-tweets] Waiting 60s before next question...");
      await new Promise((resolve) => setTimeout(resolve, 60_000));
    }
    const q = readyQuestions[i];
    console.log(`[flashback-tweets] Processing: "${q.topic}"`);
    await updateFlashbackQuestionStatus(q.pageId, "Processing");

    try {
      const { summary: genieData, inputTokens: agentIn, outputTokens: agentOut } = await collectDataWithAgent(q.question);
      console.log(`[flashback-tweets] Data collected (${genieData.length} chars)`);

      const samples = getSamplesForLeague(q.league);
      const inspirationSamples = pickUniqueRandom(samples, 5);

      const { tweetDraft, notionUrl } = await draftAndSaveFlashback({
        league: q.league,
        topic: q.topic,
        genieData,
        inspirationSamples,
        agentInputTokens: agentIn,
        agentOutputTokens: agentOut,
      });

      await updateFlashbackQuestionStatus(q.pageId, "Processed", notionUrl);
      results.push(`✓ "${q.topic}" → ${notionUrl}\n  ${tweetDraft}`);
      console.log(`[flashback-tweets] Done: "${q.topic}"`);
    } catch (err: any) {
      await updateFlashbackQuestionStatus(q.pageId, "Failed");
      results.push(`✗ "${q.topic}" — Error: ${err.message}`);
      console.error(`[flashback-tweets] Failed: "${q.topic}"`, err.message);
    }
  }

  return results.join("\n\n");
}

// ── Pipeline 3: Post scheduled tweets from Tweet Content DB ───────────────────

export async function runScheduledTweetPostingPipeline(): Promise<string> {
  console.log("[post-scheduled-tweets] Starting pipeline...");

  const scheduled = await getScheduledTweets();
  if (!scheduled.length) {
    console.log("[post-scheduled-tweets] No scheduled tweets found.");
    return "No scheduled tweets to post.";
  }

  console.log(`[post-scheduled-tweets] Found ${scheduled.length} scheduled tweet(s)`);
  const results: string[] = [];

  for (const tweet of scheduled) {
    console.log(`[post-scheduled-tweets] Posting: "${tweet.topic}"`);
    try {
      const tweetUrl = await postTweet(tweet.content);
      await updateTweetStatus(tweet.pageId, "Posted", tweetUrl);
      results.push(`✓ "${tweet.topic}" → ${tweetUrl}`);
      console.log(`[post-scheduled-tweets] Posted: "${tweet.topic}"`);
    } catch (err: any) {
      await updateTweetStatus(tweet.pageId, "Failed");
      results.push(`✗ "${tweet.topic}" — Error: ${err.message}`);
      console.error(`[post-scheduled-tweets] Failed: "${tweet.topic}"`, err.message);
    }
  }

  return results.join("\n");
}
