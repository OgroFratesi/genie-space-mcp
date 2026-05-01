import { getReadyPlots, updatePlotStatus } from "../notion";
import { scatterPipeline } from "../scatter";
import { linePipeline } from "../line";
import { barPipeline } from "../bar";
import { beeswarmPipeline } from "../beeswarm";
import type { GenieSpace } from "../scatter";

const LEAGUE_LABELS: Record<string, string> = {
  premier_league: "Premier League",
  la_liga:        "La Liga",
  bundesliga:     "Bundesliga",
  serie_a:        "Serie A",
  all:            "cross-league",
};

type PlotType = "scatter" | "line" | "bar" | "beeswarm";

// Parses "Highlight PlayerA, PlayerB" from request text, returns players and cleaned request.
function extractHighlights(request: string): { cleanRequest: string; highlightPlayers: string[] } {
  const match = request.match(/\bHighlight\s+([^.]+?)(?:\.|$)/i);
  if (!match) return { cleanRequest: request, highlightPlayers: [] };
  const players = match[1]
    .split(/,\s*(?:and\s+)?|\s+and\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const cleanRequest = request.replace(match[0], "").trim();
  return { cleanRequest, highlightPlayers: players };
}

async function runPlot(plotType: PlotType, request: string, genieSpace?: GenieSpace): Promise<string> {
  switch (plotType) {
    case "scatter": {
      const { cleanRequest, highlightPlayers } = extractHighlights(request);
      console.log(`[draft-plots] raw request: ${JSON.stringify(request)}`);
      console.log(`[draft-plots] highlight_players parsed: ${JSON.stringify(highlightPlayers)}`);
      console.log(`[draft-plots] clean request sent to Genie: ${JSON.stringify(cleanRequest)}`);
      return (await scatterPipeline({ request: cleanRequest, highlight_players: highlightPlayers, genie_space: genieSpace })).drive_url;
    }
    case "line":     return (await linePipeline({ request, genie_space: genieSpace })).drive_url;
    case "bar":      return (await barPipeline({ request, genie_space: genieSpace })).drive_url;
    case "beeswarm": return (await beeswarmPipeline({ request, genie_space: genieSpace })).drive_url;
    default:         throw new Error(`Unknown plot type: ${plotType}`);
  }
}

export async function runPlotDraftPipeline(): Promise<string> {
  console.log("[draft-plots] Starting pipeline...");

  const readyPlots = await getReadyPlots();
  if (!readyPlots.length) {
    console.log("[draft-plots] No Ready plots found.");
    return "No plots with status Ready found in Draft Plots database.";
  }

  const remaining = readyPlots.length;
  const plot = readyPlots[0];
  console.log(`[draft-plots] Processing 1 of ${remaining}: "${plot.name}" (${plot.plotType})`);
  await updatePlotStatus(plot.pageId, "Processing");

  let resultLine: string;
  try {
    const leagueLabel = plot.league ? (LEAGUE_LABELS[plot.league] ?? plot.league) : null;
    const enrichedRequest = leagueLabel ? `${plot.request} [League: ${leagueLabel}]` : plot.request;
    const genieSpace = plot.genieSpace ? (plot.genieSpace as GenieSpace) : undefined;

    const imageUrl = await runPlot(plot.plotType as PlotType, enrichedRequest, genieSpace);
    await updatePlotStatus(plot.pageId, "Processed", imageUrl);
    resultLine = `✓ "${plot.name}" (${plot.plotType}) → ${imageUrl}`;
    console.log(`[draft-plots] Done: "${plot.name}"`);
  } catch (err: any) {
    await updatePlotStatus(plot.pageId, "Failed");
    resultLine = `✗ "${plot.name}" — Error: ${err.message}`;
    console.error(`[draft-plots] Failed: "${plot.name}"`, err.message);
  }

  const stillRemaining = remaining - 1;
  const trailer = stillRemaining > 0
    ? `\n\n${stillRemaining} Ready plot(s) still pending — call draft_ready_plots again to continue.`
    : "\n\nAll Ready plots have been processed.";

  return resultLine! + trailer;
}
