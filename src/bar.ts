import { v2 as cloudinary } from "cloudinary";
import { queryGenieRaw } from "./genie";
import { niceTicks, escSvg, renderScatterPlot, LEAGUE_COLORS, LEAGUE_NAMES } from "./scatter";
import { interpretBarRequest, structureBarData, BarInterpretation, BarPoint } from "./interpret-request";
import { resolveTeamLogo } from "./logos";

// ── Types ─────────────────────────────────────────────────────────────────────

export type GenieSpace = "general" | "shots_events" | "passes_events";
export type SortOrder = "desc" | "asc" | "natural";

const GENIE_SPACE_IDS: Record<GenieSpace, string> = {
  general: process.env.DATABRICKS_GENIE_SPACE_ID_GENERAL!,
  shots_events: process.env.DATABRICKS_GENIE_SPACE_ID_MATCH!,
  passes_events: process.env.DATABRICKS_GENIE_SPACE_ID_PASSES!,
};

export interface BarPipelineParams {
  request: string;
  sort_order?: SortOrder;
  genie_space?: GenieSpace;
}

export interface BarPipelineResult {
  drive_url: string;
  title: string;
  bar_count: number;
  filename: string;
}

// ── Data Fetching ─────────────────────────────────────────────────────────────

const MAX_BARS = 30;

async function buildBarData(
  request: string,
  genieSpace: GenieSpace = "general"
): Promise<{ points: BarPoint[]; meta: BarInterpretation }> {
  const meta = await interpretBarRequest(request);
  console.log("[bar] Interpretation complete, querying Genie...");

  const geniePrompt = `For a football horizontal bar chart, execute a SQL query for: "${meta.enhancedRequest}"

Return 2 or 3 columns:
1. A categorical grouping (season, team, player, etc.) for the Y axis
2. A numeric metric (goals, wins, xG, etc.) for the bar length
3. Optionally a separate name label to display inside the bar (e.g. top scorer's name) — only if different from column 1

Execute the query and return all results.`;

  const spaceId = GENIE_SPACE_IDS[genieSpace];
  const { columns, rows } = await queryGenieRaw(spaceId, geniePrompt);

  if (rows.length === 0) {
    throw new Error("Genie returned no data for this request.");
  }

  console.log(`[bar] Genie returned ${rows.length} rows with columns: ${columns.join(", ")}`);

  const points = await structureBarData(columns, rows, meta);
  console.log(`[bar] Structured ${points.length} bar points`);

  return { points, meta };
}

// ── Color helpers ─────────────────────────────────────────────────────────────

const COLOR_PALETTE = [
  "#38bdf8", "#f97316", "#a3e635", "#e879f9",
  "#fb7185", "#34d399", "#fbbf24", "#818cf8",
  "#f43f5e", "#22d3ee", "#84cc16", "#c084fc",
];

function buildCategoryColorMap(categories: string[]): Map<string, string> {
  const map = new Map<string, string>();
  let idx = 0;
  for (const cat of categories) {
    map.set(cat, LEAGUE_COLORS[cat] ?? COLOR_PALETTE[idx++ % COLOR_PALETTE.length]);
  }
  return map;
}

function categoryLabel(cat: string): string {
  return LEAGUE_NAMES[cat] ?? cat;
}

// ── SVG Bar Chart ─────────────────────────────────────────────────────────────

