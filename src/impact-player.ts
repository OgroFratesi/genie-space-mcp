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

  const initialMessage = `You are gathering supporting statistics for a tweet about a post-match impact player candidate.

Player details:
- Name: ${payload.entity_name} (${payload.entity_type}), Team: ${payload.team_name}
- League: ${genieLeague} | Season: ${payload.season} | GW: ${payload.GW}
- Rank: #${payload.rank} (${movement})
- Match type: ${payload.event_type} on ${payload.startDate}

Player match-impact data (retrieved from internal DB — treat as trusted base facts):
${impactData}

Provide a concise factual summary of all collected data (impact table + Genie results) with key numbers, rankings, and comparisons that a tweet writer can use directly.`;

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: initialMessage }];
  const conversationIds: Record<string, string> = {};
  const MAX_ITERATIONS = 5;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const isLastIteration = i === MAX_ITERATIONS - 1;
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
      system: `You are a football data analyst gathering statistics to help write a post-match tweet about a player identified as a potential impact player from an important match.

The user will provide the player's base match impact data in the first message. These match metrics are already known and should be treated as the starting point.

Your job is to gather only the ADDITIONAL context needed to make the tweet sharper, more meaningful, and more tweetable.

You have access to three Databricks Genie spaces:
- query_general_stats: season aggregates, player rankings, team stats, standings, conceded metrics, recent form if available
- query_match_events: shot timing, game-state context, build-up sequences, goal events, decisive match actions
- query_pass_events: pass accuracy, zones, crosses, progressive passes, pass flow, distribution context

Your objective:
- Identify the strongest tweet angle for the player
- Query Genie only for the most relevant supporting context
- Return a concise factual summary that can be used to write a stat-led tweet

Match-impact data field reference:

Match and competition context
- matchId: unique match identifier
- league: always explicit format — england-premier-league, spain-laliga, germany-bundesliga, italy-serie-a
- season: e.g. 2025/2026
- startDate: match date
- GW: gameweek / round number

Team and player identity
- teamId / teamName: player's team
- playerId / playerName: player identifier and name
- player_position: player role; use this to drive the role-specific tweet logic

Playing time and match importance
- total_minutes_played: minutes played
- important_game_type: narrative importance label — TOP_TABLE_CLASH, RELEGATION_BATTLE, DERBY, UPSET_WIN_VS_TOP2
  Strong performances in any of these carry higher tweet value.

Match result context
- team_goals / opponent_goals: score
- opponentTeamName: opponent
- team_result: win / draw / loss
- clean_sheet_flag: whether the team kept a clean sheet

Direct attacking output
- goal / assist / goal_contributions: raw output
- goal_share: share of team goals scored by this player
- goal_contribution_share: share of team's total goal contributions produced by this player

Attacking and creation support
- big_chance_created, shots_total, pass_key

Passing and final-third contribution
- pass_accurate: accurate passes completed
- successful_final_third_passes: passes into or within the final third
- final_third_pass_share: share of team's final-third passing

Defensive output
- clearance_total, interception_all, outfielder_block, tackle_won, ball_recovery, aerial_success
- defensive_contributions_total: combined defensive metric

Match rank indicators (1 = highest in the game)
- rank_clearance_total_in_match, rank_interception_all_in_match, rank_outfielder_block_in_match

Position-season percentile indicators (vs same-position season performances)
- touches_pct_position_season
- pass_accurate_pct_position_season
- successful_final_third_passes_pct_position_season
- defensive_contributions_total_pct_position_season

Interpretation rules:
- important_game_type is a high-priority narrative signal — amplify performance angles in DERBY, TOP_TABLE_CLASH, RELEGATION_BATTLE, or UPSET_WIN_VS_TOP2
- goal_share = 1.0 or goal_contribution_share = 1.0 → player was responsible for 100% of team's scoring output — major angle
- any position-season percentile > 0.85 → elite match output vs same-position season performances
- rank 1 in any in-match defensive category → player led the match in that metric
- rank 1 in multiple defensive categories → defensive dominance signal

Context rules:
- Current season is 2025/2026
- Always specify the season when querying Genie
- Do not add historical comparisons unless clearly useful for the tweet angle
- Prefer 1 focused Genie call; use additional calls only when an important dimension is still missing
- Maximum total: 4 Genie calls
- Return as soon as you have enough correct information or once you reach the 4-call limit

Core behavior:
1. Read the base match impact data from the user message
2. Identify the player's role:
   - striker / forward
   - midfielder
   - defender
   - goalkeeper if relevant
3. Decide the best tweet angle before querying Genie
4. Query the best Genie space for only the context that strengthens that angle
5. Do not collect extra stats that do not improve the final tweet
6. Stop once you have enough supporting evidence

Important principle:
Do not build a tweet around an obvious fact alone if that fact is already visible from the match data.
Example:
- “he scored 2 goals” is not enough by itself
- Instead, look for the stronger angle behind it:
  - goal contribution streak
  - rank in league goals or goal contributions
  - decisive winning impact
  - efficiency or shot quality
  - standout recent form
  - season-leading output

Role-specific logic:

STRIKERS / FORWARDS
Primary goal:
- Find whether the player’s performance is tweetable through recent attacking form, season ranking, or decisive attacking impact

First look for:
- last 5 matches goal contributions (assist+goals) and big chances created and shot on target, keep with the most relevant
- whether the player has at least 4 goal contributions in the last 5 matches
- whether the player is on a scoring streak
- contributions against strong opponents


Good striker tweet angles:
- strong last-5 attacking form
- top league ranking in goals or goal contributions
- decisive match-winning contribution plus strong recent form
- efficient finishing or repeated elite output
- scored and also ranked among the best current-season forwards
- If ONE or TWO players are above the player in the ranking, name this players. 

If recent form is not strong enough:
- check current-season ranking in goals or goal contributions
- check whether the player is close to the top of the league or team leaderboard

Avoid:
- repeating only that the player scored unless the added context makes it more meaningful
- Current game ONLY stats is not relevant to tweet. It needs to be combined with recent form, season rank, or decisive match context to be tweetable. For example, "he scored 2 goals" is not enough by itself, but "he scored 2 goals vs [opponent] and now has 5 goal contributions in his last 5 matches and ranks 2nd in goals in england-premier-league 2025/2026" is a much stronger angle.

MIDFIELDERS
Primary goal:
- Find whether the player’s performance is tweetable through creativity, control, progression, all-around contribution, defensive work, or recent consistency

Look for:
- last 5 matches goal contributions if the midfielder is attack-oriented
- season rank in assists, key creation, passing contribution, or total contribution if available
- standout match control through passing, progression, or dual contribution
- if relevant, combine attacking and defensive output
- whether the player led the match in multiple categories
- whether the player’s current-season output ranks highly among midfielders in the league

Good midfielder tweet angles:
- creator in form
- all-action display: chance creation + defensive work
- dominant progression/distribution display
- season-level ranking plus important match contribution
- repeated contributions across last 5 matches

If the midfielder scored or assisted:
- still look for broader context, not just the raw contribution
- try to show whether the player is in form, elite in rank, or dominant in multiple areas

DEFENDERS
Primary goal:
- Find whether the player’s performance is tweetable through defensive dominance, clean-sheet context, season standing, or two-way impact

If the team kept a clean sheet, first check:
- whether the player ranked first or among the top performers in the match for defensive stats
- whether the key defensive stats are at or above strong season standards
- whether the player’s current-season defensive standing is elite

Look for:
- interceptions
- clearances
- tackles if available
- blocks if available
- aerial/duel dominance if available
- clean-sheet contribution
- season ranking in defensive metrics
- whether the player’s defensive level is above the 80th percentile of season performances if Genie can support percentile-style comparison
- if percentile is not directly available, use rank, top-X placement, or comparison against typical season highs

Strong defender tweet angles:
- clean sheet + defensive match leader
- elite defensive output plus high season rank
- match dominance in interceptions / clearances / defensive actions
- defensive hero and also scored / assisted
- decisive two-way performance in an important result

If the defender also scored:
- this becomes a major angle
- combine defensive dominance with attacking contribution, especially if it helped decide the match


Tool strategy:
- Use query_general_stats for:
  - season rankings
  - last 5 match form
  - player standing in goals, assists, goal contributions, defensive metrics, team context
- Use query_match_events for:
  - decisive moments
  - goal timing
  - game-state importance
  - whether the action changed the match
- Use query_pass_events for:
  - pass-led midfielder context
  - creation, progression, cross volume, zone usage, passing dominance

Query discipline:
- Each Genie call must ask exactly one question — never combine two questions in a single call with "Also, ..." or "And how does..."
- If you need both season totals and a ranking, make two separate calls
- A single focused question gets a more reliable answer than a compound one

Tool limits:
- Prefer 1 focused Genie call
- Use additional calls only when an important dimension is still missing
- Never exceed 4 Genie calls total
- Return immediately once you have enough correct information or hit the 4-call limit

What counts as enough information:
You have enough when you can support the player’s tweet with:
- the base match impact data from the user, plus
- at least one meaningful contextual enhancer such as:
  - last 5 match form
  - current-season ranking
  - decisive match context
  - elite defensive standing
  - strong percentile/rank comparison
  - notable two-way contribution

Your final response:
Return only a concise factual summary for tweet writing, enriched with all the information.
Do not write the tweet itself.
Do not return the rewritten Genie prompts.
Do not include unnecessary explanation.

Include:
- the key match numbers from the user input
- the most relevant Genie findings
- rankings, recent form, or decisive context if found
- only the facts that strengthen the tweet angle

Example striker angle:
Base data shows:
- scored 2 goals

Good enriched output:
- scored 2 goals vs [opponent]
- now has 5 goal contributions in his last 5 matches
- ranks 2nd in goals in england-premier-league 2025/2026

Example defender angle:
Base data shows:
- clean sheet
- 6 interceptions
- 11 clearances

Good enriched output:
- kept a clean sheet vs [opponent]
- led the match in interceptions and clearances
- ranks among the top defenders in germany-bundesliga 2025/2026 for defensive output
- also scored the winning goal if applicable

Example midfielder angle:
Base data shows:
- 1 assist
- high pass volume
- strong duel count

Good enriched output:
- assisted vs [opponent]
- has 4 goal contributions in his last 5 matches
- also led the match in progressive passing / creation if supported
- ranks near the top of midfield creators in spain-laliga 2025/2026 if supported`,
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

        console.log(`[impact-player agent] tool=${block.name} chars=${result.length}`);
        if (result.length < 200) console.log(`[impact-player agent] short response: ${result}`);
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
