import Anthropic from "@anthropic-ai/sdk";
import { queryPlayerImpactTable, queryGeneralStats, queryMatchEvents, queryPassEvents } from "./genie";
import { draftAndSave, getSamplesForLeague, GENIE_TOOLS } from "./daily-tweet";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ImpactPlayerPayload {
  event_id: string;
  event_type: string;       // "derby" | "relegation_battle" | "top4_battle"
  matchId: string;
  startDate: string;
  league: string;           // underscore format: "premier_league", "la_liga"
  season: string;
  GW: number;
  entity_type: string;      // "player" | "team"
  entity_id: string;        // playerId
  entity_name: string;
  team_name: string;
  rank_type: string;
  metric: string;
  current_value: number;
  rank: number;
  prev_rank: number;
  detected_at: string;
  processed: boolean;
}

interface TweetabilityAssessment {
  shouldTweet: boolean;
  reason: string;
  suggestedGenieContext: string;
}

export interface ImpactPlayerResult {
  eventId: string;
  shouldTweet: boolean;
  reason: string;
  notionUrl?: string;
  tweetDraft?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const LEAGUE_GENIE_MAP: Record<string, string> = {
  premier_league: "england-premier-league",
  la_liga:        "spain-laliga",
  bundesliga:     "germany-bundesliga",
  serie_a:        "italy-serie-a",
  ligue_1:        "ligue_1",
};

function toGenieLeague(league: string): string {
  return LEAGUE_GENIE_MAP[league] ?? league;
}

function rankDeltaDescription(rank: number, prevRank: number): string {
  const delta = prevRank - rank;
  if (delta > 0) return `moved UP ${delta} place${delta > 1 ? "s" : ""} (from #${prevRank} to #${rank})`;
  if (delta < 0) return `dropped ${Math.abs(delta)} place${Math.abs(delta) > 1 ? "s" : ""} (from #${prevRank} to #${rank})`;
  return `unchanged at #${rank}`;
}

// ── Step 1: Tweetability assessment ──────────────────────────────────────────

async function assessTweetability(
  payload: ImpactPlayerPayload,
  impactData: string
): Promise<TweetabilityAssessment> {
  const movement = rankDeltaDescription(payload.rank, payload.prev_rank);

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 600,
    system: `You are a football data analyst and social media strategist for a stat-led football Twitter account.

Your job is to evaluate whether a detected player/team statistical signal is interesting enough to tweet about ahead of an upcoming match. Not every signal warrants a tweet — only those with a genuinely compelling story.

Assess signals using these criteria (in order of importance):
1. Impact scores: impact_total_score and attacking/creative/defensive_impact_score — high values relative to position benchmarks are strong signals. The *_pct_position_season fields (percentile vs peers at same position) are especially useful here.
2. Goal contributions: goal, assist, goal_contributions, goal_share vs squad share metrics (goal_contribution_share, shots_share) — show whether this player is their team's primary output.
3. Rank movement: a jump of 3+ places is significant; breaking into the top 3 is very significant.
4. Match stakes: event_type "derby" and "relegation_battle" add strong narrative weight; "top4_battle" is medium.
5. Share-of-team metrics: big_chance_created_share, key_pass_share, final_third_pass_share — shows dominance within team.

Be strict. Reject signals that are statistically unremarkable. Only approve signals where you can already imagine a punchy, data-led tweet.

When shouldTweet is true, also generate suggestedGenieContext: a specific description of what additional Genie data would be most useful for writing the tweet. Be explicit about which league name format to use (e.g. england-premier-league), the season (e.g. 2025/2026), and what to retrieve (leaderboard, recent form, historical comparison, opponent context, etc.).

Respond ONLY as valid JSON with no additional text:
{
  "shouldTweet": boolean,
  "reason": "<1-2 sentences explaining why this is or is not worth tweeting>",
  "suggestedGenieContext": "<description of what Genie data would help, or empty string if shouldTweet is false>"
}`,
    messages: [{
      role: "user",
      content: `Evaluate this impact player signal:

Payload signal:
- Entity: ${payload.entity_name} (${payload.entity_type}), Team: ${payload.team_name}
- League: ${payload.league} | Season: ${payload.season} | GW: ${payload.GW}
- Metric: ${payload.metric} (${payload.rank_type}) | Value: ${payload.current_value}
- Rank: #${payload.rank} (was #${payload.prev_rank}) — ${movement}
- Upcoming match type: ${payload.event_type} on ${payload.startDate}

Player impact table data:
${impactData}

Decide: is this signal interesting enough to tweet about ahead of this match?`,
    }],
  });

  const text = (response.content[0] as Anthropic.TextBlock).text;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`assessTweetability: Claude did not return valid JSON. Response: ${text}`);
  return JSON.parse(match[0]) as TweetabilityAssessment;
}

// ── Step 2: Dedicated impact player data collection agent ─────────────────────

