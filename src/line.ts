import Anthropic from "@anthropic-ai/sdk";
import { v2 as cloudinary } from "cloudinary";
import { querySqlRaw, queryGenieForSQL } from "./genie";
import { niceTicks, escSvg, LEAGUE_COLORS, LEAGUE_NAMES, renderScatterPlot } from "./scatter";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LinePoint {
  season: string;
  league: string;
  value: number;
}

export interface LinePipelineParams {
  request: string;
  season_start?: string;
  season_end?: string;
  show_avg?: boolean;
}

export interface LinePipelineResult {
  drive_url: string;
  title: string;
  filename: string;
}

// ── Genie SQL Extraction + Data Fetch ─────────────────────────────────────────

interface LineLabels {
  valueLabel: string;
  title: string;
  subtitle: string;
}

async function generateLineLabels(request: string, sql: string): Promise<LineLabels> {
  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 200,
    messages: [{
      role: "user",
      content: `Given this SQL query for a football line chart:
\`\`\`sql
${sql}
\`\`\`

The column aliased AS value is the Y-axis metric. The column aliased AS x_axis (or season) is on the X-axis. The column aliased AS series (or league) is the grouping dimension.
Derive a human-readable axis label directly from the SQL — do NOT guess from the request text.
Return ONLY a JSON object (no other text):
{ "value_label": "...", "title": "...", "subtitle": "..." }
Title format examples: "Goals Conceded per Team · GW1–GW38", "Total Dribbles per League · 2010–2025"
Subtitle should be a single concise line describing scope, e.g. "Premier League 2024/25 · all teams".
Use the original request for context on scope: "${request}"`,
    }],
  });
  const text = (response.content[0] as any).text as string;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`generateLineLabels: no JSON in response: ${text}`);
  const parsed = JSON.parse(match[0]);
  return {
    valueLabel: parsed.valueLabel ?? parsed.value_label ?? "",
    title: parsed.title ?? "",
    subtitle: parsed.subtitle ?? "",
  };
}

async function buildLineData(
  request: string,
  seasonStart?: string,
  seasonEnd?: string
): Promise<{ data: LinePoint[] } & LineLabels> {
  const seasonFilter = seasonStart || seasonEnd
    ? `- Filter seasons: ${seasonStart ? `>= '${seasonStart}'` : ""}${seasonEnd ? ` <= '${seasonEnd}'` : ""}`
    : "- Include all available seasons";

  const geniePrompt = `For a football line chart, execute a SQL query for: "${request}"

Requirements for the SQL you generate and execute:
- SELECT exactly 3 columns with these EXACT aliases: x_axis, series, value
  - x_axis: the X-axis dimension (e.g. game_week AS x_axis, season AS x_axis)
  - series: the grouping/line dimension (e.g. team_name AS series, league AS series)
  - value: the numeric metric (e.g. SUM(goals_conceded) AS value)
  Examples:
    game_week AS x_axis, team_name AS series, SUM(goals_conceded) AS value
    season AS x_axis, league_name AS series, AVG(possession) AS value
- GROUP BY x_axis, series
- ORDER BY x_axis, series
${seasonFilter}
- LIMIT 500

Execute the query and return the results.`;

  console.log("[line] Querying Genie for SQL...");
  const spaceId = process.env.DATABRICKS_GENIE_SPACE_ID_GENERAL!;
  const { sql } = await queryGenieForSQL(spaceId, geniePrompt);

  if (!sql) {
    throw new Error("Genie did not generate a SQL query. Try rephrasing with more specific metric names.");
  }

  const fullSql = sql.replace(/\bLIMIT\s+\d+/gi, "").trim();
  console.log(`[line] Extracted SQL (no LIMIT):\n${fullSql}`);

  if (!/\bAS\s+value\b/i.test(fullSql)) {
    console.warn("[line] WARNING: SQL may be missing expected 'value' alias — results may be empty");
  }
  if (!/\bAS\s+x_axis\b/i.test(fullSql) && !/\bAS\s+season\b/i.test(fullSql)) {
    console.warn("[line] WARNING: SQL may be missing expected 'x_axis' alias — results may be empty");
  }

  const rows = await querySqlRaw(fullSql, 2000);
  const data = rows
    .map((r) => ({
      season: String(r["x_axis"] ?? r["season"] ?? ""),
      league: String(r["series"] ?? r["league"] ?? ""),
      value: parseFloat(r["value"] ?? "0") || 0,
    }))
    .filter((r) => r.season && r.league && isFinite(r.value));

  const labels = await generateLineLabels(request, fullSql);
  return { data, ...labels };
}

