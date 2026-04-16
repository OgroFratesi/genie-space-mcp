import { Client } from "@notionhq/client";

const notion = new Client({ auth: process.env.NOTION_TOKEN! });

const TWEET_DB_ID           = process.env.NOTION_DATABASE_ID!;
const DRAFT_QUESTIONS_DB_ID = process.env.NOTION_DRAFT_QUESTIONS_DATABASE_ID!;

// ── Tweet Drafts (Matches DB) ─────────────────────────────────────────────────

export async function saveTweetDraft(params: {
  topic: string;
  league: string;
  tweetDraft: string;
  dataSummary: string;
  tokenUsage?: string;
}): Promise<string> {
  const baseProperties: Record<string, any> = {
    Title:             { title: [{ text: { content: params.topic } }] },
    League:            { rich_text: [{ text: { content: params.league } }] },
    Content:           { rich_text: [{ text: { content: params.tweetDraft } }] },
    "Data Infomation": { rich_text: [{ text: { content: params.dataSummary } }] },
    Status:            { select: { name: "Draft" } },
    Type:              { select: { name: "Tweet" } },
    "Scheduled At":    { date: { start: new Date().toISOString() } },
  };

  if (params.tokenUsage) {
    try {
      const response = await notion.pages.create({
        parent: { database_id: TWEET_DB_ID },
        properties: { ...baseProperties, "Token Usage": { rich_text: [{ text: { content: params.tokenUsage } }] } },
      });
      return (response as any).url ?? response.id;
    } catch {
      // "Token Usage" property not in DB schema — fall through and save without it
    }
  }

  const response = await notion.pages.create({ parent: { database_id: TWEET_DB_ID }, properties: baseProperties });
  return (response as any).url ?? response.id;
}

// ── Draft Questions DB ────────────────────────────────────────────────────────

export async function saveDraftQuestion(params: {
  topic: string;
  question: string;
  league: string;
  genieSpace?: string;
  tokenUsage?: string;
}): Promise<string> {
  const baseProperties: Record<string, any> = {
    Title:        { title: [{ text: { content: params.topic } }] },
    Question:     { rich_text: [{ text: { content: params.question } }] },
    League:       { select: { name: params.league } },
    "Genie Space": { select: { name: params.genieSpace ?? "agent" } },
    Status:       { status: { name: "Draft" } },
    "Created At": { date: { start: new Date().toISOString() } },
  };

  if (params.tokenUsage) {
    try {
      const response = await notion.pages.create({
        parent: { database_id: DRAFT_QUESTIONS_DB_ID },
        properties: { ...baseProperties, "Token Usage": { rich_text: [{ text: { content: params.tokenUsage } }] } },
      });
      return (response as any).url ?? response.id;
    } catch {
      // "Token Usage" property not in DB schema — fall through and save without it
    }
  }

  const response = await notion.pages.create({ parent: { database_id: DRAFT_QUESTIONS_DB_ID }, properties: baseProperties });
  return (response as any).url ?? response.id;
}

export interface DraftQuestion {
  pageId: string;
  topic: string;
  question: string;
  league: string;
  genieSpace: string;
}

export async function getReadyQuestions(): Promise<DraftQuestion[]> {
  const response = await notion.databases.query({
    database_id: DRAFT_QUESTIONS_DB_ID,
    filter: { property: "Status", status: { equals: "Ready" } },
  });

  return response.results.map((page: any) => ({
    pageId: page.id,
    topic:      page.properties.Title?.title?.[0]?.text?.content ?? "",
    question:   page.properties.Question?.rich_text?.[0]?.text?.content ?? "",
    league:     page.properties.League?.select?.name ?? "",
    genieSpace: page.properties["Genie Space"]?.select?.name ?? "general",
  }));
}

// ── Scheduled Tweet Posting ───────────────────────────────────────────────────

export interface ScheduledTweet {
  pageId: string;
  content: string;
  topic: string;
  league: string;
}

export async function getScheduledTweets(): Promise<ScheduledTweet[]> {
  const today = new Date().toISOString().split("T")[0]; // e.g. "2026-04-15"
  const response = await notion.databases.query({
    database_id: TWEET_DB_ID,
    filter: {
      and: [
        { property: "Status", select: { equals: "Scheduled" } },
        { property: "Scheduled At", date: { on_or_before: today } },
      ],
    },
  });

  return response.results.map((page: any) => ({
    pageId: page.id,
    content: page.properties.Content?.rich_text?.[0]?.text?.content ?? "",
    topic:   page.properties.Title?.title?.[0]?.text?.content ?? "",
    league:  page.properties.League?.rich_text?.[0]?.text?.content ?? "",
  }));
}

export async function updateTweetStatus(
  pageId: string,
  status: "Posted" | "Failed",
  tweetUrl?: string,
): Promise<void> {
  const properties: any = {
    Status: { select: { name: status } },
  };
  if (tweetUrl) {
    properties["Tweet URL"] = { url: tweetUrl };
  }
  await notion.pages.update({ page_id: pageId, properties });
}

export async function updateQuestionStatus(
  pageId: string,
  status: "Processing" | "Processed" | "Failed",
  tweetUrl?: string,
): Promise<void> {
  const properties: any = {
    Status: { status: { name: status } },
  };
  if (tweetUrl) {
    properties["Tweet URL"] = { url: tweetUrl };
  }
  await notion.pages.update({ page_id: pageId, properties });
}
