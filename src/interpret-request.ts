import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LineInterpretation {
  enhancedRequest: string;
  xLabel: string;
  valueLabel: string;
  title: string;
  subtitle: string;
  genieSpace: "general" | "shots_events" | "passes_events";
}

export interface ScatterInterpretation {
  enhancedRequest: string;
  xLabel: string;
  yLabel: string;
  title: string;
  subtitle: string;
  genieSpace: "general" | "shots_events" | "passes_events";
}

// ── Line Chart Interpreter ────────────────────────────────────────────────────

export async function interpretLineRequest(request: string): Promise<LineInterpretation> {
  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 500,
    messages: [{
      role: "user",
      content: `You are a football data assistant. A user wants a line chart.

User request: "${request}"

Task 0 — Genie Space Selection:
Choose the most appropriate Genie data space for this query:
- "general": player/team season stats, standings, aggregated metrics (goals, assists, minutes, xG, rankings, top scorers)
- "shots_events": shot/goal events with timing (last 10 min, first half, game state while winning/losing, shot origin: corners, free kicks, crosses)
- "passes_events": pass events — accuracy, cross types, long balls, progressive passes, passing zones, game-state passing patterns

Task 1 — Enhanced data spec for a SQL agent:
- Resolve "current"/"this season" → "filter to the most recent season in the data (2025/2026)"
- If metric is cumulative/running → "use a running SUM window function partitioned by [series] ordered by [x_axis]"
- If specific teams/players/leagues are named → "return one row per [entity] per [x_dim]; use [entity] name as the series column value (one line per entity)"
- If no natural grouping exists → "return a single-line chart with no series column"
- Normalize entity names: "Man City" → "Manchester City", "Bayern" → "Bayern Munich"
- League slugs: Premier League → england-premier-league, La Liga → spain-laliga, Bundesliga → germany-bundesliga, Serie A → italy-serie-a
- Be explicit about x_axis dimension (game_week, season, month) and the value metric

Task 2 — Chart labels:
- xLabel: short x-axis label (e.g. "Game Week", "Season")
- valueLabel: short y-axis label (e.g. "Cumulative Shots", "Goals Conceded")
- title: chart title (e.g. "Cumulative Shots · Chelsea, Arsenal, Man City")
- subtitle: scope line (e.g. "Premier League 2025/26")

Return ONLY JSON (no other text):
{ "enhancedRequest": "...", "xLabel": "...", "valueLabel": "...", "title": "...", "subtitle": "...", "genieSpace": "general" }`,
    }],
  });
  const text = (response.content[0] as any).text as string;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`interpretLineRequest: no JSON in response: ${text}`);
  const parsed = JSON.parse(match[0]);
  return {
    enhancedRequest: parsed.enhancedRequest ?? parsed.enhanced_request ?? request,
    xLabel: parsed.xLabel ?? parsed.x_label ?? "",
    valueLabel: parsed.valueLabel ?? parsed.value_label ?? "",
    title: parsed.title ?? "",
    subtitle: parsed.subtitle ?? "",
    genieSpace: parsed.genieSpace ?? "general",
  };
}

// ── Bar Chart Interpreter ─────────────────────────────────────────────────────

export interface BarInterpretation {
  enhancedRequest: string;
  yLabel: string;
  valueLabel: string;
  title: string;
  subtitle: string;
  genieSpace: "general" | "shots_events" | "passes_events";
}

export interface BarPoint {
  yLabel: string;
  value: number;
  barLabel?: string;
  teamName?: string;
  category?: string;
}