// ── SVG Line Chart ────────────────────────────────────────────────────────────

function isSeason(s: string): boolean {
  return /^\d{4}\/\d{4}$/.test(s);
}

function sortXValues(values: string[]): string[] {
  const sample = values[0] ?? "";
  if (isSeason(sample)) {
    return [...values].sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  }
  // Natural sort: compare text prefix then trailing number (handles GW1 < GW2 < GW10)
  return [...values].sort((a, b) => {
    const ma = a.match(/^(.*?)(\d+)$/);
    const mb = b.match(/^(.*?)(\d+)$/);
    if (ma && mb) {
      const cmp = ma[1].localeCompare(mb[1]);
      return cmp !== 0 ? cmp : parseInt(ma[2], 10) - parseInt(mb[2], 10);
    }
    return a.localeCompare(b);
  });
}

function formatXLabel(s: string): string {
  if (!isSeason(s)) return s;
  const [a, b] = s.split("/");
  return `${a.slice(2)}/${b.slice(2)}`; // "2020/2021" → "20/21"
}

const COLOR_PALETTE = [
  "#2ec4b6", "#e63946", "#f4a261", "#80b918",
  "#a8dadc", "#ff9f1c", "#6a4c93", "#3a86ff",
  "#ff006e", "#06d6a0", "#ffbe0b", "#fb5607",
  "#8338ec", "#ef476f", "#118ab2", "#ffd166",
];

const leagueDisplayName = (id: string) => LEAGUE_NAMES[id] ?? id;

function buildColorMap(groups: string[]): Map<string, string> {
  const map = new Map<string, string>();
  let idx = 0;
  for (const g of groups) {
    map.set(g, LEAGUE_COLORS[g] ?? COLOR_PALETTE[idx++ % COLOR_PALETTE.length]);
  }
  return map;
}

