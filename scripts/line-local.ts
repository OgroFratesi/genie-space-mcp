/**
 * Local line chart generator — no Databricks, no Cloudinary.
 *
 * Usage:
 *   npx ts-node scripts/line-local.ts --data data/line_sample.json [options]
 *
 * Options:
 *   --data         Path to JSON data file (required)
 *   --season       Column name for season   (default: "season")
 *   --league       Column name for league   (default: "league")
 *   --value        Column name for metric   (default: "value")
 *   --value-label  Y axis label             (default: value column name)
 *   --title        Chart title
 *   --output       Output PNG path          (default: "generated_plots/line_output.png")
 *   --watermark    Watermark text
 *
 * Data file format — array of row objects, e.g.:
 * [
 *   { "season": "2015/2016", "league": "england-premier-league", "value": 8100 },
 *   ...
 * ]
 */

import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { buildLineSvg, LinePoint } from "../src/line";
import { renderScatterPlot } from "../src/scatter";

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

  const seasonCol    = arg(args, "--season",      "season");
  const leagueCol    = arg(args, "--league",      "league");
  const valueCol     = arg(args, "--value",       "value");
  const valueLabel   = arg(args, "--value-label", valueCol)!;
  const titleArg     = arg(args, "--title",       `${valueLabel} by League`);
  const subtitleArg  = arg(args, "--subtitle");
  const showAvg      = args.includes("--avg");
  const outputArg    = arg(args, "--output",      "generated_plots/line_output.png");
  const watermark    = arg(args, "--watermark");

  const rawJson = fs.readFileSync(path.resolve(dataFile), "utf-8");
  const rows: Record<string, unknown>[] = JSON.parse(rawJson);

  const data: LinePoint[] = rows
    .map((r) => ({
      season: String(r[seasonCol!] ?? ""),
      league: String(r[leagueCol!] ?? ""),
      value:  parseFloat(String(r[valueCol!] ?? "0")) || 0,
    }))
    .filter((r) => r.season && r.league && isFinite(r.value));

  if (data.length === 0) {
    console.error("No valid data rows found. Check column names.");
    process.exit(1);
  }

  const leagueCount = new Set(data.map((d) => d.league)).size;
  const seasonCount = new Set(data.map((d) => d.season)).size;
  console.log(`Loaded ${data.length} rows — ${leagueCount} leagues × ${seasonCount} seasons`);

  const svg = buildLineSvg(data, {
    valueLabel,
    title: titleArg!,
    subtitle: subtitleArg,
    showAvg,
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
