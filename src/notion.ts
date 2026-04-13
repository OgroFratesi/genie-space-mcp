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
}): Promise<string> {
  const response = await notion.pages.create({
    parent: { database_id: TWEET_DB_ID },
    properties: {
      Title:             { title: [{ text: { content: params.topic } }] },
      League:            { rich_text: [{ text: { content: params.league } }] },
      Content:           { rich_text: [{ text: { content: params.tweetDraft } }] },
      "Data Infomation": { rich_text: [{ text: { content: params.dataSummary } }] },
      Status:            { select: { name: "Draft" } },
      Type:              { select: { name: "Tweet" } },
      "Scheduled At":    { date: { start: new Date().toISOString() } },
    },
  });
  return (response as any).url ?? response.id;
}

// ── Draft Questions DB ────────────────────────────────────────────────────────

export async function saveDraftQuestion(params: {
  topic: string;
  question: string;
  league: string;
  genieSpace: string;
}): Promise<string> {
  const response = await notion.pages.create({
    parent: { database_id: DRAFT_QUESTIONS_DB_ID },
    properties: {
      Title:        { title: [{ text: { content: params.topic } }] },
      Question:     { rich_text: [{ text: { content: params.question } }] },
      League:       { select: { name: params.league } },
      "Genie Space": { select: { name: params.genieSpace } },
      Status:       { select: { name: "Draft" } },
      "Created At": { date: { start: new Date().toISOString() } },
    },
  });
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
    filter: { property: "Status", select: { equals: "Ready" } },
  });

  return response.results.map((page: any) => ({
    pageId: page.id,
    topic:      page.properties.Title?.title?.[0]?.text?.content ?? "",
    question:   page.properties.Question?.rich_text?.[0]?.text?.content ?? "",
    league:     page.properties.League?.select?.name ?? "",
    genieSpace: page.properties["Genie Space"]?.select?.name ?? "general",
  }));
}

export async function updateQuestionStatus(
  pageId: string,
  status: "Processing" | "Processed" | "Failed",
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
