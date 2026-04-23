import Anthropic from "@anthropic-ai/sdk";
import { google } from "googleapis";
import { Readable } from "stream";
import puppeteer from "puppeteer-core";
import { queryGeneralStats, queryMatchEvents, queryPassEvents, querySqlRaw } from "./genie";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ScatterSchema {
  table: string;
  x_column: string;
  y_column: string;
  x_label: string;
  y_label: string;
  suggested_title: string;
  player_column: string;
  team_column: string;
  minutes_column: string;
  per90: boolean;
  filters: Record<string, string>;
}

export interface PlayerPoint {
  player: string;
  team: string;
  x: number;
  y: number;
}

export interface ScatterPipelineParams {
  request: string;
  highlight_players?: string[];
  min_minutes?: number;
  season?: string;
}

export interface ScatterPipelineResult {
  drive_url: string;
  title: string;
  player_count: number;
  filename: string;
}

// ── Schema Discovery ──────────────────────────────────────────────────────────

const GENIE_TOOLS: Anthropic.Tool[] = [
  {
    name: "query_general_stats",
    description: `Query player/team season-level stats, rankings, aggregations, defensive metrics.
Use for: goals, assists, shots, minutes played, position, leaderboards, crosses, dribbles, defensive actions.
League format: england-premier-league, spain-laliga, germany-bundesliga, italy-serie-a.
Current season = 2025/2026.`,
    input_schema: {
      type: "object" as const,
      properties: {
        question: { type: "string" },
        conversation_id: { type: "string" },
      },
      required: ["question"],
    },
  },
  {
    name: "query_match_events",
    description: `Query shot/goal timing, game-state context, xG, match events.
Use for: goals scored, shots, xG, match-level events.`,
    input_schema: {
      type: "object" as const,
      properties: {
        question: { type: "string" },
        conversation_id: { type: "string" },
      },
      required: ["question"],
    },
  },
  {
    name: "query_pass_events",
    description: `Query pass events, accuracy, zones, crosses, progressive passes, through balls.
Use for: pass accuracy, pass types, progressive passes, danger-zone passes, crosses.`,
    input_schema: {
      type: "object" as const,
      properties: {
        question: { type: "string" },
        conversation_id: { type: "string" },
      },
      required: ["question"],
    },
  },
];

