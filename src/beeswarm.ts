import { v2 as cloudinary } from "cloudinary";
import { queryGenieForSQL, querySqlRaw } from "./genie";
import { niceTicks, escSvg, renderScatterPlot } from "./scatter";
import { interpretBeeswarmRequest, BeeswarmInterpretation } from "./interpret-request";
import { resolveTeamLogo } from "./logos";

// ── Types ─────────────────────────────────────────────────────────────────────

export type GenieSpace = "general" | "shots_events" | "passes_events";

const GENIE_SPACE_IDS: Record<GenieSpace, string> = {
  general: process.env.DATABRICKS_GENIE_SPACE_ID_GENERAL!,
  shots_events: process.env.DATABRICKS_GENIE_SPACE_ID_MATCH!,
  passes_events: process.env.DATABRICKS_GENIE_SPACE_ID_PASSES!,
};

export interface BeeswarmPipelineParams {
  request: string;
  min_minutes?: number;
  season?: string;
  genie_space?: GenieSpace;
}

export interface BeeswarmPipelineResult {
  drive_url: string;
  title: string;
  player_count: number;
  filename: string;
}

interface SwarmPoint {
  player: string;
  value: number;
  px: number;
  py: number;
  r: number;
  isTarget: boolean;
  pctRank: number;
}

// ── Layout Constants ──────────────────────────────────────────────────────────

const CANVAS_W = 1400;
const PAD_LEFT = 240;
const PAD_RIGHT = 50;
const PLOT_W = CANVAS_W - PAD_LEFT - PAD_RIGHT;
const TITLE_H = 90;
const STRIP_H = 185;
const FOOTER_H = 55;
const DOT_R = 4;
const TARGET_R = 7;
const TARGET_COLOR = "#f97316";
const DOT_COLOR = "#4a5568";
const BG_COLOR = "#0d1117";
const GRAY = "#8b949e";
const MAX_SWAY = 50;

// ── Swarm Layout ──────────────────────────────────────────────────────────────

function computeSwarm(
  rawPoints: { player: string; value: number; isTarget: boolean }[],
): SwarmPoint[] {
  if (rawPoints.length === 0) return [];

  const values = rawPoints.map((p) => p.value);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const range = hi - lo || 1;
  const xScale = (v: number) => PAD_LEFT + ((v - lo) / range) * PLOT_W;

  const sorted = [...rawPoints].sort((a, b) => a.value - b.value);
  const total = sorted.length;
  const placed: SwarmPoint[] = [];

  for (const pt of sorted) {
    const r = pt.isTarget ? TARGET_R : DOT_R;
    const px = xScale(pt.value);

    const below = rawPoints.filter((p) => p.value < pt.value).length;
    const pctRank = Math.round((below / total) * 100);

    let py = 0;
    let placed_at = false;

    for (let step = 0; step <= MAX_SWAY && !placed_at; step += 2) {
      for (const candidate of step === 0 ? [0] : [step, -step]) {
        const collides = placed.some(
          (other) => Math.hypot(px - other.px, candidate - other.py) < r + other.r + 1.5,
        );
        if (!collides) {
          py = candidate;
          placed_at = true;
          break;
        }
      }
    }

    placed.push({ player: pt.player, value: pt.value, px, py, r, isTarget: pt.isTarget, pctRank });
  }

  return placed;
}

// ── Data Fetching ─────────────────────────────────────────────────────────────