export async function interpretBarRequest(request: string): Promise<BarInterpretation> {
  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 500,
    messages: [{
      role: "user",
      content: `You are a football data assistant. A user wants a horizontal bar chart.

User request: "${request}"

Task 0 — Genie Space Selection:
Choose the most appropriate Genie data space for this query:
- "general": player/team season stats, standings, aggregated metrics (goals, assists, minutes, xG, rankings, top scorers)
- "shots_events": shot/goal events with timing (last 10 min, first half, game state while winning/losing, shot origin: corners, free kicks, crosses)
- "passes_events": pass events — accuracy, cross types, long balls, progressive passes, passing zones, game-state passing patterns

Task 1 — Enhanced data spec for a Genie SQL agent:
- Resolve "current"/"this season" → "filter to the most recent season in the data (2025/2026)"
- Normalize entity names: "Man City" → "Manchester City", "Bayern" → "Bayern Munich"
- League slugs: Premier League → england-premier-league, La Liga → spain-laliga, Bundesliga → germany-bundesliga, Serie A → italy-serie-a
- The query should return 2 or 3 columns:
  1. A categorical grouping (e.g. season, team, player, competition) — this goes on the Y axis
  2. A numeric metric (e.g. goals, wins, xG) — this is the bar length (X axis)
  3. Optionally a name label (e.g. top scorer's name, team name) to display inside the bar — only if it is different from column 1
- Be explicit about what the category, metric, and optional name label are

Task 2 — Chart labels:
- yLabel: short Y-axis label (e.g. "Season", "Team")
- valueLabel: short X-axis label (e.g. "Goals", "Wins")
- title: chart title, only add the metric and league (e.g. "Passes into Final Third · Premier League")
- subtitle: scope line (e.g. "Premier League · 2010/11–2024/25")

Return ONLY JSON (no other text):
{ "enhancedRequest": "...", "yLabel": "...", "valueLabel": "...", "title": "...", "subtitle": "...", "genieSpace": "general" }`,
    }],
  });
  const text = (response.content[0] as any).text as string;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`interpretBarRequest: no JSON in response: ${text}`);
  const parsed = JSON.parse(match[0]);
  return {
    enhancedRequest: parsed.enhancedRequest ?? parsed.enhanced_request ?? request,
    yLabel: parsed.yLabel ?? parsed.y_label ?? "",
    valueLabel: parsed.valueLabel ?? parsed.value_label ?? "",
    title: parsed.title ?? "",
    subtitle: parsed.subtitle ?? "",
    genieSpace: parsed.genieSpace ?? "general",
  };
}

export async function structureBarData(
  columns: string[],
  rows: string[][],
  meta: BarInterpretation
): Promise<BarPoint[]> {
  if (rows.length === 0) return [];

  const sample = rows.slice(0, 5).map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i]])));

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 4000,
    messages: [{
      role: "user",
      content: `You are a data structuring assistant. Convert this tabular data into a bar chart format.

Chart context:
- Y axis (categories): "${meta.yLabel}"
- X axis (values): "${meta.valueLabel}"

Available columns: ${JSON.stringify(columns)}
Sample rows (first 5): ${JSON.stringify(sample)}
Total rows: ${rows.length}

All rows:
${JSON.stringify(rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i]]))))}

Task: Return a JSON array where each element has:
- "yLabel": string — the Y-axis category value (e.g. "2018-19", "Arsenal")
- "value": number — the numeric bar length (X axis)
- "barLabel": string | null — a name to display inside the bar (e.g. player name), ONLY if there is a separate name column different from the yLabel column. Set to null if no such column exists.
- "teamName": string | null — the full team/club name if a team column exists in the data (e.g. "Chelsea", "Manchester City", "FC Barcelona", "Real Madrid"). Used for logo lookup. Set to null ONLY if there is truly no team/club column in the data. Do NOT confuse this with the player name — teamName must be a club, not a person.
- "category": string | null — a grouping dimension to color bars differently (e.g. league slug like "england-premier-league", "spain-laliga"). Use the raw value from the data. Set to null if no natural grouping/coloring column exists.

Return ONLY a valid JSON array, no other text. Example:
[{"yLabel":"2018-19","value":22,"barLabel":"Harry Kane","teamName":"Tottenham","category":"england-premier-league"},{"yLabel":"2019-20","value":23,"barLabel":"Jamie Vardy","teamName":"Leicester","category":"england-premier-league"}]`,
    }],
  });

  const text = (response.content[0] as any).text as string;
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error(`structureBarData: no JSON array in response: ${text}`);
  const parsed: any[] = JSON.parse(match[0]);
  console.log(`[structureBarData] teamName values from Haiku: ${JSON.stringify(parsed.map((p: any) => ({ yLabel: p.yLabel, teamName: p.teamName })))}`);
  return parsed
    .map((p) => ({
      yLabel: String(p.yLabel ?? ""),
      value: parseFloat(p.value) || 0,
      barLabel: p.barLabel ? String(p.barLabel) : undefined,
      teamName: p.teamName ? String(p.teamName) : undefined,
      category: p.category ? String(p.category) : undefined,
    }))
    .filter((p) => p.yLabel && isFinite(p.value));
}

