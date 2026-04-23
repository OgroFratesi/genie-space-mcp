/**
 * Local scatter plot generator — no Databricks, no Cloudinary.
 *
 * Usage:
 *   npx ts-node scripts/scatter-local.ts --data players.json [options]
 *
 * Options:
 *   --data       Path to JSON data file (required)
 *   --x          Column name to use as X axis  (default: "x")
 *   --y          Column name to use as Y axis  (default: "y")
 *   --player     Column name for player names  (default: "player")
 *   --team       Column name for team names    (default: "team")
 *   --x-label    X axis label
 *   --y-label    Y axis label
 *   --title      Plot title
 *   --highlight  Comma-separated player names to highlight in red
 *   --output     Output PNG path              (default: "scatter_output.png")
 *
 * Data file format — array of row objects, e.g.:
 * [
 *   { "player_name": "Bukayo Saka", "team": "Arsenal", "interceptions": 1.2, "dribbles": 0.8 },
 *   ...
 * ]
 *
 * Then run with:
 *   npx ts-node scripts/scatter-local.ts \
 *     --data players.json \
 *     --x interceptions --y dribbles \
 *     --player player_name \
 *     --x-label "Interceptions p90" --y-label "Dribbles Won p90" \
 *     --title "PL Midfielders 25/26"
 */

import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { buildScatterSvg, renderScatterPlot, PlayerPoint } from "../src/scatter";

dotenv.config();

function arg(args: string[], flag: string, fallback?: string): string | undefined {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : fallback;
}

async function main() {
  const args = process.argv.slice(2);

  const dataFile = arg(args, "--data");
  if (!dataFile) {
    console.error("Error: --data <path> is required");
    process.exit(1);
  }

  const xCol      = arg(args, "--x",        "x");
  const yCol      = arg(args, "--y",        "y");
  const playerCol = arg(args, "--player",   "player");
  const teamCol   = arg(args, "--team",     "team");
  const xLabel    = arg(args, "--x-label",  xCol)!;
  const yLabel    = arg(args, "--y-label",  yCol)!;
  const titleArg  = arg(args, "--title",    `${xLabel} vs ${yLabel}`);
  const outputArg = arg(args, "--output",   "generated_plots/scatter_output.png");
  const highlightArg = arg(args, "--highlight", "");
  const highlightPlayers = highlightArg ? highlightArg.split(",").map(s => s.trim()).filter(Boolean) : [];
  const watermark = arg(args, "--watermark");

  // Load data
  const rawJson = fs.readFileSync(path.resolve(dataFile), "utf-8");
  const rows: Record<string, unknown>[] = JSON.parse(rawJson);

  const data: PlayerPoint[] = rows
    .map((r) => ({
      player: String(r[playerCol!] ?? ""),
      team:   String(r[teamCol!]   ?? ""),
      x:      parseFloat(String(r[xCol!] ?? "0")) || 0,
      y:      parseFloat(String(r[yCol!] ?? "0")) || 0,
    }))
    .filter((r) => r.player && isFinite(r.x) && isFinite(r.y));

  if (data.length === 0) {
    console.error("No valid data rows found. Check column names.");
    process.exit(1);
  }

  console.log(`Loaded ${data.length} players from ${dataFile}`);

  const svg = buildScatterSvg(data, {
    xLabel:           xLabel,
    yLabel:           yLabel,
    title:            titleArg!,
    subtitle:         `${data.length} players`,
    highlightPlayers,
    watermark,
  });

  console.log("Rendering PNG...");
  const png = await renderScatterPlot(svg);

  const outPath = path.resolve(outputArg!);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, png);
  console.log(`Saved: ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