async function buildBeeswarmData(
  request: string,
  season: string,
  minMinutes: number,
  genieSpaceOverride?: GenieSpace,
): Promise<{
  strips: SwarmPoint[][];
  meta: BeeswarmInterpretation;
  playerCount: number;
  logoDataUri: string | undefined;
}> {
  const meta = await interpretBeeswarmRequest(request, season, minMinutes);
  const effectiveSpace: GenieSpace = genieSpaceOverride ?? meta.genieSpace;

  console.log(
    `[beeswarm] player="${meta.player_name}", metrics=${JSON.stringify(meta.metrics)}, space=${effectiveSpace}`,
  );

  const spaceId = GENIE_SPACE_IDS[effectiveSpace];
  const { sql } = await queryGenieForSQL(spaceId, meta.enhancedRequest);

  if (!sql) {
    throw new Error(
      "Genie did not generate a SQL query. Try rephrasing with more specific metric names.",
    );
  }

  const fullSql = sql.replace(/\bLIMIT\s+\d+/gi, "").trim();
  console.log(`[beeswarm] SQL (no LIMIT):\n${fullSql}`);

  const rows = await querySqlRaw(fullSql, 2000);

  // Filter by minutes — try both common column name variants
  const filtered = rows.filter((r) => {
    const mins = Number(r["minutes_played"] ?? r["minutes"] ?? 9999);
    return mins >= minMinutes;
  });

  if (filtered.length === 0) {
    throw new Error("No data returned from Databricks for these filters.");
  }

  const targetNorm = meta.player_name.toLowerCase().trim();
  const targetRow = filtered.find(
    (r) => String(r["player"] ?? "").toLowerCase().trim() === targetNorm,
  );

  const logoDataUri = targetRow
    ? resolveTeamLogo(String(targetRow["team"] ?? ""))
    : undefined;

  const strips: SwarmPoint[][] = meta.metrics.map((metric) => {
    const rawPoints = filtered
      .map((r) => ({
        player: String(r["player"] ?? ""),
        value: parseFloat(String(r[metric] ?? "")) || 0,
        isTarget: String(r["player"] ?? "").toLowerCase().trim() === targetNorm,
      }))
      .filter((p) => p.player && isFinite(p.value));

    if (rawPoints.length === 0) {
      console.warn(`[beeswarm] No valid values for metric "${metric}"`);
    }
    return computeSwarm(rawPoints);
  });

  return { strips, meta, playerCount: filtered.length, logoDataUri };
}

// ── SVG Generation ─────────────────────────────────────────────────────────────

function buildBeeswarmSvg(
  strips: SwarmPoint[][],
  meta: BeeswarmInterpretation,
  season: string,
  minMinutes: number,
  logoDataUri: string | undefined,
): string {
  const numStrips = strips.length;
  const H = TITLE_H + numStrips * STRIP_H + FOOTER_H;
  const W = CANVAS_W;
  const parts: string[] = [];

  parts.push(`<rect width="${W}" height="${H}" fill="${BG_COLOR}"/>`);

  if (logoDataUri) {
    parts.push(`<image href="${logoDataUri}" x="24" y="14" width="62" height="62" opacity="0.9"/>`);
  }

  parts.push(
    `<text x="${W - 30}" y="42" text-anchor="end" fill="white" font-size="24" font-weight="700" font-family="-apple-system,sans-serif">${escSvg(meta.title)}</text>`,
  );
  parts.push(
    `<text x="${W - 30}" y="68" text-anchor="end" fill="${GRAY}" font-size="15" font-family="-apple-system,sans-serif">${escSvg(season)} · min. ${minMinutes} min.</text>`,
  );

  parts.push(
    `<line x1="${PAD_LEFT}" y1="${TITLE_H}" x2="${W - PAD_RIGHT}" y2="${TITLE_H}" stroke="${GRAY}" stroke-width="0.5" opacity="0.3"/>`,
  );

  for (let i = 0; i < numStrips; i++) {
    const points = strips[i];
    const label = meta.metric_labels[i] ?? meta.metrics[i] ?? "";
    const stripTop = TITLE_H + i * STRIP_H;
    const swarmCY = stripTop + 80;
    const tickY = swarmCY + MAX_SWAY + 8;
    const tickLabelY = tickY + 16;
    const metricLabelY = stripTop + STRIP_H / 2 + 5;

    parts.push(
      `<text x="${PAD_LEFT - 16}" y="${metricLabelY}" text-anchor="end" fill="white" font-size="14" font-family="-apple-system,sans-serif">${escSvg(label)}</text>`,
    );

    parts.push(
      `<line x1="${PAD_LEFT}" y1="${swarmCY}" x2="${W - PAD_RIGHT}" y2="${swarmCY}" stroke="${GRAY}" stroke-width="0.8" opacity="0.35"/>`,
    );

    if (points.length > 0) {
      const values = points.map((p) => p.value);
      const lo = Math.min(...values);
      const hi = Math.max(...values);
      const xScale = (v: number) => PAD_LEFT + ((v - lo) / (hi - lo || 1)) * PLOT_W;

      for (const tick of niceTicks(lo, hi, 6)) {
        const tx = xScale(tick);
        if (tx < PAD_LEFT - 5 || tx > W - PAD_RIGHT + 5) continue;
        parts.push(
          `<line x1="${tx.toFixed(1)}" y1="${tickY}" x2="${tx.toFixed(1)}" y2="${tickY + 5}" stroke="${GRAY}" stroke-width="1" opacity="0.5"/>`,
        );
        parts.push(
          `<text x="${tx.toFixed(1)}" y="${tickLabelY}" text-anchor="middle" fill="${GRAY}" font-size="11" font-family="-apple-system,sans-serif">${Number.isInteger(tick) ? tick : tick.toFixed(1)}</text>`,
        );
      }

      // Non-target dots first
      for (const pt of points.filter((p) => !p.isTarget)) {
        const cy = (swarmCY + pt.py).toFixed(1);
        parts.push(
          `<circle cx="${pt.px.toFixed(1)}" cy="${cy}" r="${pt.r}" fill="${DOT_COLOR}" opacity="0.75"/>`,
        );
      }

      // Target dot on top
      const target = points.find((p) => p.isTarget);
      if (target) {
        const cy = swarmCY + target.py;
        parts.push(
          `<circle cx="${target.px.toFixed(1)}" cy="${cy.toFixed(1)}" r="${target.r}" fill="${TARGET_COLOR}" stroke="white" stroke-width="1.5"/>`,
        );
        parts.push(
          `<text x="${target.px.toFixed(1)}" y="${(cy + target.r + 14).toFixed(1)}" text-anchor="middle" fill="${TARGET_COLOR}" font-size="11" font-weight="600" font-family="-apple-system,sans-serif">${target.pctRank}th pct</text>`,
        );
      } else {
        console.warn(
          `[beeswarm] Target player "${meta.player_name}" not found in strip for metric "${meta.metrics[i]}"`,
        );
      }
    }

    if (i < numStrips - 1) {
      const divY = stripTop + STRIP_H;
      parts.push(
        `<line x1="${PAD_LEFT}" y1="${divY}" x2="${W - PAD_RIGHT}" y2="${divY}" stroke="${GRAY}" stroke-width="0.5" opacity="0.15"/>`,
      );
    }
  }

  parts.push(
    `<text x="${PAD_LEFT}" y="${H - 16}" text-anchor="start" fill="${GRAY}" font-size="13" font-family="-apple-system,sans-serif" opacity="0.6">@Mr.Champions · data: WhoScored</text>`,
  );

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">\n${parts.join("\n")}\n</svg>`;
}

