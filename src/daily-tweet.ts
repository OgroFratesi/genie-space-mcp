import Anthropic from "@anthropic-ai/sdk";
import { queryGeneralStats, queryMatchEvents, queryPassEvents } from "./genie";
import {
  saveTweetDraft,
  saveDraftQuestion,
  getReadyQuestions,
  updateQuestionStatus,
} from "./notion";
import tweetSamples from "../data/tweet-samples.json";
import { AVAILABLE_METRICS, AVOID_METRICS, QUESTION_GUIDES } from "./genie-context";

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
  genieSpace: "general" | "match_events" | "pass_events";
  genieQuestion: string;
}

async function generateQuestions(
  league: string,
  inspirationSamples: typeof tweetSamples,
  count: number,
): Promise<TopicSelection[]> {
  const samplesText = inspirationSamples.map((s) => `- ${s.text}`).join("\n");
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

Tweet style examples for topic inspiration:
${samplesText}

Generate ${count} distinct, specific football data questions suitable for this league focus.
Each question should be answerable using only the available metrics above.
Each should target a different angle (record, milestone, comparison, ranking, streak, outlier, etc.).

Respond ONLY as valid JSON with no additional text — an array of ${count} objects:
[
  {
    "topic": "<short topic description, 5-10 words>",
    "genieSpace": "general" | "match_events" | "pass_events",
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

// ── Data collection ───────────────────────────────────────────────────────────

async function collectData(genieSpace: string, genieQuestion: string): Promise<string> {
  switch (genieSpace) {
    case "match_events": return queryMatchEvents(genieQuestion);
    case "pass_events":  return queryPassEvents(genieQuestion);
    default:             return queryGeneralStats(genieQuestion);
  }
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

  const samples = getSamplesForLeague(league);
  if (!samples.length) throw new Error(`No tweet samples found for league: ${league}`);
  const inspirationSamples = pickUniqueRandom(samples, 5);

  console.log(`[generate-questions] Generating ${count} questions...`);
  const questions = await generateQuestions(league, inspirationSamples, count);
  console.log(`[generate-questions] Got ${questions.length} questions from Claude`);

  const urls: string[] = [];
  for (const q of questions) {
    const url = await saveDraftQuestion({
      topic: q.topic,
      question: q.genieQuestion,
      league,
      genieSpace: q.genieSpace,
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
      const genieData = await collectData(q.genieSpace, q.question);
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
