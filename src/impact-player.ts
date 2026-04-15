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
  rank: number | null;
  prev_rank: number | null;
  detected_at: string;
  processed: boolean;
}

export interface ImpactPlayerResult {
  eventId: string;
  notionUrl: string;
  tweetDraft: string;
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

function rankDeltaDescription(rank: number | null, prevRank: number | null): string {
  if (rank === null) return "no rank data";
  if (prevRank === null) return `currently #${rank}`;
  const delta = prevRank - rank;
  if (delta > 0) return `moved UP ${delta} place${delta > 1 ? "s" : ""} (from #${prevRank} to #${rank})`;
  if (delta < 0) return `dropped ${Math.abs(delta)} place${Math.abs(delta) > 1 ? "s" : ""} (from #${prevRank} to #${rank})`;
  return `unchanged at #${rank}`;
}

// ── Step 1: Dedicated impact player data collection agent ────────────────────

async function collectImpactPlayerDataWithAgent(
  payload: ImpactPlayerPayload,
  impactData: string
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
Season leaderboard for ${payload.metric} in ${genieLeague} ${payload.season} (top 10), plus ${payload.entity_name}'s recent form over the last 5 gameweeks.

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

  // Step 1: collect additional data via dedicated agent
  console.log(`[impact-player] Querying Genie for enrichment...`);
  const agentSummary = await collectImpactPlayerDataWithAgent(payload, impactData);
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
  return { eventId: payload.event_id, notionUrl, tweetDraft };
}