// ── Cloudinary Upload ─────────────────────────────────────────────────────────

async function uploadBeeswarmToCloudinary(pngBuffer: Buffer, publicId: string): Promise<string> {
  cloudinary.config(process.env.CLOUDINARY_KEY!);

  const result = await new Promise<{ secure_url: string }>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { public_id: publicId, overwrite: true, resource_type: "image", folder: "beeswarm_charts" },
      (err, res) => {
        if (err || !res) reject(err ?? new Error("No response"));
        else resolve(res);
      },
    );
    stream.end(pngBuffer);
  });

  console.log(`[beeswarm] Cloudinary upload: ${result.secure_url}`);
  return result.secure_url;
}

// ── Pipeline Orchestrator ─────────────────────────────────────────────────────

export async function beeswarmPipeline(
  params: BeeswarmPipelineParams,
): Promise<BeeswarmPipelineResult> {
  const { request, min_minutes = 50, season = "2025/2026", genie_space } = params;

  console.log(`[beeswarm] Starting pipeline: "${request}"`);

  const { strips, meta, playerCount, logoDataUri } = await buildBeeswarmData(
    request,
    season,
    min_minutes,
    genie_space,
  );

  console.log(`[beeswarm] ${playerCount} players, ${strips.length} metric strips`);

  const svgString = buildBeeswarmSvg(strips, meta, season, min_minutes, logoDataUri);

  console.log("[beeswarm] Rendering PNG via Puppeteer");
  const pngBuffer = await renderScatterPlot(svgString);

  console.log("[beeswarm] Uploading to Cloudinary");
  const safePlayer = meta.player_name
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 30);
  const publicId = `beeswarm_${safePlayer}_${season.replace(/\//g, "_")}`;
  const drive_url = await uploadBeeswarmToCloudinary(pngBuffer, publicId);

  console.log(`[beeswarm] Done: ${drive_url}`);
  return { drive_url, title: meta.title, player_count: playerCount, filename: publicId };
}