export async function discoverSchema(userRequest: string): Promise<ScatterSchema> {
  const discoveryPrompt = `You are helping build a scatter plot for football data.

User request: "${userRequest}"

Your job:
1. Call the correct Genie space with a structured discovery question.
2. Ask Genie for: exact table name, exact column names for each metric, player/team/minutes columns, whether per-90 calculation is needed, and relevant filter values (position, league, season).
3. Parse the response and return a JSON object.

Discovery question template to send to Genie:
"For building a scatter plot of [metric X] vs [metric Y] for [player group], tell me:
1. Which table to query
2. Exact column name for [metric X]
3. Exact column name for [metric Y]
4. Exact column names for: player name, team name, minutes played
5. Relevant filter values (position, league, season)
6. Whether metrics need per-90 calculation (divide by minutes/90)
Respond with exact column names as they appear in the database."

After receiving the Genie response, output ONLY a JSON object (no other text) with this shape:
{
  "table": "<exact table name>",
  "x_column": "<column for x-axis metric>",
  "y_column": "<column for y-axis metric>",
  "x_label": "<human-readable x-axis label>",
  "y_label": "<human-readable y-axis label>",
  "suggested_title": "<concise plot title, e.g. 'Interceptions vs Key Passes · PL Midfielders 2025/26'>",
  "player_column": "<player name column>",
  "team_column": "<team name column>",
  "minutes_column": "<minutes played column>",
  "per90": true or false,
  "filters": { "league": "...", "season": "...", "position": "..." }
}`;

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: discoveryPrompt },
  ];

  const conversationIds: Record<string, string> = {};

  for (let i = 0; i < 4; i++) {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 2000,
      tools: GENIE_TOOLS,
      messages,
    });

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "end_turn") {
      const textBlock = response.content.find((b) => b.type === "text");
      if (!textBlock || textBlock.type !== "text") throw new Error("Schema discovery: no text response from Claude");
      const match = textBlock.text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error(`Schema discovery: Claude did not return valid JSON. Response: ${textBlock.text}`);
      return JSON.parse(match[0]) as ScatterSchema;
    }

    if (response.stop_reason !== "tool_use") break;

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      const input = block.input as { question: string; conversation_id?: string };
      const convId = input.conversation_id ?? conversationIds[block.name];
      let result: string;
      try {
        if (block.name === "query_general_stats") {
          result = await queryGeneralStats(input.question, convId);
        } else if (block.name === "query_match_events") {
          result = await queryMatchEvents(input.question, convId);
        } else {
          result = await queryPassEvents(input.question, convId);
        }
        const idMatch = result.match(/conversation_id[:\s]+([a-zA-Z0-9_-]+)/i);
        if (idMatch) conversationIds[block.name] = idMatch[1]!;
      } catch (err) {
        result = `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
    }
    messages.push({ role: "user", content: toolResults });
  }

  throw new Error("Schema discovery failed: Claude did not produce a final JSON schema.");
}

// ── SQL Generation via LLM ────────────────────────────────────────────────────

async function generateSql(userRequest: string, schema: ScatterSchema, minMinutes: number): Promise<string> {
  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 800,
    messages: [
      {
        role: "user",
        content: `You are a SQL expert. Write a Databricks SQL SELECT query for a scatter plot.

User request: "${userRequest}"

Schema discovered from the database:
${JSON.stringify(schema, null, 2)}

Requirements:
- Output ONLY the raw SQL — no markdown, no backticks, no explanation
- SELECT exactly 4 columns aliased as: player, team, x, y
- "x" = the x-axis metric (${schema.x_label}), "y" = the y-axis metric (${schema.y_label})
- If per90 is true, divide each metric by (minutes / 90), using NULLIF to avoid divide-by-zero
- Apply all filters from schema.filters
- Filter rows where minutes played >= ${minMinutes}
- ORDER BY x DESC
- Do not add a LIMIT clause`,
      },
    ],
  });

  const text = (response.content[0] as any).text as string;
  // Strip any accidental markdown fences
  return text.replace(/```sql\s*/gi, "").replace(/```\s*/g, "").trim();
}

// ── SQL Query → PlayerPoint[] ─────────────────────────────────────────────────

export async function queryScatterData(
  userRequest: string,
  schema: ScatterSchema,
  minMinutes = 900
): Promise<PlayerPoint[]> {
  const sql = await generateSql(userRequest, schema, minMinutes);
  console.log(`[scatter] Generated SQL:\n${sql}`);

  const rows = await querySqlRaw(sql, 150);

  return rows
    .map((r) => ({
      player: String(r["player"] ?? ""),
      team: String(r["team"] ?? ""),
      x: parseFloat(r["x"] ?? "0") || 0,
      y: parseFloat(r["y"] ?? "0") || 0,
    }))
    .filter((r) => r.player && isFinite(r.x) && isFinite(r.y));
}

// ── SVG Scatter Plot ──────────────────────────────────────────────────────────

interface ScatterPlotOptions {
  xLabel: string;
  yLabel: string;
  title: string;
  subtitle: string;
  highlightPlayers: string[];
  topNLabel?: number;
}

function buildScatterSvg(data: PlayerPoint[], opts: ScatterPlotOptions): string {
  const W = 1100, H = 750;
  const PAD = { top: 60, right: 40, bottom: 80, left: 80 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const BG = "#0d1117";
  const BLUE = "#3a86ff";
  const RED = "#ff006e";
  const WHITE = "#e6edf3";
  const GRAY = "#555555";
  const GRID = "#222222";

  const xs = data.map((d) => d.x);
  const ys = data.map((d) => d.y);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const xPad = (xMax - xMin) * 0.1 || 0.5;
  const yPad = (yMax - yMin) * 0.1 || 0.5;
  const xLo = xMin - xPad, xHi = xMax + xPad;
  const yLo = yMin - yPad, yHi = yMax + yPad;

  const px = (v: number) => PAD.left + ((v - xLo) / (xHi - xLo)) * plotW;
  const py = (v: number) => PAD.top + plotH - ((v - yLo) / (yHi - yLo)) * plotH;

  const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;

  // Rank players for auto-labelling (lower combined rank = better on both axes)
  const sortedX = [...xs].sort((a, b) => b - a);
  const sortedY = [...ys].sort((a, b) => b - a);
  const ranked = data.map((d) => ({
    ...d,
    combinedRank: sortedX.indexOf(d.x) + sortedY.indexOf(d.y),
  }));
  const topN = opts.topNLabel ?? 6;
  const autoLabelled = new Set(
    [...ranked].sort((a, b) => a.combinedRank - b.combinedRank).slice(0, topN).map((d) => d.player)
  );
  const labelSet = new Set([...autoLabelled, ...opts.highlightPlayers]);

  // Axis ticks
  const nTicks = 5;
  const xTicks = Array.from({ length: nTicks + 1 }, (_, i) => xLo + (i / nTicks) * (xHi - xLo));
  const yTicks = Array.from({ length: nTicks + 1 }, (_, i) => yLo + (i / nTicks) * (yHi - yLo));

  const fmt = (v: number) => v.toFixed(2);

  // Build SVG parts
  const parts: string[] = [];

  // Background
  parts.push(`<rect width="${W}" height="${H}" fill="${BG}"/>`);

  // Grid lines
  for (const t of xTicks) {
    const x = px(t);
    parts.push(`<line x1="${x}" y1="${PAD.top}" x2="${x}" y2="${PAD.top + plotH}" stroke="${GRID}" stroke-width="0.5"/>`);
  }
  for (const t of yTicks) {
    const y = py(t);
    parts.push(`<line x1="${PAD.left}" y1="${y}" x2="${PAD.left + plotW}" y2="${y}" stroke="${GRID}" stroke-width="0.5"/>`);
  }

  // Average reference lines
  parts.push(`<line x1="${px(meanX)}" y1="${PAD.top}" x2="${px(meanX)}" y2="${PAD.top + plotH}" stroke="${GRAY}" stroke-width="0.8" stroke-dasharray="4,4" opacity="0.7"/>`);
  parts.push(`<line x1="${PAD.left}" y1="${py(meanY)}" x2="${PAD.left + plotW}" y2="${py(meanY)}" stroke="${GRAY}" stroke-width="0.8" stroke-dasharray="4,4" opacity="0.7"/>`);

  // Axis lines
  parts.push(`<line x1="${PAD.left}" y1="${PAD.top}" x2="${PAD.left}" y2="${PAD.top + plotH}" stroke="${GRAY}" stroke-width="1"/>`);
  parts.push(`<line x1="${PAD.left}" y1="${PAD.top + plotH}" x2="${PAD.left + plotW}" y2="${PAD.top + plotH}" stroke="${GRAY}" stroke-width="1"/>`);

  // Tick labels
  for (const t of xTicks) {
    const x = px(t);
    parts.push(`<text x="${x}" y="${PAD.top + plotH + 18}" text-anchor="middle" fill="${GRAY}" font-size="9" font-family="monospace">${fmt(t)}</text>`);
  }
  for (const t of yTicks) {
    const y = py(t);
    parts.push(`<text x="${PAD.left - 8}" y="${y + 3}" text-anchor="end" fill="${GRAY}" font-size="9" font-family="monospace">${fmt(t)}</text>`);
  }

  // Dots (non-highlighted first, then highlighted on top)
  for (const d of data.filter((d) => !opts.highlightPlayers.includes(d.player))) {
    parts.push(`<circle cx="${px(d.x)}" cy="${py(d.y)}" r="5" fill="${BLUE}" opacity="0.65"/>`);
  }
  for (const d of data.filter((d) => opts.highlightPlayers.includes(d.player))) {
    parts.push(`<circle cx="${px(d.x)}" cy="${py(d.y)}" r="8" fill="${RED}" opacity="1"/>`);
  }

  // Labels
  for (const d of data.filter((d) => labelSet.has(d.player))) {
    const hi = opts.highlightPlayers.includes(d.player);
    const cx = px(d.x), cy = py(d.y);
    const tx = cx + 8, ty = cy - 5;
    // Stroke outline for legibility
    parts.push(`<text x="${tx}" y="${ty}" font-size="8.5" font-family="-apple-system,sans-serif" font-weight="${hi ? "bold" : "normal"}" fill="${BG}" stroke="${BG}" stroke-width="3" paint-order="stroke">${escSvg(d.player)}</text>`);
    parts.push(`<text x="${tx}" y="${ty}" font-size="8.5" font-family="-apple-system,sans-serif" font-weight="${hi ? "bold" : "normal"}" fill="${hi ? RED : WHITE}">${escSvg(d.player)}</text>`);
  }

  // Axis labels
  parts.push(`<text x="${PAD.left + plotW / 2}" y="${H - 8}" text-anchor="middle" fill="${WHITE}" font-size="12" font-family="-apple-system,sans-serif">${escSvg(opts.xLabel)}</text>`);
  parts.push(`<text x="${-(PAD.top + plotH / 2)}" y="18" text-anchor="middle" fill="${WHITE}" font-size="12" font-family="-apple-system,sans-serif" transform="rotate(-90)">${escSvg(opts.yLabel)}</text>`);

  // Title
  parts.push(`<text x="${W / 2}" y="38" text-anchor="middle" fill="${WHITE}" font-size="16" font-weight="bold" font-family="-apple-system,sans-serif">${escSvg(opts.title)}</text>`);

  // Subtitle
  parts.push(`<text x="${W / 2}" y="${H - 25}" text-anchor="middle" fill="${GRAY}" font-size="9" font-family="-apple-system,sans-serif">${escSvg(opts.subtitle)}</text>`);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">\n${parts.join("\n")}\n</svg>`;
}