export function buildLineSvg(
  data: LinePoint[],
  opts: { valueLabel: string; title: string; subtitle?: string; showAvg?: boolean; watermark?: string }
): string {
  const W = 1400;

  const BG = "#0d1117";
  const WHITE = "#e6edf3";
  const GRAY = "#888888";

  // Sorted unique x-values and groups
  const seasons = sortXValues([...new Set(data.map((d) => d.season))]);
  const leagues = [...new Set(data.map((d) => d.league))].sort();
  const colorMap = buildColorMap(leagues);
  const leagueColor = (g: string) => colorMap.get(g) ?? "#8888aa";

  // Dynamic top padding: title block + legend rows (series + avg entry)
  const LEGEND_ITEMS_PER_ROW = 5;
  const TITLE_BLOCK_H = opts.subtitle ? 80 : 58;
  const LEGEND_ROW_H = 28;
  const legendLeagues = leagues.filter((l) => {
    const ldata = new Map<string, number>();
    for (const d of data) if (d.league === l) ldata.set(d.season, d.value);
    return ldata.size > 0;
  });
  const allLegendItems = [
    ...legendLeagues.map((league) => ({ label: leagueDisplayName(league), color: leagueColor(league), dash: "", dot: true })),
    ...(opts.showAvg ? [{ label: `avg ${opts.valueLabel}`, color: "#ffffff", dash: "6,4", dot: false }] : []),
  ];
  // itemW = swatch(44px) + text(~9px/char) + right gap(20px), minimum 160px
  const maxLabelChars = Math.max(...allLegendItems.map((it) => it.label.length));
  const itemW = Math.max(160, 44 + maxLabelChars * 9 + 20);
  const legendRows = Math.ceil(allLegendItems.length / LEGEND_ITEMS_PER_ROW);
  const legendBlockH = legendRows * LEGEND_ROW_H + 12;
  const topPad = TITLE_BLOCK_H + legendBlockH + 20;

  const PAD = { top: topPad, right: 50, bottom: 140, left: 120 };
  const plotW = W - PAD.left - PAD.right;
  const H = PAD.top + 700 + PAD.bottom; // fixed plot height of 700px
  const plotH = 700;

  // Group data: league → season → value
  const grouped = new Map<string, Map<string, number>>();
  for (const d of data) {
    if (!grouped.has(d.league)) grouped.set(d.league, new Map());
    grouped.get(d.league)!.set(d.season, d.value);
  }

  const values = data.map((d) => d.value);
  const vMax = Math.max(...values);
  const vMin = Math.min(...values);
  const yPad = (vMax - vMin) * 0.1 || 1;
  const yTicksRaw = niceTicks(Math.max(0, vMin - yPad), vMax + yPad);
  const yLo = yTicksRaw[0];
  const yHi = yTicksRaw[yTicksRaw.length - 1];

  const meanVal = values.reduce((a, b) => a + b, 0) / values.length;

  const pxByIdx = (i: number) =>
    PAD.left + (i / Math.max(seasons.length - 1, 1)) * plotW;
  const py = (v: number) =>
    PAD.top + plotH - ((v - yLo) / (yHi - yLo)) * plotH;

  const fmt = (v: number) => {
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `${(v / 1_000).toFixed(0)}k`;
    return Number.isInteger(v) ? String(v) : v.toFixed(1);
  };

  const parts: string[] = [];

  // Background
  parts.push(`<rect width="${W}" height="${H}" fill="${BG}"/>`);

  // Title + subtitle (right-aligned, top)
  parts.push(`<text x="${W - PAD.right}" y="42" text-anchor="end" fill="${WHITE}" font-size="36" font-weight="bold" font-family="-apple-system,sans-serif">${escSvg(opts.title)}</text>`);
  if (opts.subtitle) {
    parts.push(`<text x="${W - PAD.right}" y="68" text-anchor="end" fill="${GRAY}" font-size="22" font-family="-apple-system,sans-serif" opacity="0.8">${escSvg(opts.subtitle)}</text>`);
  }

  // Legend above chart — horizontal rows (series entries + avg entry)
  const legendStartY = TITLE_BLOCK_H + 8;
  allLegendItems.forEach(({ label, color, dash, dot }, i) => {
    const col = i % LEGEND_ITEMS_PER_ROW;
    const row = Math.floor(i / LEGEND_ITEMS_PER_ROW);
    const lx = col * itemW + 24;
    const ly = legendStartY + row * LEGEND_ROW_H;
    const dashAttr = dash ? ` stroke-dasharray="${dash}"` : "";
    const opacity = dash ? ` opacity="0.6"` : "";
    parts.push(`<line x1="${lx}" y1="${ly + 8}" x2="${lx + 28}" y2="${ly + 8}" stroke="${color}" stroke-width="2.5"${dashAttr}${opacity}/>`);
    if (dot) parts.push(`<circle cx="${lx + 14}" cy="${ly + 8}" r="4" fill="${color}"/>`);
    parts.push(`<text x="${lx + 36}" y="${ly + 13}" fill="${GRAY}" font-size="18" font-family="-apple-system,sans-serif">${escSvg(label)}</text>`);
  });

  // Horizontal grid lines (reduced opacity)
  for (const t of yTicksRaw) {
    const y = py(t);
    parts.push(`<line x1="${PAD.left}" y1="${y}" x2="${PAD.left + plotW}" y2="${y}" stroke="#444" stroke-width="0.5" stroke-dasharray="4,4" opacity="0.3"/>`);
  }

  // Vertical grid lines (per season, reduced opacity)
  for (let i = 0; i < seasons.length; i++) {
    const x = pxByIdx(i);
    parts.push(`<line x1="${x}" y1="${PAD.top}" x2="${x}" y2="${PAD.top + plotH}" stroke="#444" stroke-width="0.5" opacity="0.2"/>`);
  }

  // Mean reference line (optional)
  if (opts.showAvg) {
    const meanY = py(meanVal);
    parts.push(`<line x1="${PAD.left}" y1="${meanY}" x2="${PAD.left + plotW}" y2="${meanY}" stroke="#ffffff" stroke-width="1.5" stroke-dasharray="6,4" opacity="0.45"/>`);
    parts.push(`<text x="${PAD.left + plotW - 8}" y="${meanY - 6}" text-anchor="end" fill="#ffffff" font-size="18" font-family="monospace" opacity="0.5">${fmt(meanVal)}</text>`);
  }

  // Y-axis tick labels
  for (const t of yTicksRaw) {
    const y = py(t);
    parts.push(`<text x="${PAD.left - 12}" y="${y + 6}" text-anchor="end" fill="${GRAY}" font-size="22" font-family="monospace">${fmt(t)}</text>`);
  }

  // X-axis tick labels (rotated -45°)
  for (let i = 0; i < seasons.length; i++) {
    const x = pxByIdx(i);
    const label = formatXLabel(seasons[i]);
    const labelY = PAD.top + plotH + 18;
    parts.push(`<text x="${x}" y="${labelY}" text-anchor="end" fill="${GRAY}" font-size="20" font-family="monospace" transform="rotate(-45, ${x}, ${labelY})">${escSvg(label)}</text>`);
  }

  // Lines + dots per league (all solid, bold)
  for (const league of leagues) {
    const ldata = grouped.get(league);
    if (!ldata) continue;
    const color = leagueColor(league);

    const points = seasons
      .filter((s) => ldata.has(s))
      .map((s) => {
        const i = seasons.indexOf(s);
        return { x: pxByIdx(i), y: py(ldata.get(s)!), s };
      })
      .filter((p) => isFinite(p.y));

    if (points.length < 2) continue;

    let d = `M ${points[0].x},${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      d += ` L ${points[i].x},${points[i].y}`;
    }
    parts.push(`<path d="${d}" stroke="${color}" stroke-width="4" fill="none" opacity="0.9"/>`);

    for (const p of points) {
      parts.push(`<circle cx="${p.x}" cy="${p.y}" r="6" fill="${color}" opacity="0.95"/>`);
    }
  }

  // Y-axis label (rotated)
  parts.push(`<text x="${-(PAD.top + plotH / 2)}" y="28" text-anchor="middle" fill="${WHITE}" font-size="26" font-family="-apple-system,sans-serif" transform="rotate(-90)">${escSvg(opts.valueLabel)}</text>`);

  // Watermark (bottom-left)
  if (opts.watermark) {
    parts.push(`<text x="${PAD.left}" y="${H - 8}" text-anchor="start" fill="${GRAY}" font-size="18" font-family="-apple-system,sans-serif" opacity="0.7">${escSvg(opts.watermark)}</text>`);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">\n${parts.join("\n")}\n</svg>`;
}

// ── Cloudinary Upload ─────────────────────────────────────────────────────────

async function uploadLineToCloudinary(pngBuffer: Buffer, publicId: string): Promise<string> {
  cloudinary.config(process.env.CLOUDINARY_KEY!);

  const result = await new Promise<{ secure_url: string }>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { public_id: publicId, overwrite: true, resource_type: "image", folder: "line_charts" },
      (err, res) => { if (err || !res) reject(err ?? new Error("No response")); else resolve(res); }
    );
    stream.end(pngBuffer);
  });

  console.log(`[line] Cloudinary upload: ${result.secure_url}`);
  return result.secure_url;
}

