import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LineInterpretation {
  enhancedRequest: string;
  xLabel: string;
  valueLabel: string;
  title: string;
  subtitle: string;
}

export interface ScatterInterpretation {
  enhancedRequest: string;
  xLabel: string;
  yLabel: string;
  title: string;
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
{ "enhancedRequest": "...", "xLabel": "...", "valueLabel": "...", "title": "...", "subtitle": "..." }`,
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

Task 1 — Enhanced data spec for a SQL agent:
- Resolve "current"/"this season" → "filter to season 2025/2026"
- Per-90 metrics → "divide by NULLIF(minutes_played / 90.0, 0)"
- Position filter → add explicit position filter if named (e.g. "forwards", "midfielders", "defenders")
- Normalize entity names: "Man United" → "Manchester United", "Barca" → "Barcelona"
- League slugs: Premier League → england-premier-league, La Liga → spain-laliga, Bundesliga → germany-bundesliga, Serie A → italy-serie-a
- The SQL must return exactly 5 columns with aliases: player, team, league, x, y
- Be explicit about which metric maps to x and which to y

Task 2 — Chart labels:
- xLabel: x-axis metric label (e.g. "Goals per 90")
- yLabel: y-axis metric label (e.g. "Assists per 90")
- title: chart title (e.g. "Goals vs Assists per 90 · PL Forwards 25/26")

Return ONLY JSON (no other text):
{ "enhancedRequest": "...", "xLabel": "...", "yLabel": "...", "title": "..." }`,
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
  };
}
