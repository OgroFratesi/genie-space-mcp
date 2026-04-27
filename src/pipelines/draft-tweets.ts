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

  const remaining = readyQuestions.length;
  const q = readyQuestions[0];
  console.log(`[draft-tweets] Processing 1 of ${remaining}: "${q.topic}"`);
  await updateQuestionStatus(q.pageId, "Processing");

  let resultLine: string;
  try {
    const { summary: genieData, inputTokens: agentIn, outputTokens: agentOut } = await collectDataWithAgent(q.question, q.genieSpace);
    console.log(`[draft-tweets] Data collected (${genieData.length} chars)`);

    const samples = getSamplesForLeague(q.league);
    const inspirationSamples = pickUniqueRandom(samples, 5);

    const { tweetDraft, notionUrl } = await draftAndSave({
      league: q.league,
      question: q.question,
      genieData,
      inspirationSamples,
      agentInputTokens: agentIn,
      agentOutputTokens: agentOut,
    });

    await updateQuestionStatus(q.pageId, "Processed", notionUrl);
    resultLine = `✓ "${q.topic}" → ${notionUrl}\n  ${tweetDraft}`;
    console.log(`[draft-tweets] Done: "${q.topic}"`);
  } catch (err: any) {
    await updateQuestionStatus(q.pageId, "Failed");
    resultLine = `✗ "${q.topic}" — Error: ${err.message}`;
    console.error(`[draft-tweets] Failed: "${q.topic}"`, err.message);
  }

  const stillRemaining = remaining - 1;
  const trailer = stillRemaining > 0
    ? `\n\n${stillRemaining} Ready question(s) still pending — call draft_ready_tweets again to continue.`
    : "\n\nAll Ready questions have been processed.";

  return resultLine! + trailer;
}