function escSvg(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── Puppeteer Render ──────────────────────────────────────────────────────────

async function renderScatterPlot(svgString: string): Promise<Buffer> {
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>* { margin:0; padding:0; } body { background:#0d1117; display:inline-block; }</style>
</head><body>${svgString}</body></html>`;

  const executablePath =
    process.env.PUPPETEER_EXECUTABLE_PATH ??
    (process.platform === "win32"
      ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
      : "/usr/bin/chromium-browser");

  const browser = await puppeteer.launch({
    executablePath,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    headless: true,
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const el = await page.$("svg");
    if (!el) throw new Error("SVG element not found in rendered page");
    const screenshot = await el.screenshot({ type: "png" });
    return Buffer.from(screenshot);
  } finally {
    await browser.close();
  }
}

// ── Google Drive Upload (overwrite) ──────────────────────────────────────────

async function uploadScatterToDrive(pngBuffer: Buffer, filename: string): Promise<string> {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON!);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  const drive = google.drive({ version: "v3", auth });
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID!;

  const existing = await drive.files.list({
    q: `name='${filename}' and '${folderId}' in parents and trashed=false`,
    fields: "files(id)",
  });
  const existingFiles = existing.data.files ?? [];

  const media = { mimeType: "image/png", body: Readable.from(pngBuffer) };
  let fileId: string;

  if (existingFiles.length > 0) {
    fileId = existingFiles[0]!.id!;
    await drive.files.update({ fileId, media });
    console.log(`[scatter] Drive overwrite: ${filename} (id=${fileId})`);
  } else {
    const res = await drive.files.create({
      requestBody: { name: filename, parents: [folderId], mimeType: "image/png" },
      media,
      fields: "id",
    });
    fileId = res.data.id!;
    await drive.permissions.create({ fileId, requestBody: { role: "reader", type: "anyone" } });
    console.log(`[scatter] Drive create: ${filename} (id=${fileId})`);
  }

  return `https://drive.google.com/uc?export=view&id=${fileId}`;
}

// ── Pipeline Orchestrator ─────────────────────────────────────────────────────

export async function scatterPipeline(params: ScatterPipelineParams): Promise<ScatterPipelineResult> {
  const { request, highlight_players = [], min_minutes = 900, season = "2025/2026" } = params;

  console.log(`[scatter] Starting pipeline: "${request}"`);

  // 1. Schema discovery
  console.log("[scatter] Step 1: schema discovery via Genie");
  const schema = await discoverSchema(request);
  console.log(`[scatter] Schema: table=${schema.table} x=${schema.x_column} y=${schema.y_column} per90=${schema.per90}`);

  // 2. SQL query
  console.log("[scatter] Step 2: querying Databricks SQL");
  const data = await queryScatterData(request, schema, min_minutes);
  console.log(`[scatter] Data: ${data.length} players`);
  if (data.length === 0) throw new Error("No data returned from Databricks for these filters.");

  // 3. SVG generation
  console.log("[scatter] Step 3: generating SVG");
  const leagueLabel = schema.filters["league"] ?? "All Leagues";
  const subtitle = `Min. ${min_minutes} mins · ${season} · ${leagueLabel}`;
  const svgString = buildScatterSvg(data, {
    xLabel: schema.x_label,
    yLabel: schema.y_label,
    title: schema.suggested_title,
    subtitle,
    highlightPlayers: highlight_players,
  });

  // 4. Puppeteer render
  console.log("[scatter] Step 4: rendering PNG via Puppeteer");
  const pngBuffer = await renderScatterPlot(svgString);

  // 5. Drive upload
  console.log("[scatter] Step 5: uploading to Google Drive");
  const safeTitle = schema.suggested_title.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_·-]/g, "").slice(0, 60);
  const filename = `scatter_${safeTitle}_${season.replace(/\//g, "_")}.png`;
  const drive_url = await uploadScatterToDrive(pngBuffer, filename);

  console.log(`[scatter] Done: ${drive_url}`);
  return { drive_url, title: schema.suggested_title, player_count: data.length, filename };
}
