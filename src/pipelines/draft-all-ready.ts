import { getReadyQuestions, getReadyFlashbackQuestions, getReadyPlots } from "../notion";
import { runTweetDraftPipeline } from "./draft-tweets";
import { runFlashbackTweetDraftPipeline } from "./flashback-tweets";
import { runPlotDraftPipeline } from "./draft-plots";

export async function runDraftAllReadyPipeline(): Promise<string> {
  const [tweets, flashbacks, plots] = await Promise.all([
    getReadyQuestions(),
    getReadyFlashbackQuestions(),
    getReadyPlots(),
  ]);

  const total = tweets.length + flashbacks.length + plots.length;
  if (total === 0) return "No Ready items found across all queues (tweets, flashback tweets, plots).";

  const results: string[] = [];

  for (let i = 0; i < tweets.length; i++) {
    const r = await runTweetDraftPipeline();
    results.push(`[Tweet ${i + 1}/${tweets.length}] ${r.split("\n\n")[0]}`);
  }

  for (let i = 0; i < flashbacks.length; i++) {
    const r = await runFlashbackTweetDraftPipeline();
    results.push(`[Flashback ${i + 1}/${flashbacks.length}] ${r.split("\n\n")[0]}`);
  }

  for (let i = 0; i < plots.length; i++) {
    const r = await runPlotDraftPipeline();
    results.push(`[Plot ${i + 1}/${plots.length}] ${r.split("\n\n")[0]}`);
  }

  const processed = results.filter((r) => r.includes("✓")).length;
  const failed = results.filter((r) => r.includes("✗")).length;
  const summary = `\n\nDone. ${processed} succeeded, ${failed} failed (${total} total).`;

  return results.join("\n") + summary;
}
