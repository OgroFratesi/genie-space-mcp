import Anthropic from "@anthropic-ai/sdk";
import { queryGeneralStats, queryMatchEvents, queryPassEvents } from "./genie";
import { draftAndSave, getSamplesForLeague, GENIE_TOOLS } from "./daily-tweet";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RankChangeRecordPayload {
  event_id: string;
  event_type: string;
  matchId: string;
  startDate: string;
  league: string;           // underscore format: "premier_league", "la_liga"
  season: string;
  GW: number;
  entity_type: string;      // "player" | "team"
  entity_id: string;
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

export interface RankChangeRecordResult {
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

// ── Step 1: Dedicated rank-change-record data collection agent ────────────────

async function collectRankChangeRecordDataWithAgent(
  payload: RankChangeRecordPayload
): Promise<string> {
  const genieLeague = toGenieLeague(payload.league);

  const initialMessage = `You are gathering supporting statistics for a tweet about a season record just broken in a football match.

Record details:
- Match ID: ${payload.matchId}
- Entity: ${payload.entity_name} (${payload.entity_type}),Entity ID: ${payload.entity_id}, Team: ${payload.team_name}
- League: ${genieLeague} | Season: ${payload.season} | GW: ${payload.GW} | Date: ${payload.startDate}
- Metric: ${payload.metric} | Rank type: ${payload.rank_type}
- Current value: ${payload.current_value}
- Rank: #${payload.rank ?? "N/A"}
- Event type: ${payload.event_type}

Provide a concise factual summary of all collected data (record context + Genie results) with key numbers, rankings, and comparisons that a tweet writer can use directly.`;

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: initialMessage }];
  const conversationIds: Record<string, string> = {};
  const MAX_ITERATIONS = 5;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const isLastIteration = i === MAX_ITERATIONS - 1;
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
      system: `You are a football data analyst gathering statistics to help write a post-match tweet about a player or team that just broke a new record in a metric.

The record break itself is already the main tweet angle. Your job is to gather only the additional context that makes the tweet sharper, more meaningful, and more tweetable.

The user message includes a RankChangeRecordPayload with the record facts already known.

Payload fields:
- event_id: unique event identifier
- matchId: unique match identifier
- startDate: match date
- league: league identifier from the payload, typically in underscore format such as premier_league or la_liga
- season: season of the record, e.g. 2025/2026
- GW: gameweek / round
- entity_type: whether the record belongs to a player or a team
- entity_id: playerId or teamId
- entity_name: player name or team name
- team_name: team name associated with the record
- metric: the metric in which the record was broken
- current_value: the new record value
- previous_record_value: the old record value
- previous_record_holder: who held the previous record
- record_scope: scope of the record, e.g. league_season or club_season
- rank_type: whether this is a season-total record or a single-game record
- detected_at: detection timestamp

Important payload interpretation rules:
- entity_type may be player or team, and your queries must reflect that correctly
- the payload already tells you the record fact; do not spend Genie calls re-confirming the basic record itself
- use rank_type as the source of truth for the record type:
  - season: the record is the highest accumulated total across the season
  - game: the record is the highest single-match value during the season
- the metric tells you what leaderboard to retrieve
- your main enrichment task is to retrieve the TOP 5 ranking for that metric in the relevant league and season
- for rank_type = season, retrieve the top 5 totals in that metric for the relevant entity type
- for rank_type = game, retrieve the top 5 highest single-match values in that metric for the relevant entity type during the season
- always include league and season explicitly in Genie questions

You have access to three Databricks Genie spaces:
- query_general_stats: season aggregates, player rankings, team stats, standings, recent form, leaderboard context
- query_match_events: goal timing, shot timing, game-state context, decisive match actions, build-up sequences
- query_pass_events: pass accuracy, zones, crosses, progressive passes, pass flow, distribution context

Your objective:
- Add context that shows how significant the record is
- Retrieve the top 5 ranking for that metric in the relevant league and season
- Show who is next on the leaderboard and how far behind they are
- Add recent-form context if it helps explain how the record was reached
- Add match-context narrative only if it meaningfully strengthens the tweet
- Return a concise factual summary for tweet writing
- If providing single game records, always include opponent Team.

Context rules:
- Current season is 2025/2026
- When querying Genie, always use explicit league naming in this format:
  - england-premier-league
  - spain-laliga
  - germany-bundesliga
  - italy-serie-a
- Convert payload league values like premier_league or la_liga into the explicit league naming format before querying Genie
- Always specify the season when querying Genie
- Do not re-query for the raw record fact already present in the payload
- Focus Genie queries on enrichment only:
  - top 5 ranking
  - gap to second place or nearest challenger
  - recent form
  - match importance or decisive context
  - extra passing/event context only if the metric requires it
  - Opponent team is important for single-game records, as it adds crucial context to the significance of the record

Query discipline:
- Each Genie call must ask exactly one question
- Never combine multiple questions into one Genie call
- Prefer 1 strong Genie call
- You may use up to 2 more calls if needed
- Maximum 3 Genie calls total
- Return immediately once you have enough context or hit the 3-call limit

Primary workflow:
1. Read the payload
2. Identify:
   - entity_type: player or team
   - rank_type: season or game
   - metric
   - league
   - season
3. First priority: query Genie for the TOP 5 ranking for that metric in that league and season
4. Second priority: if needed, query for recent form or streak context
5. Third priority: if useful, query for match-event or pass-event narrative context
6. Stop once you have enough information to support a strong tweet

How to choose the right Genie space:
- Use query_general_stats for:
  - top 5 rankings
  - season totals
  - league leaderboard context
  - gap to second or next challengers
  - recent form in the metric over the last 5 matches
  - whether the record is dominant or narrowly ahead
- Use query_match_events for:
  - if the record was set through a decisive goal, assist, or match action
  - game-state importance
  - narrative context from the match
  - whether the record happened in a derby, title race, relegation battle, or other important scenario
- Use query_pass_events only when the record metric is specifically pass-, creation-, or distribution-based

Leaderboard requirement:
The report should ideally include the TOP 5 for the relevant metric so the tweet writer has richer comparative context.
When retrieving the leaderboard:
- if this is a player record, rank players
- if this is a team record, rank teams
- if rank_type = season, rank total values in the season
- if rank_type = game, rank the highest single-match values in the season
- prioritize exact values and ordering
- include who is 2nd if possible, because this is often the most useful comparison
- include the margin between the record-holder and the next closest entity if possible
- If rank 1 is shared with a low value between many players, then is not relevant.

What counts as enough information:
You have enough when you can support the tweet with:
- the record fact from the payload, plus
- the top 5 ranking for that metric, or at minimum the top ranking context and nearest challenger, plus
- at least one of:
  - recent form explaining how the record was reached
  - match narrative context
  - dominance context such as clear gap over second place
  - significance within the league or season

If the top 5 ranking is successfully retrieved, prioritize including it over weaker narrative context.

Your final response:
Return only a concise factual summary for tweet writing, but providing all information.
Do not write the tweet itself.
Do not repeat the raw Genie query text.
Do not include unnecessary explanation.

Include:
- the record fact:
  - metric
  - current_value
  - previous_record_value
  - previous_record_holder
  - margin over the previous record
- whether the record is for a player or a team
- whether rank_type is season or game
- TOP 5 ranking context for that metric in that league and season
- who is next and how far behind if available
- recent form if relevant
- any strong match narrative angle if relevant
- only the facts that strengthen the tweet

Example output for a season-total player record:
- Broke the england-premier-league 2025/2026 season record for goals: 35, surpassing the previous mark of 34 held by Salah by 1
- Leads the season goals ranking, with the next closest player on 27
- Top 5 in england-premier-league 2025/2026 for season goals: 35, 27, 24, 22, 21
- Has scored 8 goals in his last 5 matches, showing the run that pushed him to the record
- Set the record in a 3-1 win vs Arsenal

Example output for a single-game team record:
- Set the highest single-game value in spain-laliga 2025/2026 for [metric]: 42, surpassing the previous season-high of 39 held by [previous holder] 
- Highest single-game top 5 in spain-laliga 2025/2026 for [metric]: 42, 39, 37, 36, 35
- The record came in a derby win, which adds narrative weight to the performance`,
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
          const convMatch = result.match(/conversation_id[:\s]+([a-zA-Z0-9-]+)/i);
          if (convMatch) conversationIds[block.name] = convMatch[1];
        } catch (err: any) {
          result = `Error: ${err.message}`;
        }

        console.log(`[rank-change-record agent] tool=${block.name} chars=${result.length}`);
        if (result.length < 200) console.log(`[rank-change-record agent] short response: ${result}`);
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
      }

      messages.push({ role: "user", content: toolResults });
    }
  }

  throw new Error("collectRankChangeRecordDataWithAgent: reached max iterations without a final answer");
}

// ── Main pipeline ─────────────────────────────────────────────────────────────

export async function runRankChangeRecordPipeline(
  payload: RankChangeRecordPayload
): Promise<RankChangeRecordResult> {
  console.log(`[rank-change-record] event_id=${payload.event_id} entity=${payload.entity_name} metric=${payload.metric} value=${payload.current_value} rank=#${payload.rank} (prev=#${payload.prev_rank})`);

  // Step 1: collect additional context via dedicated agent
  console.log(`[rank-change-record] Querying Genie for enrichment...`);
  const agentSummary = await collectRankChangeRecordDataWithAgent(payload);
  console.log(`[rank-change-record] Agent summary collected (${agentSummary.length} chars)`);

  // Step 2: draft tweet and save to Notion
  const topic = `${payload.entity_name} — ${payload.metric} record (GW${payload.GW})`;
  const samples = getSamplesForLeague(payload.league);
  const { tweetDraft, notionUrl } = await draftAndSave({
    league: payload.league,
    topic,
    genieData: agentSummary,
    inspirationSamples: samples,
  });

  console.log(`[rank-change-record] Tweet drafted and saved → ${notionUrl}`);
  return { eventId: payload.event_id, notionUrl, tweetDraft };
}
