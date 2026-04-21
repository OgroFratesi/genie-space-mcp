import Anthropic from "@anthropic-ai/sdk";
import {
  saveFlashbackTweetDraft,
  getReadyFlashbackQuestions,
  updateFlashbackQuestionStatus,
} from "../notion";
import {
  collectDataWithAgent,
  getSamplesForLeague,
  pickUniqueRandom,
  type DraftResult,
} from "./shared";
import tweetSamples from "../../data/tweet-samples.json";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const DEFAULT_TWEET_MODEL = "claude-sonnet-4-6";

// ── Flashback tweet drafting ──────────────────────────────────────────────────

async function draftAndSaveFlashback(params: {
  league: string;
  question: string;
  genieData: string;
  inspirationSamples: typeof tweetSamples;
  agentInputTokens?: number;
  agentOutputTokens?: number;
}): Promise<DraftResult> {
  const samplesText = [...params.inspirationSamples].sort(() => Math.random() - 0.5).slice(0, 10).map((s) => `- ${s.text}`).join("\n");
  const leagueLabel = params.league === "all" ? "cross-league" : params.league.replace(/_/g, " ");

  const response = await anthropic.messages.create({
    model: DEFAULT_TWEET_MODEL,
    max_tokens: 1000,
    messages: [{
      role: "user",
      content: `You are writing football stats tweets for X — specifically "flashback" posts that celebrate historical moments and past-era statistics.

Write like a sharp football-data account posting nostalgic content, not like a match reporter and not like a generic AI summary tool.

Before writing, identify the strongest nostalgic angle from the data. Choose only one:
- all-time record (still unbroken)
- iconic season milestone
- legendary player era-defining stat
- historical comparison across eras
- forgotten or surprising piece of history
- streak or run from the past
- historical outlier

Then write the tweet around that angle only.

Core style:
- Lead with a nostalgic hook: "Back in [season]...", "[Season] flashback:", or "Still unmatched:"
- Sound native to football Twitter/X
- Be concise, punchy, and stat-led
- Prioritize one strong historical takeaway over a complete recap
- Should be a fact from the data, not a vague commentary, not opinion, and not a question

What to optimize for:
- Strong nostalgic hook in the first line
- Clear statistical framing with season or era reference
- A tweetable angle: record, historical milestone, era comparison, or forgotten fact
- High information density
- Natural football-stat-account phrasing with a nostalgic flavour
- Reference the specific season(s) or era that the stat comes from, ideally in the first line, "Back in the 2010 decade..." or "In the 2010s...", "In the last decade..." or "During the 2015/16 season..."

Avoid:
- Overexplaining obvious context
- Mentioning current season (2025/26) unless directly comparing past to present
- Forced neutrality or robotic wording
- Restating as a percentage what the raw numbers already show

Formatting:
- Max 280 characters
- Use line breaks to improve readability
- Emojis allowed sparingly if they improve the post
- Hashtags only if clearly natural; usually avoid them
- Capitalization for emphasis is allowed sparingly
- Do not add calls to action

Writing rules:
- If there is an all-time record, lead with the record
- If there is an iconic player season, lead with the player and season
- If there is a forgotten stat, lead with the surprise
- Cut anything that feels like filler
- End on a sharp contextual note or implication
- Remember to include the TOPs, and not just the leader.
- Include team name if exists for the question.

Tone:
- Nostalgic but factual, not sentimental
- Punchy, not cringeworthy
- Confident, not exaggerated
- More "this number from history is remarkable" than "let me walk you through the full story"

When given raw historical stats, first identify the best nostalgic tweet angle, then write the tweet around that angle only.

Question: ${params.question}
League: ${leagueLabel}

Data retrieved from the database:
${params.genieData}

The tweet must be factual and grounded in the data above.

Also write a data summary of the key historical insight (for internal reference, not published).

Respond ONLY as valid JSON with no additional text:
{
  "tweetDraft": "<tweet text, max 280 chars>",
  "dataSummary": "<data summary>"
}`,
    }],
  });

  const draftIn = response.usage.input_tokens;
  const draftOut = response.usage.output_tokens;
  console.log(`[flashback-draft] tokens: in=${draftIn} out=${draftOut}`);
  const text = (response.content[0] as any).text as string;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`draftAndSaveFlashback: Claude did not return valid JSON. Response: ${text}`);
  const { tweetDraft, dataSummary } = JSON.parse(match[0]);

  const agentIn = params.agentInputTokens ?? 0;
  const agentOut = params.agentOutputTokens ?? 0;
  const totalIn = agentIn + draftIn;
  const totalOut = agentOut + draftOut;
  const tokenUsage = `agent_in=${agentIn.toLocaleString()} agent_out=${agentOut.toLocaleString()} | draft_in=${draftIn.toLocaleString()} draft_out=${draftOut.toLocaleString()} | total_in=${totalIn.toLocaleString()} total_out=${totalOut.toLocaleString()}`;

  const notionUrl = await saveFlashbackTweetDraft({
    topic: params.question,
    league: leagueLabel,
    tweetDraft,
    dataSummary,
    tokenUsage,
  });

  return { tweetDraft, dataSummary, notionUrl };
}

// ── Pipeline: Flashback tweet drafting from Ready questions ───────────────────

export async function runFlashbackTweetDraftPipeline(): Promise<string> {
  console.log("[flashback-tweets] Starting pipeline...");

  const readyQuestions = await getReadyFlashbackQuestions();
  if (!readyQuestions.length) {
    console.log("[flashback-tweets] No Ready questions found.");
    return "No flashback questions with status Ready found in Flashback Questions database.";
  }

  console.log(`[flashback-tweets] Found ${readyQuestions.length} Ready question(s)`);
  const results: string[] = [];

  for (let i = 0; i < readyQuestions.length; i++) {
    if (i > 0) {
      console.log("[flashback-tweets] Waiting 60s before next question...");
      await new Promise((resolve) => setTimeout(resolve, 60_000));
    }
    const q = readyQuestions[i];
    console.log(`[flashback-tweets] Processing: "${q.topic}"`);
    await updateFlashbackQuestionStatus(q.pageId, "Processing");

    try {
      const { summary: genieData, inputTokens: agentIn, outputTokens: agentOut } = await collectDataWithAgent(q.question);
      console.log(`[flashback-tweets] Data collected (${genieData.length} chars)`);

      const samples = getSamplesForLeague(q.league);
      const inspirationSamples = pickUniqueRandom(samples, 5);

      const { tweetDraft, notionUrl } = await draftAndSaveFlashback({
        league: q.league,
        question: q.question,
        genieData,
        inspirationSamples,
        agentInputTokens: agentIn,
        agentOutputTokens: agentOut,
      });

      await updateFlashbackQuestionStatus(q.pageId, "Processed", notionUrl);
      results.push(`✓ "${q.topic}" → ${notionUrl}\n  ${tweetDraft}`);
      console.log(`[flashback-tweets] Done: "${q.topic}"`);
    } catch (err: any) {
      await updateFlashbackQuestionStatus(q.pageId, "Failed");
      results.push(`✗ "${q.topic}" — Error: ${err.message}`);
      console.error(`[flashback-tweets] Failed: "${q.topic}"`, err.message);
    }
  }

  return results.join("\n\n");
}
