import { getScheduledTweets, getScheduledFlashbackTweets, updateTweetStatus } from "../notion";
import { postTweet } from "../twitter";

// ── Pipeline: Post scheduled tweets from Tweet Content DB + Flashback Tweets DB ─

export async function runScheduledTweetPostingPipeline(): Promise<string> {
  console.log("[post-scheduled-tweets] Starting pipeline...");

  const [scheduled, flashback] = await Promise.all([
    getScheduledTweets(),
    getScheduledFlashbackTweets(),
  ]);

  const all = [
    ...scheduled.map((t) => ({ ...t, source: "matches" })),
    ...flashback.map((t) => ({ ...t, source: "flashback" })),
  ];

  if (!all.length) {
    console.log("[post-scheduled-tweets] No scheduled tweets found.");
    return "No scheduled tweets to post.";
  }

  console.log(`[post-scheduled-tweets] Found ${all.length} scheduled tweet(s) (${scheduled.length} matches, ${flashback.length} flashback)`);
  const results: string[] = [];

  for (const tweet of all) {
    console.log(`[post-scheduled-tweets] [${tweet.source}] Posting: "${tweet.topic}"`);
    try {
      const tweetUrl = await postTweet(tweet.content);
      await updateTweetStatus(tweet.pageId, "Posted", tweetUrl);
      results.push(`✓ [${tweet.source}] "${tweet.topic}" → ${tweetUrl}`);
      console.log(`[post-scheduled-tweets] Posted: "${tweet.topic}"`);
    } catch (err: any) {
      await updateTweetStatus(tweet.pageId, "Failed");
      results.push(`✗ [${tweet.source}] "${tweet.topic}" — Error: ${err.message}`);
      console.error(`[post-scheduled-tweets] Failed: "${tweet.topic}"`, err.message);
    }
  }

  return results.join("\n");
}
