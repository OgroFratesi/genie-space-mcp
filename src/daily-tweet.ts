import Anthropic from "@anthropic-ai/sdk";
import { queryGeneralStats, queryMatchEvents, queryPassEvents } from "./genie";
import {
  saveTweetDraft,
  saveDraftQuestion,
  getReadyQuestions,
  updateQuestionStatus,
} from "./notion";
import tweetSamples from "../data/tweet-samples.json";
import { AVAILABLE_METRICS, AVOID_METRICS, QUESTION_GUIDES } from "./draft-question-helper";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

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

function getSamplesForLeague(league: string): typeof tweetSamples {
  if (league === "all") return tweetSamples;
  return tweetSamples.filter((s) => s.league === league || s.league === "all");
}

function pickUniqueRandom<T>(arr: T[], count: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

// ── Question generation ───────────────────────────────────────────────────────

interface TopicSelection {
  topic: string;
  genieQuestion: string;
}

async function generateQuestions(
  league: string,
  count: number,
): Promise<TopicSelection[]> {
  const leagueLabel = league === "all" ? "cross-league comparison (all top leagues)" : league.replace(/_/g, " ");

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    messages: [{
      role: "user",
      content: `You are a football data analyst generating tweet topic ideas.

League focus: ${leagueLabel}

Available data in the database:
${AVAILABLE_METRICS}

Do NOT suggest questions about:
${AVOID_METRICS}

Good question angles to explore:
${QUESTION_GUIDES}

Generate ${count} distinct, specific football data questions suitable for this league focus.
Each question should be answerable using only the available metrics above.
Each should target a different angle (record, milestone, comparison, ranking, streak, outlier, etc.).

Respond ONLY as valid JSON with no additional text — an array of ${count} objects:
[
  {
    "topic": "<short topic description, 5-10 words>",
    "genieQuestion": "<detailed natural language question for Genie, 2-4 sentences>"
  }
]`,
    }],
  });

  const text = (response.content[0] as any).text as string;
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error(`generateQuestions: Claude did not return valid JSON. Response: ${text}`);
  return JSON.parse(match[0]) as TopicSelection[];
}

// ── Data collection (agent loop) ─────────────────────────────────────────────

const GENIE_TOOLS: Anthropic.Tool[] = [
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

async function collectDataWithAgent(question: string): Promise<string> {
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `You are a football data analyst collecting stats to support a tweet.

Your goal: gather all the data needed to answer this question with concrete numbers.

Question: ${question}

Rules:
- Call multiple tools if the question spans different data spaces
- Follow up with a more specific query if the first result is incomplete or unclear
- Use conversation_id from a previous result to follow up within the same space (do NOT pass a conversation_id from one tool to a different tool)

Stop querying once you have enough concrete data to write a factual, stat-led tweet.
Then respond with a concise summary of all collected data (numbers, rankings, comparisons).`,
    },
  ];

  const conversationIds: Record<string, string> = {};
  const MAX_ITERATIONS = 4;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const isLastIteration = i === MAX_ITERATIONS - 1;
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
      // On the last iteration remove tools to force a text answer
      ...(isLastIteration ? {} : { tools: GENIE_TOOLS }),
      messages,
    });

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "end_turn") {
      return response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");
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

interface DraftResult {
  tweetDraft: string;
  dataSummary: string;
  notionUrl: string;
}

async function draftAndSave(params: {
  league: string;
  topic: string;
  genieData: string;
  inspirationSamples: typeof tweetSamples;
}): Promise<DraftResult> {
  const samplesText = params.inspirationSamples.map((s) => `- ${s.text}`).join("\n");
  const leagueLabel = params.league === "all" ? "cross-league" : params.league.replace(/_/g, " ");

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
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

Also write a 2-3 sentence data summary of the key insight (for internal reference, not published).

Respond ONLY as valid JSON with no additional text:
{
  "tweetDraft": "<tweet text, max 280 chars>",
  "dataSummary": "<2-3 sentence summary>"
}`,
    }],
  });

  const text = (response.content[0] as any).text as string;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`draftAndSave: Claude did not return valid JSON. Response: ${text}`);
  const { tweetDraft, dataSummary } = JSON.parse(match[0]);

  const notionUrl = await saveTweetDraft({
    topic: params.topic,
    league: leagueLabel,
    tweetDraft,
    dataSummary,
  });

  return { tweetDraft, dataSummary, notionUrl };
}

// ── Pipeline 1: Question generation ──────────────────────────────────────────

export async function runQuestionGenerationPipeline(count = 3): Promise<string> {
  console.log("[generate-questions] Starting pipeline...");

  const league = pickLeague();
  console.log(`[generate-questions] Selected league: ${league}`);

  console.log(`[generate-questions] Generating ${count} questions...`);
  const questions = await generateQuestions(league, count);
  console.log(`[generate-questions] Got ${questions.length} questions from Claude`);

  const urls: string[] = [];
  for (const q of questions) {
    const url = await saveDraftQuestion({
      topic: q.topic,
      question: q.genieQuestion,
      league,
    });
    urls.push(url);
    console.log(`[generate-questions] Saved: "${q.topic}"`);
  }

  return `Saved ${urls.length} draft questions to Notion (league: ${league}).\n${urls.join("\n")}`;
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

  for (const q of readyQuestions) {
    console.log(`[draft-tweets] Processing: "${q.topic}"`);
    await updateQuestionStatus(q.pageId, "Processing");

    try {
      const genieData = await collectDataWithAgent(q.question);
      console.log(`[draft-tweets] Data collected (${genieData.length} chars)`);

      const samples = getSamplesForLeague(q.league);
      const inspirationSamples = pickUniqueRandom(samples, 5);

      const { tweetDraft, notionUrl } = await draftAndSave({
        league: q.league,
        topic: q.topic,
        genieData,
        inspirationSamples,
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
