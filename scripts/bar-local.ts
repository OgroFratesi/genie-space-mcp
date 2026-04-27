/**
 * Local bar chart generator — no Databricks, no Cloudinary.
 * Uses hardcoded sample data (top scorers per season across top 4 leagues).
 *
 * Usage:
 *   npx ts-node scripts/bar-local.ts
 */

import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { buildBarSvg } from "../src/bar";
import { renderScatterPlot } from "../src/scatter";
import { BarPoint } from "../src/interpret-request";

dotenv.config();

const SAMPLE_DATA: BarPoint[] = [
  { yLabel: "2015/16", value: 25, barLabel: "Harry Kane",       teamName: "Tottenham",         category: "england-premier-league" },
  { yLabel: "2016/17", value: 29, barLabel: "Harry Kane",       teamName: "Tottenham",         category: "england-premier-league" },
  { yLabel: "2017/18", value: 32, barLabel: "Mohamed Salah",    teamName: "Liverpool",         category: "england-premier-league" },
  { yLabel: "2018/19", value: 22, barLabel: "Mohamed Salah",    teamName: "Liverpool",         category: "england-premier-league" },
  { yLabel: "2019/20", value: 23, barLabel: "Jamie Vardy",      teamName: "Leicester",         category: "england-premier-league" },
  { yLabel: "2015/16", value: 40, barLabel: "Luis Suárez",      teamName: "Barcelona",         category: "spain-laliga" },
  { yLabel: "2016/17", value: 37, barLabel: "Lionel Messi",     teamName: "Barcelona",         category: "spain-laliga" },
  { yLabel: "2017/18", value: 34, barLabel: "Lionel Messi",     teamName: "Barcelona",         category: "spain-laliga" },
  { yLabel: "2018/19", value: 36, barLabel: "Lionel Messi",     teamName: "Barcelona",         category: "spain-laliga" },
  { yLabel: "2019/20", value: 25, barLabel: "Karim Benzema",    teamName: "Real Madrid",       category: "spain-laliga" },
  { yLabel: "2015/16", value: 30, barLabel: "Robert Lewandowski", teamName: "Bayern Munich",   category: "germany-bundesliga" },
  { yLabel: "2016/17", value: 29, barLabel: "Pierre Aubameyang", teamName: "Borussia Dortmund", category: "germany-bundesliga" },
  { yLabel: "2017/18", value: 29, barLabel: "Robert Lewandowski", teamName: "Bayern Munich",   category: "germany-bundesliga" },
  { yLabel: "2018/19", value: 22, barLabel: "Robert Lewandowski", teamName: "Bayern Munich",   category: "germany-bundesliga" },
  { yLabel: "2019/20", value: 34, barLabel: "Robert Lewandowski", teamName: "Bayern Munich",   category: "germany-bundesliga" },
  { yLabel: "2015/16", value: 36, barLabel: "Gonzalo Higuain",  teamName: "Napoli",            category: "italy-serie-a" },
  { yLabel: "2016/17", value: 29, barLabel: "Edin Dzeko",       teamName: "Roma",              category: "italy-serie-a" },
  { yLabel: "2017/18", value: 29, barLabel: "Ciro Immobile",    teamName: "Lazio",             category: "italy-serie-a" },
  { yLabel: "2018/19", value: 29, barLabel: "Fabio Quagliarella", teamName: "Sampdoria",       category: "italy-serie-a" },
  { yLabel: "2019/20", value: 36, barLabel: "Ciro Immobile",    teamName: "Lazio",             category: "italy-serie-a" },
];

const META = {
  title: "Top Scorer Each Season · Top 4 European Leagues",
  subtitle: "Premier League · La Liga · Bundesliga · Serie A · 2015/16–2019/20",
  yLabel: "Season / League",
  valueLabel: "Goals",
  enhancedRequest: "",
};

async function main() {
  console.log("Building SVG...");
  const svg = buildBarSvg(SAMPLE_DATA, META, "desc");

  console.log("Rendering PNG via Puppeteer...");
  const png = await renderScatterPlot(svg);

  const outPath = path.resolve("generated_plots/bar_output.png");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, png);
  console.log(`Saved: ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
