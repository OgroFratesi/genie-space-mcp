import { getReadyQuestions, updateQuestionStatus } from "../notion";
import {
  collectDataWithAgent,
  draftAndSave,
  getSamplesForLeague,
  pickUniqueRandom,
} from "./shared";

// ── Pipeline: Tweet drafting from Ready questions ─────────────────────────────

export async function runTweetDraftPipeline(): Promise<string> {
  console.log("[draft-tweets] Starting pipeline...");

  const readyQuestions = await getReadyQuestions();
  if (!readyQuestions.length) {
    console.log("[draft-tweets] No Ready questions found.");
    return "No questions with status Ready found in Draft Questions database.";
  }

  console.log(`[draft-tweets] Found ${readyQuestions.length} Ready question(s)`);
  const results: string[] = [];

  for (let i = 0; i < readyQuestions.length; i++) {
    if (i > 0) {
      console.log("[draft-tweets] Waiting 60s before next question...");
      await new Promise((resolve) => setTimeout(resolve, 60_000));
    }
    const q = readyQuestions[i];
    console.log(`[draft-tweets] Processing: "${q.topic}"`);
    await updateQuestionStatus(q.pageId, "Processing");

    try {
      const { summary: genieData, inputTokens: agentIn, outputTokens: agentOut } = await collectDataWithAgent(q.question);
      console.log(`[draft-tweets] Data collected (${genieData.length} chars)`);

      const samples = getSamplesForLeague(q.league);
      const inspirationSamples = pickUniqueRandom(samples, 5);

      const { tweetDraft, notionUrl } = await draftAndSave({
        league: q.league,
        topic: q.topic,
        genieData,
        inspirationSamples,
        agentInputTokens: agentIn,
        agentOutputTokens: agentOut,
      });

      await updateQuestionStatus(q.pageId, "Processed", notionUrl);
      results.push(`✓ "${q.topic}" → ${notionUrl}\n  ${tweetDraft}`);
      console.log(`[draft-tweets] Done: "${q.topic}"`);
    } catch (err: any) {
      await updateQuestionStatus(q.pageId, "Failed");
      results.push(`✗ "${q.topic}" — Error: ${err.message}`);
      console.error(`[draft-tweets] Failed: "${q.topic}"`, err.message);
    }
  }

  return results.join("\n\n");
}
