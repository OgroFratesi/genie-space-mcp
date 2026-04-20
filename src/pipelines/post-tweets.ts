import { getScheduledTweets, updateTweetStatus } from "../notion";
import { postTweet } from "../twitter";

// ── Pipeline: Post scheduled tweets from Tweet Content DB ─────────────────────

export async function runScheduledTweetPostingPipeline(): Promise<string> {
  console.log("[post-scheduled-tweets] Starting pipeline...");

  const scheduled = await getScheduledTweets();
  if (!scheduled.length) {
    console.log("[post-scheduled-tweets] No scheduled tweets found.");
    return "No scheduled tweets to post.";
  }

  console.log(`[post-scheduled-tweets] Found ${scheduled.length} scheduled tweet(s)`);
  const results: string[] = [];

  for (const tweet of scheduled) {
    console.log(`[post-scheduled-tweets] Posting: "${tweet.topic}"`);
    try {
      const tweetUrl = await postTweet(tweet.content);
      await updateTweetStatus(tweet.pageId, "Posted", tweetUrl);
      results.push(`✓ "${tweet.topic}" → ${tweetUrl}`);
      console.log(`[post-scheduled-tweets] Posted: "${tweet.topic}"`);
    } catch (err: any) {
      await updateTweetStatus(tweet.pageId, "Failed");
      results.push(`✗ "${tweet.topic}" — Error: ${err.message}`);
      console.error(`[post-scheduled-tweets] Failed: "${tweet.topic}"`, err.message);
    }
  }

  return results.join("\n");
}
