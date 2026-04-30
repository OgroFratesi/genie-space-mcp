import { Client } from "@notionhq/client";

const notion = new Client({ auth: process.env.NOTION_TOKEN! });

const TWEET_DB_ID                  = process.env.NOTION_DATABASE_ID!;
const DRAFT_QUESTIONS_DB_ID        = process.env.NOTION_DRAFT_QUESTIONS_DATABASE_ID!;
const DRAFT_PLOTS_DB_ID            = process.env.NOTION_DRAFT_PLOTS_DATABASE_ID!;
const FLASHBACK_QUESTIONS_DB_ID    = process.env.NOTION_FLASHBACK_QUESTIONS_DATABASE_ID!;
const FLASHBACK_QUESTION_SEEDS_DB_ID = process.env.NOTION_FLASHBACK_QUESTION_SEEDS_DATABASE_ID;
const FLASHBACK_TWEETS_DB_ID       = process.env.NOTION_FLASHBACK_TWEETS_DATABASE_ID!;

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

export async function getRecentDraftQuestionTitles(n = 10): Promise<string[]> {
  const response = await notion.databases.query({
    database_id: DRAFT_QUESTIONS_DB_ID,
    sorts: [{ timestamp: "created_time", direction: "descending" }],
    page_size: n,
  });

  return response.results.map(
    (page: any) => page.properties.Title?.title?.[0]?.text?.content ?? ""
  ).filter(Boolean);
}

// ── Draft Plots DB ────────────────────────────────────────────────────────────

export async function saveDraftPlot(params: {
  name: string;
  request: string;
  plotType: string;
  league?: string;
  genieSpace?: string;
}): Promise<string> {
  const properties: Record<string, any> = {
    Name:          { title: [{ text: { content: params.name } }] },
    Request:       { rich_text: [{ text: { content: params.request } }] },
    "Plot Type":   { select: { name: params.plotType } },
    Status:        { multi_select: [{ name: "Draft" }] },
  };
  if (params.league) properties["League"] = { select: { name: params.league } };
  if (params.genieSpace) properties["Genie Space"] = { select: { name: params.genieSpace } };

  const response = await notion.pages.create({ parent: { database_id: DRAFT_PLOTS_DB_ID }, properties });
  return (response as any).url ?? response.id;
}

export interface DraftPlot {
  pageId: string;
  name: string;
  request: string;
  plotType: string;
  league: string;
  genieSpace: string;
}

export async function getReadyPlots(): Promise<DraftPlot[]> {
  const response = await notion.databases.query({
    database_id: DRAFT_PLOTS_DB_ID,
    filter: { property: "Status", multi_select: { contains: "Ready" } },
  });

  return response.results.map((page: any) => ({
    pageId:     page.id,
    name:       page.properties.Name?.title?.[0]?.text?.content ?? "",
    request:    page.properties.Request?.rich_text?.[0]?.text?.content ?? "",
    plotType:   page.properties["Plot Type"]?.select?.name ?? "",
    league:     page.properties.League?.select?.name ?? "",
    genieSpace: page.properties["Genie Space"]?.select?.name ?? "",
  }));
}

export async function updatePlotStatus(
  pageId: string,
  status: "Processing" | "Processed" | "Failed",
  imageUrl?: string,
): Promise<void> {
  const properties: any = {
    Status: { multi_select: [{ name: status }] },
  };
  if (imageUrl) {
    properties["Image URL"] = { url: imageUrl };
  }
  await notion.pages.update({ page_id: pageId, properties });
}

// ── Scheduled Tweet Posting ───────────────────────────────────────────────────

export interface ScheduledTweet {
  pageId: string;
  content: string;
  topic: string;
  league: string;
}

