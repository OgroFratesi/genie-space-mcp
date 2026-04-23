import Anthropic from "@anthropic-ai/sdk";
import { google } from "googleapis";
import { Readable } from "stream";
import puppeteer from "puppeteer-core";
import { querySqlRaw, queryGenieForSQL } from "./genie";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

// ── Types ─────────────────────────────────────────────────────────────────────

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

// ── Genie SQL Extraction + Data Fetch ─────────────────────────────────────────

interface ScatterLabels {
  xLabel: string;
  yLabel: string;
  title: string;
}

async function generateLabels(request: string): Promise<ScatterLabels> {
  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 200,
    messages: [{
      role: "user",
      content: `Given this scatter plot request: "${request}"
Return ONLY a JSON object (no other text):
{ "x_label": "...", "y_label": "...", "title": "..." }
Title format example: "Goals p90 vs Assists p90 · PL Forwards 25/26"`,
    }],
  });
  const text = (response.content[0] as any).text as string;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`generateLabels: no JSON in response: ${text}`);
  const parsed = JSON.parse(match[0]);
  return {
    xLabel: parsed.xLabel ?? parsed.x_label ?? "",
    yLabel: parsed.yLabel ?? parsed.y_label ?? "",
    title: parsed.title ?? "",
  };
}

async function buildScatterData(
  request: string,
  minMinutes: number,
  season: string
): Promise<{ data: PlayerPoint[] } & ScatterLabels> {
  // Ask Genie with explicit alias instructions so the SQL has player/team/x/y columns
  const geniePrompt = `For a football scatter plot, execute a SQL query for this request: "${request}"

Requirements for the SQL you generate and execute:
- SELECT exactly 4 columns with these EXACT aliases: player, team, x, y
  (e.g. playerName AS player, teamName AS team, [x_metric] AS x, [y_metric] AS y)
- If the request asks for per-90 metrics, divide by NULLIF(minutes_played / 90.0, 0)
- Apply the correct filters for league, season (default: ${season}), position
- Filter to players with at least ${minMinutes} minutes played
- LIMIT 20

Execute the query and return the results.`;

  console.log("[scatter] Querying Genie for SQL...");
  const spaceId = process.env.DATABRICKS_GENIE_SPACE_ID_GENERAL!;
  const { sql } = await queryGenieForSQL(spaceId, geniePrompt);

  if (!sql) {
    throw new Error("Genie did not generate a SQL query for this request. Try rephrasing with more specific metric names.");
  }

  // Strip LIMIT clause — we want the full dataset
  const fullSql = sql.replace(/\bLIMIT\s+\d+/gi, "").trim();
  console.log(`[scatter] Extracted SQL (no LIMIT):\n${fullSql}`);

  // Warn if aliases look wrong
  if (!/\bAS\s+x\b/i.test(fullSql) || !/\bAS\s+y\b/i.test(fullSql)) {
    console.warn("[scatter] WARNING: SQL may be missing expected x/y aliases — results may be empty");
  }

  const rows = await querySqlRaw(fullSql, 150);
  const data = rows
    .map((r) => ({
      player: String(r["player"] ?? ""),
      team: String(r["team"] ?? ""),
      x: parseFloat(r["x"] ?? "0") || 0,
      y: parseFloat(r["y"] ?? "0") || 0,
    }))
    .filter((r) => r.player && isFinite(r.x) && isFinite(r.y));

  const labels = await generateLabels(request);
  return { data, ...labels };
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

  // 1. Ask Genie for SQL, extract it, run full query, generate labels
  console.log("[scatter] Step 1: Genie SQL extraction + warehouse query");
  const { data, xLabel, yLabel, title } = await buildScatterData(request, min_minutes, season);
  console.log(`[scatter] Data: ${data.length} players`);
  if (data.length === 0) throw new Error("No data returned from Databricks for these filters.");

  // 2. SVG generation
  console.log("[scatter] Step 2: generating SVG");
  const subtitle = `Min. ${min_minutes} mins · ${season}`;
  const svgString = buildScatterSvg(data, {
    xLabel,
    yLabel,
    title,
    subtitle,
    highlightPlayers: highlight_players,
  });

  // 3. Puppeteer render
  console.log("[scatter] Step 3: rendering PNG via Puppeteer");
  const pngBuffer = await renderScatterPlot(svgString);

  // 4. Drive upload
  console.log("[scatter] Step 4: uploading to Google Drive");
  const safeTitle = title.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_·-]/g, "").slice(0, 60);
  const filename = `scatter_${safeTitle}_${season.replace(/\//g, "_")}.png`;
  const drive_url = await uploadScatterToDrive(pngBuffer, filename);

  console.log(`[scatter] Done: ${drive_url}`);
  return { drive_url, title, player_count: data.length, filename };
}