export function buildBarSvg(
  points: BarPoint[],
  meta: BarInterpretation,
  sortOrder: SortOrder = "desc"
): string {
  const W = 900;
  const BG = "#0d1117";
  const WHITE = "#e6edf3";
  const GRAY = "#8b949e";
  const DEFAULT_BAR_COLOR = "#38bdf8";
  const BAR_HEIGHT = 34;
  const BAR_GAP = 10;
  const LEFT_PAD = 200;
  const RIGHT_PAD = 90;
  const TOP_PAD_BASE = 100;
  const BOTTOM_PAD = 70;
  const CHART_W = W - LEFT_PAD - RIGHT_PAD;

  // Category color map (only built when categories exist)
  const categories = [...new Set(points.map((p) => p.category).filter(Boolean) as string[])];
  const hasCategories = categories.length > 1;
  const colorMap = hasCategories ? buildCategoryColorMap(categories) : null;
  const barColor = (p: BarPoint) =>
    hasCategories && p.category ? (colorMap!.get(p.category) ?? DEFAULT_BAR_COLOR) : DEFAULT_BAR_COLOR;

  // Legend height (only when multiple categories)
  const LEGEND_ROW_H = 28;
  const LEGEND_ITEMS_PER_ROW = 4;
  const legendRows = hasCategories ? Math.ceil(categories.length / LEGEND_ITEMS_PER_ROW) : 0;
  const LEGEND_H = legendRows * LEGEND_ROW_H + (hasCategories ? 12 : 0);
  const TOP_PAD = TOP_PAD_BASE + LEGEND_H;

  // Sort bars
  let sorted = [...points];
  if (sortOrder === "desc") {
    sorted.sort((a, b) => b.value - a.value);
  } else if (sortOrder === "asc") {
    sorted.sort((a, b) => a.value - b.value);
  }
  // "natural" keeps the order from Genie

  // Truncate
  let truncated = false;
  if (sorted.length > MAX_BARS) {
    sorted = sorted.slice(0, MAX_BARS);
    truncated = true;
  }

  const n = sorted.length;
  const plotH = n * (BAR_HEIGHT + BAR_GAP) - BAR_GAP;
  const H = TOP_PAD + plotH + BOTTOM_PAD + (truncated ? 24 : 0);

  // X-axis scale
  const maxVal = Math.max(...sorted.map((p) => p.value));
  const xTicks = niceTicks(0, maxVal);
  const xMax = xTicks[xTicks.length - 1];

  const xPx = (v: number) => (v / xMax) * CHART_W;

  const parts: string[] = [];

  // Background
  parts.push(`<rect width="${W}" height="${H}" fill="${BG}"/>`);

  // Title
  parts.push(`<text x="${W / 2}" y="46" text-anchor="middle" fill="${WHITE}" font-size="28" font-weight="bold" font-family="-apple-system,sans-serif">${escSvg(meta.title)}</text>`);
  if (meta.subtitle) {
    parts.push(`<text x="${W / 2}" y="72" text-anchor="middle" fill="${GRAY}" font-size="18" font-family="-apple-system,sans-serif" opacity="0.85">${escSvg(meta.subtitle)}</text>`);
  }

  // Legend (when multiple categories exist)
  if (hasCategories && colorMap) {
    const itemW = Math.floor(W / Math.min(categories.length, LEGEND_ITEMS_PER_ROW));
    categories.forEach((cat, i) => {
      const col = i % LEGEND_ITEMS_PER_ROW;
      const row = Math.floor(i / LEGEND_ITEMS_PER_ROW);
      const lx = col * itemW + 24;
      const ly = 88 + row * LEGEND_ROW_H;
      const color = colorMap.get(cat) ?? DEFAULT_BAR_COLOR;
      parts.push(`<rect x="${lx}" y="${ly}" width="14" height="14" fill="${color}" rx="2" opacity="0.9"/>`);
      parts.push(`<text x="${lx + 20}" y="${ly + 11}" fill="${GRAY}" font-size="15" font-family="-apple-system,sans-serif">${escSvg(categoryLabel(cat))}</text>`);
    });
  }

  // X-axis grid lines and tick labels
  for (const tick of xTicks) {
    const x = LEFT_PAD + xPx(tick);
    parts.push(`<line x1="${x}" y1="${TOP_PAD}" x2="${x}" y2="${TOP_PAD + plotH}" stroke="#444" stroke-width="0.5" stroke-dasharray="4,4" opacity="0.3"/>`);
    parts.push(`<text x="${x}" y="${TOP_PAD + plotH + 20}" text-anchor="middle" fill="${GRAY}" font-size="15" font-family="monospace">${tick % 1 === 0 ? tick : tick.toFixed(1)}</text>`);
  }

  // X-axis label
  parts.push(`<text x="${LEFT_PAD + CHART_W / 2}" y="${TOP_PAD + plotH + 44}" text-anchor="middle" fill="${WHITE}" font-size="17" font-family="-apple-system,sans-serif">${escSvg(meta.valueLabel)}</text>`);

  const LOGO_SIZE = 22;
  const LOGO_PADDING = 6;

  // Bars
  sorted.forEach((point, i) => {
    const barY = TOP_PAD + i * (BAR_HEIGHT + BAR_GAP);
    const barW = xPx(point.value);
    const color = barColor(point);

    // Y-axis label (right-aligned, vertically centered)
    const labelY = barY + BAR_HEIGHT / 2 + 5;
    parts.push(`<text x="${LEFT_PAD - 10}" y="${labelY}" text-anchor="end" fill="${WHITE}" font-size="15" font-family="-apple-system,sans-serif">${escSvg(point.yLabel)}</text>`);

    // Bar rectangle
    parts.push(`<rect x="${LEFT_PAD}" y="${barY}" width="${barW}" height="${BAR_HEIGHT}" fill="${color}" rx="3" opacity="0.9"/>`);

    // In-bar content (logo + player name) — only if bar is wide enough
    if (point.barLabel && barW > 120) {
      const logo = point.teamName ? resolveTeamLogo(point.teamName) : undefined;
      const logoY = barY + (BAR_HEIGHT - LOGO_SIZE) / 2;

      if (logo && barW > 160) {
        parts.push(`<image href="${logo}" x="${LEFT_PAD + 8}" y="${logoY}" width="${LOGO_SIZE}" height="${LOGO_SIZE}" preserveAspectRatio="xMidYMid meet"/>`);
        parts.push(`<text x="${LEFT_PAD + 8 + LOGO_SIZE + LOGO_PADDING}" y="${labelY}" text-anchor="start" fill="#ffffff" font-size="13" font-family="-apple-system,sans-serif" font-weight="600" opacity="0.95">${escSvg(point.barLabel)}</text>`);
      } else {
        parts.push(`<text x="${LEFT_PAD + 8}" y="${labelY}" text-anchor="start" fill="#ffffff" font-size="13" font-family="-apple-system,sans-serif" font-weight="600" opacity="0.95">${escSvg(point.barLabel)}</text>`);
      }
    }

    // Value label right of bar
    const valueStr = point.value % 1 === 0 ? String(point.value) : point.value.toFixed(1);
    parts.push(`<text x="${LEFT_PAD + barW + 8}" y="${labelY}" text-anchor="start" fill="${WHITE}" font-size="15" font-family="monospace" font-weight="bold">${escSvg(valueStr)}</text>`);
  });

  // Truncation note
  if (truncated) {
    parts.push(`<text x="${W / 2}" y="${H - 8}" text-anchor="middle" fill="${GRAY}" font-size="14" font-family="-apple-system,sans-serif" opacity="0.6">Showing top ${MAX_BARS} results</text>`);
  }

  // Watermark
  const wmY = TOP_PAD + plotH + (truncated ? 60 : 58);
  parts.push(`<text x="${LEFT_PAD}" y="${wmY}" text-anchor="start" fill="${GRAY}" font-size="13" font-family="-apple-system,sans-serif" opacity="0.5">@Mr.Champions · data: WhoScored</text>`);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">\n${parts.join("\n")}\n</svg>`;
}

