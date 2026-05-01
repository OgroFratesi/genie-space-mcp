import Anthropic from "@anthropic-ai/sdk";
import {
  saveFlashbackTweetDraft,
  getReadyFlashbackQuestions,
  updateFlashbackQuestionStatus,
} from "../notion";
import {
  collectDataWithAgent,
  collectAndPlotDataWithAgent,
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
  imageUrl?: string;
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
- Use line breaks to improve readability
- Emojis allowed sparingly if they improve the post
- Hashtags for team names, league, players. Try to add at least 2, max 3.
- Capitalization for emphasis is allowed sparingly
- Do not add calls to action

Structure — always follow this exact layout:
1. Hook line (e.g. "Still unmatched:", "Back in [season]:", "[Season] flashback:")
2. The #1 stat or record as the main punchline — one tight line
3. One short contextual note (one sentence max)
4. A numbered continuation listing items 2 through 5 in compact form, one per line:
   2- [item]
   3- [item]
   4- [item]
   5- [item]

The numbered list (2–5) must always be present when the data contains a ranking, top-N result, or list of comparable entries. Each entry should be compact: name + key number only, no extra words.
If the data only has one entry, omit the numbered list.

If the information exist, try to include the leader of the metric for the current season.
${params.imageUrl ? `\nA bar chart image is attached to this tweet. Open with the current-season leader as the hook, then pivot to the historical chart. Do not enumerate every bar — let the image do that work. Reference the visual naturally (e.g. "📊 See how the all-time leaders stack up below").\n` : ""}
Writing rules:
- If there is an all-time record, lead with the record
- If there is an iconic player season, lead with the player and season
- If there is a forgotten stat, lead with the surprise
- Cut anything that feels like filler
- The contextual note before the list should end sharply
- Include team name if it exists for the question.

Tone:
- Nostalgic but factual, not sentimental
- Punchy, not cringeworthy
- Confident, not exaggerated
- More "this number from history is remarkable" than "let me walk you through the full story"

Here an example:
"Still unmatched:

Liverpool's 2021/22 season produced 13 corner-originated goals in the #PremierLeague — the highest single-season total in the last 15 years.

The current season leader is Arsenal with 11 corner-originated goals.

Klopp's set-piece game that year was genuinely elite.

2- West Brom 2016/17 — 12
3- West Brom 2014/15 — 12
4- Liverpool 2013/14 — 12
5- Man City 2011/12 — 12

#LFC #MCFC #PremierLeague"

Question: ${params.question}
League: ${leagueLabel}

Data retrieved from the database:
${params.genieData}

The tweet must be factual and grounded in the data above.

Also write a data summary of the key historical insight (for internal reference, not published).
Also write a short title (5–8 words max) that captures the core historical stat or angle for internal filing — not a headline, just a concise label.

Respond ONLY as valid JSON with no additional text:
{
  "title": "<short concise title>",
  "tweetDraft": "<tweet text>",
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
  const { title, tweetDraft, dataSummary } = JSON.parse(match[0]);

  const agentIn = params.agentInputTokens ?? 0;
  const agentOut = params.agentOutputTokens ?? 0;
  const totalIn = agentIn + draftIn;
  const totalOut = agentOut + draftOut;
  const tokenUsage = `agent_in=${agentIn.toLocaleString()} agent_out=${agentOut.toLocaleString()} | draft_in=${draftIn.toLocaleString()} draft_out=${draftOut.toLocaleString()} | total_in=${totalIn.toLocaleString()} total_out=${totalOut.toLocaleString()}`;

  const notionUrl = await saveFlashbackTweetDraft({
    topic: title ?? params.question,
    league: leagueLabel,
    tweetDraft,
    dataSummary,
    tokenUsage,
    imageUrl: params.imageUrl,
  });

  return { tweetDraft, dataSummary, notionUrl };
}

// ── Pipeline: Flashback tweet drafting from Ready questions ───────────────────
// Processes ONE question per call. If more remain, the return value says so —
// the caller (Claude) should invoke the tool again to continue.

export async function runFlashbackTweetDraftPipeline(): Promise<string> {
  console.log("[flashback-tweets] Starting pipeline...");

  const readyQuestions = await getReadyFlashbackQuestions();
  if (!readyQuestions.length) {
    console.log("[flashback-tweets] No Ready questions found.");
    return "No flashback questions with status Ready found in Flashback Questions database.";
  }

  const remaining = readyQuestions.length;
  const q = readyQuestions[0];
  console.log(`[flashback-tweets] Processing 1 of ${remaining}: "${q.topic}"`);
  await updateFlashbackQuestionStatus(q.pageId, "Processing");

  let resultLine: string;
  try {
    let genieData: string;
    let agentIn: number;
    let agentOut: number;
    let imageUrl: string | undefined;

    if (q.plot === "bar") {
      console.log(`[flashback-tweets] Bar chart mode for: "${q.topic}"`);
      const result = await collectAndPlotDataWithAgent(q.question, q.genieSpace);
      genieData = result.summary;
      imageUrl  = result.imageUrl;
      agentIn   = result.inputTokens;
      agentOut  = result.outputTokens;
    } else {
      const result = await collectDataWithAgent(q.question, q.genieSpace);
      genieData = result.summary;
      agentIn   = result.inputTokens;
      agentOut  = result.outputTokens;
    }

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
      imageUrl,
    });

    await updateFlashbackQuestionStatus(q.pageId, "Processed", notionUrl);
    resultLine = `✓ "${q.topic}" → ${notionUrl}\n  ${tweetDraft}`;
    console.log(`[flashback-tweets] Done: "${q.topic}"`);
  } catch (err: any) {
    await updateFlashbackQuestionStatus(q.pageId, "Failed");
    resultLine = `✗ "${q.topic}" — Error: ${err.message}`;
    console.error(`[flashback-tweets] Failed: "${q.topic}"`, err.message);
  }

  const stillRemaining = remaining - 1;
  const trailer = stillRemaining > 0
    ? `\n\n${stillRemaining} Ready question(s) still pending — call draft_ready_flashback_tweets again to continue.`
    : "\n\nAll Ready questions have been processed.";

  return resultLine! + trailer;
}