// ── Beeswarm Chart Interpreter ───────────────────────────────────────────────

export interface BeeswarmInterpretation {
  player_name: string;
  metrics: string[];
  metric_labels: string[];
  enhancedRequest: string;
  title: string;
  genieSpace: "general" | "shots_events" | "passes_events";
}

export async function interpretBeeswarmRequest(
  request: string,
  season: string,
  minMinutes: number,
): Promise<BeeswarmInterpretation> {
  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 600,
    messages: [{
      role: "user",
      content: `You are a football data assistant. A user wants a multi-metric beeswarm chart for a single player.

User request: "${request}"

Task 0 — Genie Space Selection:
Choose the most appropriate Genie data space for this query:
- "general": player/team season stats, aggregated metrics (goals, assists, minutes, xG, interceptions, aerial duels, shots, passes)
- "shots_events": per-shot event data (shot location, xG per shot, body part, game state)
- "passes_events": per-pass event data (pass length, zone, progressive passes, crosses, key passes)

Task 1 — Extract player and metrics:
- Extract the player_name exactly as given by the user
- Extract the list of metrics as clean snake_case SQL column aliases (e.g. shots_on_target, passes_into_final_third, interceptions, aerial_duels_won)

Task 2 — Build the enhanced Genie analytical question:
Take the user’s original request and rewrite it into a clear, detailed analytical question that Genie can execute effectively.

The rewritten question must:

Expand the scope to include all relevant players in the dataset (unless the user explicitly filter by)
Clearly describe the level of aggregation (e.g., player-season vs. player career totals)
Explicitly state that the output should include:
player name (player)
team name (team)
league identifier (league, e.g., england-premier-league)
total minutes played (minutes_played) if the user filter by minutes play, explicitly state that in the question, total minutes played in the season
all relevant performance metrics, each as its own field using the exact snake_case naming

Frame the request in analytical natural language, not as instructions or SQL. It should read like a data analysis question, similar to:

defining the population (which players, leagues, seasons)
clarifying how metrics should be computed or interpreted
specifying the structure of the output table

The goal is to remove ambiguity, add missing context, and make the request directly executable by Genie, while preserving the original analytical intent of the user.

Requirements:
- Filter to season '${season}'
- Filter to players with at least ${minMinutes} minutes played in the season
- Include LIMIT 20 (Genie requires it; it will be removed before the full query runs)
- Do NOT filter to the target player — include all players

Task 3 — Labels:
- metric_labels: human-readable label per metric (e.g. ["Shots on Target", "Passes into Final Third"]). Do not add "per 90"
- title: e.g. "Enzo Fernandez — Statistical Profile"

Return ONLY JSON (no other text):
{ "player_name": "...", "metrics": ["...", "..."], "metric_labels": ["...", "..."], "enhancedRequest": "...", "title": "...", "genieSpace": "general" }`,
    }],
  });
  const text = (response.content[0] as any).text as string;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`interpretBeeswarmRequest: no JSON in response: ${text}`);
  const parsed = JSON.parse(match[0]);
  return {
    player_name: parsed.player_name ?? "",
    metrics: Array.isArray(parsed.metrics) ? parsed.metrics : [],
    metric_labels: Array.isArray(parsed.metric_labels) ? parsed.metric_labels : [],
    enhancedRequest: parsed.enhancedRequest ?? parsed.enhanced_request ?? request,
    title: parsed.title ?? "",
    genieSpace: parsed.genieSpace ?? "general",
  };
}

// ── SQL Column Resolver ───────────────────────────────────────────────────────

export interface ColumnResolution {
  playerCol: string;
  teamCol: string;
  minutesCol: string;
  metricCols: Record<string, string>;
}

