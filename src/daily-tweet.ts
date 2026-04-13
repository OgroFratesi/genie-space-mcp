import Anthropic from "@anthropic-ai/sdk";
import { queryGeneralStats, queryMatchEvents, queryPassEvents } from "./genie";
import { saveTweetDraft } from "./notion";
import tweetSamples from "../data/tweet-samples.json";

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

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickUniqueRandom<T>(arr: T[], count: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

// ── Step 1: Topic selection ───────────────────────────────────────────────────

interface TopicSelection {
  topic: string;
  genieSpace: "general" | "match_events" | "pass_events";
  genieQuestion: string;
}

async function selectTopic(league: string, inspirationSamples: typeof tweetSamples): Promise<TopicSelection> {
  const samplesText = inspirationSamples
    .map((s) => `- ${s.text}`)
    .join("\n");

  const leagueLabel = league === "all" ? "cross-league comparison (all top leagues)" : league.replace(/_/g, " ");

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 500,
    messages: [{
      role: "user",
      content: `You are a football data analyst picking a topic for a daily curiosity tweet.

League focus: ${leagueLabel}

Here are some tweet examples for style and topic inspiration:
${samplesText}

Pick one specific, interesting football data topic for today's tweet. It should be something that can be answered with real data — a comparison, a stat, a pattern, a milestone, a curiosity.

Then decide which Genie Space to query for the data:
- "general": player stats, team stats, standings, season aggregations, leaderboards
- "match_events": shot timing, game-state at time of shot, shot location, build-up sequences
- "pass_events": pass accuracy, pass zones, progressive passes, crosses, pass flow

Respond ONLY as valid JSON with no additional text:
{
  "topic": "<short topic description, 5-10 words>",
  "genieSpace": "general",
  "genieQuestion": "<detailed natural language question for Genie, 2-4 sentences>"
}`,
    }],
  });

  const text = (response.content[0] as any).text as string;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Step 1: Claude did not return valid JSON. Response: ${text}`);
  return JSON.parse(match[0]) as TopicSelection;
}

// ── Step 2: Data collection ───────────────────────────────────────────────────

async function collectData(genieSpace: string, genieQuestion: string): Promise<string> {
  switch (genieSpace) {
    case "match_events": return queryMatchEvents(genieQuestion);
    case "pass_events":  return queryPassEvents(genieQuestion);
    default:             return queryGeneralStats(genieQuestion);
  }
}

// ── Step 3: Tweet draft + Notion save ─────────────────────────────────────────

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
  const samplesText = params.inspirationSamples
    .map((s) => `- ${s.text}`)
    .join("\n");

  const leagueLabel = params.league === "all" ? "cross-league" : params.league.replace(/_/g, " ");

  // TODO: Replace this prompt with a more detailed version tailored to your voice and style
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1000,
    messages: [{
      role: "user",
      content: `You are a football data analyst who writes sharp, insight-driven tweets that make people think.

Your tweet style — use these as examples:
${samplesText}

Topic: ${params.topic}
League: ${leagueLabel}

Data retrieved from the database:
${params.genieData}

Rules:
- The tweet must be factual and grounded in the data above
- Max 280 characters
- Lead with the most surprising or counterintuitive number
- No hashtags
- No emojis
- Write like a smart analyst, not a hype account

Also write a 2-3 sentence data summary of what the data shows (this goes into the database for reference, not published).

Respond ONLY as valid JSON with no additional text:
{
  "tweetDraft": "<tweet text, max 280 chars>",
  "dataSummary": "<2-3 sentence summary of the key insight from the data>"
}`,
    }],
  });

  const text = (response.content[0] as any).text as string;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Step 3: Claude did not return valid JSON. Response: ${text}`);
  const { tweetDraft, dataSummary } = JSON.parse(match[0]);

  const notionUrl = await saveTweetDraft({
    topic: params.topic,
    league: leagueLabel,
    tweetDraft,
    dataSummary,
  });

  return { tweetDraft, dataSummary, notionUrl };
}

// ── Main pipeline ─────────────────────────────────────────────────────────────

export async function runDailyTweetPipeline(): Promise<string> {
  console.log("[daily-tweet] Starting pipeline...");

  // Pick league
  const league = pickLeague();
  console.log(`[daily-tweet] Selected league: ${league}`);

  const samples = getSamplesForLeague(league);
  if (!samples.length) throw new Error(`No tweet samples found for league: ${league}`);
  const inspirationSamples = pickUniqueRandom(samples, 5);

  // Step 1 — Topic selection
  console.log("[daily-tweet] Step 1: Selecting topic...");
  const { topic, genieSpace, genieQuestion } = await selectTopic(league, inspirationSamples);
  console.log(`[daily-tweet] Topic: "${topic}" | Space: ${genieSpace}`);
  console.log(`[daily-tweet] Genie question: ${genieQuestion}`);

  // Step 2 — Data collection
  console.log("[daily-tweet] Step 2: Querying Genie...");
  const genieData = await collectData(genieSpace, genieQuestion);
  console.log(`[daily-tweet] Data collected (${genieData.length} chars)`);

  // Step 3 — Draft + save
  console.log("[daily-tweet] Step 3: Drafting tweet and saving to Notion...");
  const { tweetDraft, notionUrl } = await draftAndSave({
    league,
    topic,
    genieData,
    inspirationSamples,
  });

  console.log("[daily-tweet] Done.");
  return `Tweet draft saved to Notion: ${notionUrl}\n\nDraft:\n${tweetDraft}`;
}