// ── Cloudinary Upload ─────────────────────────────────────────────────────────

async function uploadBarToCloudinary(pngBuffer: Buffer, publicId: string): Promise<string> {
  cloudinary.config(process.env.CLOUDINARY_KEY!);

  const result = await new Promise<{ secure_url: string }>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { public_id: publicId, overwrite: true, resource_type: "image", folder: "bar_charts" },
      (err, res) => { if (err || !res) reject(err ?? new Error("No response")); else resolve(res); }
    );
    stream.end(pngBuffer);
  });

  console.log(`[bar] Cloudinary upload: ${result.secure_url}`);
  return result.secure_url;
}

// ── Pipeline Orchestrator ─────────────────────────────────────────────────────

export async function barPipeline(params: BarPipelineParams): Promise<BarPipelineResult> {
  const { request, sort_order = "desc", genie_space = "general" } = params;

  console.log(`[bar] Starting pipeline: "${request}"`);

  console.log("[bar] Step 1: Genie query + Claude structuring");
  const { points, meta } = await buildBarData(request, genie_space);
  if (points.length === 0) throw new Error("No data returned from Databricks for this request.");

  console.log("[bar] Step 2: generating SVG");
  const svgString = buildBarSvg(points, meta, sort_order);

  console.log("[bar] Step 3: rendering PNG via Puppeteer");
  const pngBuffer = await renderScatterPlot(svgString);

  console.log("[bar] Step 4: uploading to Cloudinary");
  const safeTitle = meta.title.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_·-]/g, "").slice(0, 60);
  const publicId = `bar_${safeTitle}`;
  const drive_url = await uploadBarToCloudinary(pngBuffer, publicId);

  console.log(`[bar] Done: ${drive_url}`);
  return { drive_url, title: meta.title, bar_count: points.length, filename: publicId };
}