export async function resolveColumnsFromSQL(
  sql: string,
  expectedMetrics: string[],
): Promise<ColumnResolution> {
  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 400,
    messages: [{
      role: "user",
      content: `You are a SQL analysis assistant. Analyze this SQL query and identify the exact column aliases that will appear in the result set.

SQL:
${sql}

Expected metric names (snake_case): ${JSON.stringify(expectedMetrics)}

Return ONLY valid JSON — no other text:
{
  "playerCol": "<exact alias for the player/person name column>",
  "teamCol": "<exact alias for the team/club name column>",
  "minutesCol": "<exact alias for the minutes played column>",
  "metricCols": {
    ${expectedMetrics.map((m) => `"${m}": "<closest matching actual alias>"`).join(",\n    ")}
  }
}

Rules:
- Use the exact alias as written after AS (or the bare column name if there is no AS alias)
- For metricCols, map each expected metric to the actual alias that best represents it
- If a column does not exist in the SQL, use the expected name as-is`,
    }],
  });
  const text = (response.content[0] as any).text as string;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`resolveColumnsFromSQL: no JSON in response: ${text}`);
  const parsed = JSON.parse(match[0]);
  return {
    playerCol: parsed.playerCol ?? "player",
    teamCol: parsed.teamCol ?? "team",
    minutesCol: parsed.minutesCol ?? "minutes_played",
    metricCols: parsed.metricCols ?? {},
  };
}

// ── Scatter Plot Interpreter ──────────────────────────────────────────────────

export async function interpretScatterRequest(request: string): Promise<ScatterInterpretation> {
  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 500,
    messages: [{
      role: "user",
      content: `You are a football data assistant. A user wants a scatter plot.

User request: "${request}"

Task 0 — Genie Space Selection:
Choose the most appropriate Genie data space for this query:
- "general": player/team season stats, standings, aggregated metrics (goals, assists, minutes, xG, rankings, top scorers)
- "shots_events": shot/goal events with timing (last 10 min, first half, game state while winning/losing, shot origin: corners, free kicks, crosses)
- "passes_events": pass events — accuracy, cross types, long balls, progressive passes, passing zones, game-state passing patterns

Task 1 — Enhanced data spec for a SQL agent:
- Resolve "current"/"this season" → "filter to season 2025/2026"
- Per-90 metrics → "divide by NULLIF(minutes_played / 90.0, 0)"
- Position filter → add explicit position filter if named (e.g. "forwards", "midfielders", "defenders")
- Normalize entity names: "Man United" → "Manchester United", "Barca" → "Barcelona"
- League slugs: Premier League → england-premier-league, La Liga → spain-laliga, Bundesliga → germany-bundesliga, Serie A → italy-serie-a
- The SQL must return exactly 5 columns with aliases: player, team, league, x, y
- Be explicit about which metric maps to x and which to y

Task 2 — Chart labels:
- xLabel: x-axis metric label (e.g. "Goals")
- yLabel: y-axis metric label (e.g. "Assists")
- title: chart title (e.g. "Goals vs Assists")
- subtitle: short scope line — include league/position filter if specified, season, and "per 90" if metrics are per 90. Keep it concise (e.g. "Premier League · Forwards · 2025/26 · per 90", "Top 5 Leagues · 2025/26"). Do NOT include minimum minutes — it is appended automatically.
- DO NOT add "per 90" to xLabel/yLabel — just the metric name
Return ONLY JSON (no other text):
{ "enhancedRequest": "...", "xLabel": "...", "yLabel": "...", "title": "...", "subtitle": "...", "genieSpace": "general" }`,
    }],
  });
  const text = (response.content[0] as any).text as string;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`interpretScatterRequest: no JSON in response: ${text}`);
  const parsed = JSON.parse(match[0]);
  return {
    enhancedRequest: parsed.enhancedRequest ?? parsed.enhanced_request ?? request,
    xLabel: parsed.xLabel ?? parsed.x_label ?? "",
    yLabel: parsed.yLabel ?? parsed.y_label ?? "",
    title: parsed.title ?? "",
    subtitle: parsed.subtitle ?? "",
    genieSpace: parsed.genieSpace ?? "general",
  };
}