// ── Pipeline Orchestrator ─────────────────────────────────────────────────────

export async function linePipeline(params: LinePipelineParams): Promise<LinePipelineResult> {
  const { request, season_start, season_end, show_avg } = params;

  console.log(`[line] Starting pipeline: "${request}"`);

  console.log("[line] Step 1: Genie SQL extraction + warehouse query");
  const { data, valueLabel, title, subtitle } = await buildLineData(request, season_start, season_end);
  const leagueCount = new Set(data.map((d) => d.league)).size;
  console.log(`[line] Data: ${data.length} rows across ${leagueCount} leagues`);
  if (data.length === 0) throw new Error("No data returned from Databricks for these filters.");

  console.log("[line] Step 2: generating SVG");
  const svgString = buildLineSvg(data, {
    valueLabel,
    title,
    subtitle,
    showAvg: show_avg ?? false,
    watermark: "@Mr.Champions · data: WhoScored",
  });

  console.log("[line] Step 3: rendering PNG via Puppeteer");
  const pngBuffer = await renderScatterPlot(svgString);

  console.log("[line] Step 4: uploading to Cloudinary");
  const safeTitle = title.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_·-]/g, "").slice(0, 60);
  const publicId = `line_${safeTitle}`;
  const drive_url = await uploadLineToCloudinary(pngBuffer, publicId);

  console.log(`[line] Done: ${drive_url}`);
  return { drive_url, title, filename: publicId };
}