async function collectImpactPlayerDataWithAgent(
  payload: ImpactPlayerPayload,
  impactData: string,
  genieContext: string
): Promise<string> {
  const genieLeague = toGenieLeague(payload.league);
  const movement = rankDeltaDescription(payload.rank, payload.prev_rank);

  const initialMessage = `You are gathering supporting statistics for a tweet about a pre-match impact player candidate.

Player details:
- Name: ${payload.entity_name} (${payload.entity_type}), Team: ${payload.team_name}
- League: ${genieLeague} | Season: ${payload.season} | GW: ${payload.GW}
- Metric: ${payload.metric} | Value: ${payload.current_value}
- Rank: #${payload.rank} (${movement})
- Upcoming match: ${payload.event_type} on ${payload.startDate}

Player impact data (already retrieved from internal DB):
${impactData}

What additional Genie data to retrieve:
${genieContext || `Season leaderboard for ${payload.metric} in ${genieLeague} ${payload.season} (top 10), plus ${payload.entity_name}'s recent form over the last 5 gameweeks.`}

Use the Genie tools to retrieve this additional context. Focus on data that is NOT already present in the impact table above — add new angles: season rankings, historical comparisons, recent form trends, or opponent context.

Provide a concise factual summary of all collected data (impact table + Genie results) with key numbers, rankings, and comparisons that a tweet writer can use directly.`;

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: initialMessage }];
  const conversationIds: Record<string, string> = {};
  const MAX_ITERATIONS = 3;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const isLastIteration = i === MAX_ITERATIONS - 1;
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
      system: `You are a football data analyst gathering statistics to write a pre-match tweet about a player identified as a potential impact player for an important match.

You have access to three Databricks Genie spaces:
- query_general_stats: season aggregates, player rankings, team stats, standings, conceded metrics
- query_match_events: shot timing, game-state context, build-up sequences, goal events
- query_pass_events: pass accuracy, zones, crosses, progressive passes, pass flow

The user will provide you with the player's base impact data from the internal team database.
Your job is to gather ADDITIONAL context via Genie that enriches the tweet: season leaderboard position, historical comparisons, recent form trend, or opponent context.

Guidelines:
- Use explicit league names: england-premier-league, spain-laliga, germany-bundesliga, italy-serie-a
- Always specify the season (e.g. 2025/2026)
- Ask for top-N rankings, not just one player's value
- Prefer 1-2 focused Genie calls over many broad ones
- Stop once you have enough concrete supporting data

Your final response must be a concise factual summary combining:
- Key numbers from the impact table
- New data from Genie (rankings, comparisons, form, context)
Keep it compact and directly useful for writing a stat-led tweet.`,
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

        console.log(`[impact-player agent] tool=${block.name} chars=${result.length}`);
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
      }

      messages.push({ role: "user", content: toolResults });
    }
  }

  throw new Error("collectImpactPlayerDataWithAgent: reached max iterations without a final answer");
}

// ── Main pipeline ─────────────────────────────────────────────────────────────

export async function runImpactPlayerPipeline(
  payload: ImpactPlayerPayload
): Promise<ImpactPlayerResult> {
  const movement = rankDeltaDescription(payload.rank, payload.prev_rank);
  console.log(`[impact-player] event_id=${payload.event_id} entity=${payload.entity_name} metric=${payload.metric} rank=#${payload.rank} (${movement})`);

  // Step 0: fetch impact data from SQL table
  const impactData = await queryPlayerImpactTable(payload.matchId, payload.entity_id);
  console.log(`[impact-player] SQL impact data fetched (${impactData.length} chars)`);

  // Step 1: tweetability assessment
  const assessment = await assessTweetability(payload, impactData);

  if (!assessment.shouldTweet) {
    console.log(`[impact-player] Skipped — ${assessment.reason}`);
    return { eventId: payload.event_id, shouldTweet: false, reason: assessment.reason };
  }

  console.log(`[impact-player] Tweetworthy — ${assessment.reason}`);
  console.log(`[impact-player] Querying Genie for enrichment...`);

  // Step 2: collect additional data via dedicated agent
  const agentSummary = await collectImpactPlayerDataWithAgent(
    payload,
    impactData,
    assessment.suggestedGenieContext
  );
  console.log(`[impact-player] Agent summary collected (${agentSummary.length} chars)`);

  // Step 3: draft and save to Notion using existing draftAndSave
  const topic = `${payload.entity_name} — ${payload.metric} (GW${payload.GW})`;
  const samples = getSamplesForLeague(payload.league);
  const { tweetDraft, notionUrl } = await draftAndSave({
    league: payload.league,
    topic,
    genieData: agentSummary,
    inspirationSamples: samples,
  });

  console.log(`[impact-player] Tweet drafted and saved → ${notionUrl}`);
  return { eventId: payload.event_id, shouldTweet: true, reason: assessment.reason, notionUrl, tweetDraft };
}