export async function getScheduledTweets(): Promise<ScheduledTweet[]> {
  const now = new Date().toISOString(); // full ISO timestamp — Notion date-only strings default to midnight UTC and miss same-day entries
  const response = await notion.databases.query({
    database_id: TWEET_DB_ID,
    filter: {
      and: [
        { property: "Status", select: { equals: "Scheduled" } },
        { property: "Scheduled At", date: { on_or_before: now } },
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

// ── Flashback question seeds DB (rotation catalog; separate from draft questions) ─

export interface FlashbackQuestionSeedRow {
  pageId: string;
  /** Notion title column `Id` — for logging */
  name: string;
  seedText: string;
  /** From optional `Genie Space` select on the seed row */
  genieSpace?: string;
}

function notionRichTextPlain(prop: any): string {
  const rt = prop?.rich_text;
  if (!Array.isArray(rt)) return "";
  return rt.map((b: any) => b.plain_text ?? "").join("");
}

function notionTitlePlain(prop: any): string {
  const t = prop?.title;
  if (!Array.isArray(t)) return "";
  return t.map((b: any) => b.plain_text ?? "").join("");
}

function lastUsedMsFromPage(page: any): number | null {
  const start = page.properties?.["Last Used"]?.date?.start as string | undefined;
  if (!start) return null;
  const ms = Date.parse(start);
  return Number.isNaN(ms) ? null : ms;
}

function parseFlashbackSeedPage(page: any): FlashbackQuestionSeedRow | null {
  const seedProp = page.properties?.Seed;
  const seedText =
    notionRichTextPlain(seedProp).trim() ||
    notionTitlePlain(seedProp).trim();
  if (!seedText) return null;
  const name = notionTitlePlain(page.properties?.Id).trim() || "(untitled)";
  const genie = page.properties?.["Genie Space"]?.select?.name as string | undefined;
  return {
    pageId: page.id,
    name,
    seedText,
    genieSpace: genie?.trim() ? genie : undefined,
  };
}

/** Seeds with Status = Active; never-used first then oldest `Last Used`; returns exactly `count` rows or throws. */
export async function getNextFlashbackSeedRows(count: number): Promise<FlashbackQuestionSeedRow[]> {
  if (count < 1) {
    throw new Error("getNextFlashbackSeedRows: count must be at least 1");
  }
  if (!FLASHBACK_QUESTION_SEEDS_DB_ID?.trim()) {
    throw new Error(
      "NOTION_FLASHBACK_QUESTION_SEEDS_DATABASE_ID is not set. Add it to .env / Railway and connect the Notion seeds database.",
    );
  }

  const scored: { row: FlashbackQuestionSeedRow; lastUsed: number | null }[] = [];
  let cursor: string | undefined;
  do {
    const response = await notion.databases.query({
      database_id: FLASHBACK_QUESTION_SEEDS_DB_ID,
      filter: { property: "Status", multi_select: { contains: "Active" } },
      page_size: 100,
      start_cursor: cursor,
    });
    for (const page of response.results) {
      const row = parseFlashbackSeedPage(page as any);
      if (!row) continue;
      scored.push({ row, lastUsed: lastUsedMsFromPage(page) });
    }
    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
  } while (cursor);

  scored.sort((a, b) => {
    if (a.lastUsed === null && b.lastUsed === null) return 0;
    if (a.lastUsed === null) return -1;
    if (b.lastUsed === null) return 1;
    return a.lastUsed - b.lastUsed;
  });

  const picked = scored.slice(0, count).map((x) => x.row);
  if (picked.length < count) {
    throw new Error(
      `getNextFlashbackSeedRows: need ${count} row(s) with Status=Active and non-empty Seed; found ${picked.length}. Add or set Status to Active in the flashback seeds Notion database.`,
    );
  }
  return picked;
}

export async function touchFlashbackSeedLastUsed(pageId: string): Promise<void> {
  await notion.pages.update({
    page_id: pageId,
    properties: {
      "Last Used": { date: { start: new Date().toISOString() } },
    },
  });
}

// ── Flashback Questions DB ────────────────────────────────────────────────────

export async function saveFlashbackQuestion(params: {
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
        parent: { database_id: FLASHBACK_QUESTIONS_DB_ID },
        properties: { ...baseProperties, "Token Usage": { rich_text: [{ text: { content: params.tokenUsage } }] } },
      });
      return (response as any).url ?? response.id;
    } catch {
      // "Token Usage" property not in DB schema — fall through and save without it
    }
  }

  const response = await notion.pages.create({ parent: { database_id: FLASHBACK_QUESTIONS_DB_ID }, properties: baseProperties });
  return (response as any).url ?? response.id;
}

export async function getReadyFlashbackQuestions(): Promise<DraftQuestion[]> {
  const response = await notion.databases.query({
    database_id: FLASHBACK_QUESTIONS_DB_ID,
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

export async function getRecentFlashbackQuestionTitles(n = 10): Promise<string[]> {
  const response = await notion.databases.query({
    database_id: FLASHBACK_QUESTIONS_DB_ID,
    sorts: [{ timestamp: "created_time", direction: "descending" }],
    page_size: n,
  });

  return response.results.map(
    (page: any) => page.properties.Title?.title?.[0]?.text?.content ?? ""
  ).filter(Boolean);
}

export async function updateFlashbackQuestionStatus(
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

// ── Flashback Tweets DB ───────────────────────────────────────────────────────

export async function getScheduledFlashbackTweets(): Promise<ScheduledTweet[]> {
  const now = new Date().toISOString();
  const response = await notion.databases.query({
    database_id: FLASHBACK_TWEETS_DB_ID,
    filter: {
      and: [
        { property: "Status", select: { equals: "Scheduled" } },
        { property: "Scheduled At", date: { on_or_before: now } },
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

export async function saveFlashbackTweetDraft(params: {
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
  };

  if (params.tokenUsage) {
    try {
      const response = await notion.pages.create({
        parent: { database_id: FLASHBACK_TWEETS_DB_ID },
        properties: { ...baseProperties, "Token Usage": { rich_text: [{ text: { content: params.tokenUsage } }] } },
      });
      return (response as any).url ?? response.id;
    } catch {
      // "Token Usage" property not in DB schema — fall through and save without it
    }
  }

  const response = await notion.pages.create({ parent: { database_id: FLASHBACK_TWEETS_DB_ID }, properties: baseProperties });
  return (response as any).url ?? response.id;
}
