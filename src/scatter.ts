import { v2 as cloudinary } from "cloudinary";
import puppeteer from "puppeteer-core";
import { querySqlRaw, queryGenieForSQL } from "./genie";
import { interpretScatterRequest, ScatterInterpretation } from "./interpret-request";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PlayerPoint {
  player: string;
  team: string;
  league: string;
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

async function buildScatterData(
  request: string,
  minMinutes: number,
  season: string
): Promise<{ data: PlayerPoint[] } & Omit<ScatterInterpretation, "enhancedRequest">> {
  const { enhancedRequest, xLabel, yLabel, title } = await interpretScatterRequest(request);
  console.log("[scatter] Interpretation complete, querying Genie...");

  const geniePrompt = `For a football scatter plot, execute a SQL query for this request: "${enhancedRequest}"

Requirements for the SQL you generate and execute:
- SELECT exactly 5 columns with these EXACT aliases: player, team, league, x, y
  (e.g. playerName AS player, teamName AS team, leagueName AS league, [x_metric] AS x, [y_metric] AS y)
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

  const rows = await querySqlRaw(fullSql, 2000);
  const data = rows
    .map((r) => ({
      player: String(r["player"] ?? ""),
      team: String(r["team"] ?? ""),
      league: String(r["league"] ?? ""),
      x: parseFloat(r["x"] ?? "0") || 0,
      y: parseFloat(r["y"] ?? "0") || 0,
    }))
    .filter((r) => r.player && isFinite(r.x) && isFinite(r.y));

  return { data, xLabel, yLabel, title };
}

// ── SVG Scatter Plot ──────────────────────────────────────────────────────────

interface ScatterPlotOptions {
  xLabel: string;
  yLabel: string;
  title: string;
  subtitle: string;
  highlightPlayers: string[];
  topNLabel?: number;
  watermark?: string;
}

// Produces clean rounded tick values spanning [lo, hi]
export function niceTicks(lo: number, hi: number, target = 6): number[] {
  const range = hi - lo;
  const rough = range / (target - 1);
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  const step = norm < 1.5 ? mag : norm < 3 ? 2 * mag : norm < 7 ? 5 * mag : 10 * mag;
  const niceMin = Math.floor(lo / step) * step;
  const niceMax = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let t = niceMin; t <= niceMax + step * 0.01; t += step) {
    ticks.push(parseFloat((Math.round(t / step) * step).toPrecision(10)));
  }
  return ticks;
}

export const LEAGUE_COLORS: Record<string, string> = {
  "england-premier-league": "#2ec4b6",
  "spain-laliga":           "#e63946",
  "germany-bundesliga":     "#f4a261",
  "italy-serie-a":          "#80b918",
  "Ligue 1":                "#a8dadc",
  "Eredivisie":             "#ff9f1c",
  "Primeira Liga":          "#6a4c93",
  "Championship":           "#80b918",
};

export const LEAGUE_NAMES: Record<string, string> = {
  "england-premier-league": "Premier League",
  "spain-laliga":           "La Liga",
  "germany-bundesliga":     "Bundesliga",
  "italy-serie-a":          "Serie A",
  "france-ligue-1":         "Ligue 1",
  "netherlands-eredivisie": "Eredivisie",
  "portugal-primeira-liga": "Primeira Liga",
  "england-championship":   "Championship",
};
const LEAGUE_FALLBACK = "#8888aa";

// Iterative force-directed label repulsion
interface LabelState { x: number; y: number; dotX: number; dotY: number; }

function repelLabels(labels: LabelState[], iters = 80): LabelState[] {
  const W = 130, H = 24;
  const positions = labels.map(l => ({ ...l }));
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < positions.length; i++) {
      let dx = 0, dy = 0;
      // Repel from other labels
      for (let j = 0; j < positions.length; j++) {
        if (i === j) continue;
        const ox = positions[i].x - positions[j].x;
        const oy = positions[i].y - positions[j].y;
        if (Math.abs(ox) < W && Math.abs(oy) < H) {
          dx += (ox >= 0 ? 1 : -1) * (W - Math.abs(ox)) * 0.25;
          dy += (oy >= 0 ? 1 : -1) * (H - Math.abs(oy)) * 0.25;
        }
      }
      // Repel from own dot
      const dox = positions[i].x - positions[i].dotX;
      const doy = positions[i].y - positions[i].dotY;
      const dist = Math.sqrt(dox * dox + doy * doy) || 1;
      const minDist = 18;
      if (dist < minDist) {
        dx += (dox / dist) * (minDist - dist) * 0.5;
        dy += (doy / dist) * (minDist - dist) * 0.5;
      }
      positions[i].x += dx * 0.4;
      positions[i].y += dy * 0.4;
    }
  }
  return positions;
}

export function buildScatterSvg(data: PlayerPoint[], opts: ScatterPlotOptions): string {
  const W = 1400, H = 950;
  const PAD = { top: 80, right: 50, bottom: 120, left: 120 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const BG = "#0d1117";
  const RED = "#ff006e";
  const WHITE = "#e6edf3";
  const GRAY = "#888888";
  const GRID = "#2a2a2a";

  const leagueColor = (league: string) => LEAGUE_COLORS[league] ?? LEAGUE_FALLBACK;

  // Build sorted unique league list for legend (ordered by frequency)
  const leagueFreq = new Map<string, number>();
  for (const d of data) leagueFreq.set(d.league, (leagueFreq.get(d.league) ?? 0) + 1);
  const leagues = [...leagueFreq.entries()].sort((a, b) => b[1] - a[1]).map(([l]) => l);

  const xs = data.map((d) => d.x);
  const ys = data.map((d) => d.y);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const xPad = (xMax - xMin) * 0.1 || 0.5;
  const yPad = (yMax - yMin) * 0.1 || 0.5;

  // Generate nice ticks first, then snap domain to their bounds
  const xTicksRaw = niceTicks(xMin - xPad, xMax + xPad);
  const yTicksRaw = niceTicks(yMin - yPad, yMax + yPad);
  const xLo = xTicksRaw[0], xHi = xTicksRaw[xTicksRaw.length - 1];
  const yLo = yTicksRaw[0], yHi = yTicksRaw[yTicksRaw.length - 1];

  const px = (v: number) => PAD.left + ((v - xLo) / (xHi - xLo)) * plotW;
  const py = (v: number) => PAD.top + plotH - ((v - yLo) / (yHi - yLo)) * plotH;

  const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;

  // Rank players for auto-labelling
  const sortedX = [...xs].sort((a, b) => b - a);
  const sortedY = [...ys].sort((a, b) => b - a);
  const ranked = data.map((d) => ({
    ...d,
    combinedRank: sortedX.indexOf(d.x) + sortedY.indexOf(d.y),
  }));
  const topN = opts.topNLabel ?? 6;
  // Top combined (best on both axes)
  const topCombined = [...ranked].sort((a, b) => a.combinedRank - b.combinedRank).slice(0, topN).map((d) => d.player);
  // Top 3 by X axis only
  const topByX = [...data].sort((a, b) => b.x - a.x).slice(0, 3).map((d) => d.player);
  // Top 3 by Y axis only
  const topByY = [...data].sort((a, b) => b.y - a.y).slice(0, 3).map((d) => d.player);
  const autoLabelled = new Set([...topCombined, ...topByX, ...topByY]);
  const labelSet = new Set([...autoLabelled, ...opts.highlightPlayers]);

  const xTicks = xTicksRaw;
  const yTicks = yTicksRaw;

  const fmt = (v: number) => Number.isInteger(v) ? String(v) : v.toFixed(2);

  // Build SVG parts
  const parts: string[] = [];

  // Background
  parts.push(`<rect width="${W}" height="${H}" fill="${BG}"/>`);

  // Quadrant shading (split at mean X / mean Y)
  const mx = px(meanX), my = py(meanY);
  const qLeft = PAD.left, qTop = PAD.top;
  const qRight = PAD.left + plotW, qBottom = PAD.top + plotH;
  // top-left: high Y, low X
  parts.push(`<rect x="${qLeft}" y="${qTop}" width="${mx - qLeft}" height="${my - qTop}" fill="#3a86ff" opacity="0.09"/>`);
  // top-right: high Y, high X — best on both
  parts.push(`<rect x="${mx}" y="${qTop}" width="${qRight - mx}" height="${my - qTop}" fill="#06d6a0" opacity="0.10"/>`);
  // bottom-left: low Y, low X
  parts.push(`<rect x="${qLeft}" y="${my}" width="${mx - qLeft}" height="${qBottom - my}" fill="#ff006e" opacity="0.09"/>`);
  // bottom-right: low Y, high X
  parts.push(`<rect x="${mx}" y="${my}" width="${qRight - mx}" height="${qBottom - my}" fill="#ffbe0b" opacity="0.09"/>`);

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
  parts.push(`<line x1="${PAD.left}" y1="${PAD.top}" x2="${PAD.left}" y2="${PAD.top + plotH}" stroke="${GRAY}" stroke-width="1.5"/>`);
  parts.push(`<line x1="${PAD.left}" y1="${PAD.top + plotH}" x2="${PAD.left + plotW}" y2="${PAD.top + plotH}" stroke="${GRAY}" stroke-width="1.5"/>`);

  // Tick labels
  for (const t of xTicks) {
    const x = px(t);
    parts.push(`<text x="${x}" y="${PAD.top + plotH + 28}" text-anchor="middle" fill="${GRAY}" font-size="22" font-family="monospace">${fmt(t)}</text>`);
  }
  for (const t of yTicks) {
    const y = py(t);
    parts.push(`<text x="${PAD.left - 12}" y="${y + 6}" text-anchor="end" fill="${GRAY}" font-size="22" font-family="monospace">${fmt(t)}</text>`);
  }

  // Dots (non-highlighted first, then highlighted on top)
  for (const d of data.filter((d) => !opts.highlightPlayers.includes(d.player))) {
    parts.push(`<circle cx="${px(d.x)}" cy="${py(d.y)}" r="7" fill="${leagueColor(d.league)}" opacity="0.65"/>`);
  }
  for (const d of data.filter((d) => opts.highlightPlayers.includes(d.player))) {
    parts.push(`<circle cx="${px(d.x)}" cy="${py(d.y)}" r="10" fill="${RED}" opacity="0.9"/>`);
  }

  // Force-directed label placement
  const labelledPoints = data.filter((d) => labelSet.has(d.player));
  const initial = labelledPoints.map((d) => ({
    x: px(d.x) + 14,
    y: py(d.y) - 10,
    dotX: px(d.x),
    dotY: py(d.y),
  }));
  const settled = repelLabels(initial);

  for (let i = 0; i < labelledPoints.length; i++) {
    const d = labelledPoints[i];
    const hi = opts.highlightPlayers.includes(d.player);
    const { x: tx, y: ty, dotX, dotY } = settled[i];
    const dist = Math.sqrt((tx - dotX) ** 2 + (ty - dotY) ** 2);
    // Connector line when label has drifted away from its dot
    if (dist > 22) {
      parts.push(`<line x1="${dotX}" y1="${dotY}" x2="${tx}" y2="${ty}" stroke="${GRAY}" stroke-width="0.8" opacity="0.5"/>`);
    }
    parts.push(`<text x="${tx}" y="${ty}" font-size="20" font-family="-apple-system,sans-serif" font-weight="${hi ? "bold" : "normal"}" fill="${BG}" stroke="${BG}" stroke-width="4" paint-order="stroke">${escSvg(d.player)}</text>`);
    parts.push(`<text x="${tx}" y="${ty}" font-size="20" font-family="-apple-system,sans-serif" font-weight="${hi ? "bold" : "normal"}" fill="${hi ? RED : WHITE}">${escSvg(d.player)}</text>`);
  }

  // Axis labels
  parts.push(`<text x="${PAD.left + plotW / 2}" y="${H - 10}" text-anchor="middle" fill="${WHITE}" font-size="30" font-family="-apple-system,sans-serif">${escSvg(opts.xLabel)}</text>`);
  parts.push(`<text x="${-(PAD.top + plotH / 2)}" y="28" text-anchor="middle" fill="${WHITE}" font-size="30" font-family="-apple-system,sans-serif" transform="rotate(-90)">${escSvg(opts.yLabel)}</text>`);

  // Title (right-aligned)
  parts.push(`<text x="${W - PAD.right}" y="52" text-anchor="end" fill="${WHITE}" font-size="36" font-weight="bold" font-family="-apple-system,sans-serif">${escSvg(opts.title)}</text>`);

  // League legend (top-left, stacked)
  leagues.forEach((league, i) => {
    const lx = PAD.left;
    const ly = PAD.top + 24 + i * 26;
    parts.push(`<circle cx="${lx + 8}" cy="${ly - 6}" r="6" fill="${leagueColor(league)}" opacity="0.85"/>`);
    parts.push(`<text x="${lx + 20}" y="${ly}" fill="${GRAY}" font-size="18" font-family="-apple-system,sans-serif">${escSvg(league)}</text>`);
  });

  // Subtitle
  parts.push(`<text x="${W - PAD.right}" y="${H - 20}" text-anchor="end" fill="${GRAY}" font-size="20" font-family="-apple-system,sans-serif">${escSvg(opts.subtitle)}</text>`);

  // Watermark (bottom-left)
  if (opts.watermark) {
    parts.push(`<text x="${PAD.left}" y="${H - 20}" text-anchor="start" fill="${GRAY}" font-size="18" font-family="-apple-system,sans-serif" opacity="0.7">${escSvg(opts.watermark)}</text>`);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">\n${parts.join("\n")}\n</svg>`;
}

export function escSvg(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── Puppeteer Render ──────────────────────────────────────────────────────────

export async function renderScatterPlot(svgString: string): Promise<Buffer> {
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

// ── Cloudinary Upload ─────────────────────────────────────────────────────────

async function uploadToCloudinary(pngBuffer: Buffer, publicId: string): Promise<string> {
  cloudinary.config(process.env.CLOUDINARY_KEY!);

  const result = await new Promise<{ secure_url: string }>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { public_id: publicId, overwrite: true, resource_type: "image", folder: "scatter_plots" },
      (err, res) => { if (err || !res) reject(err ?? new Error("No response")); else resolve(res); }
    );
    stream.end(pngBuffer);
  });

  console.log(`[scatter] Cloudinary upload: ${result.secure_url}`);
  return result.secure_url;
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
    watermark: "@Mr.Champions · data: WhoScored",
  });

  // 3. Puppeteer render
  console.log("[scatter] Step 3: rendering PNG via Puppeteer");
  const pngBuffer = await renderScatterPlot(svgString);

  // 4. Cloudinary upload
  console.log("[scatter] Step 4: uploading to Cloudinary");
  const safeTitle = title.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_·-]/g, "").slice(0, 60);
  const publicId = `scatter_${safeTitle}_${season.replace(/\//g, "_")}`;
  const drive_url = await uploadToCloudinary(pngBuffer, publicId);

  console.log(`[scatter] Done: ${drive_url}`);
  return { drive_url, title, player_count: data.length, filename: publicId };
}
