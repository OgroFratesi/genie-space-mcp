import { Client } from "@notionhq/client";

const notion = new Client({ auth: process.env.NOTION_TOKEN! });
const DATABASE_ID = process.env.NOTION_DATABASE_ID!;

// Notion rich_text property values are capped at 2000 characters
const MAX_TEXT = 2000;

export async function saveTweetDraft(params: {
  topic: string;
  league: string;
  tweetDraft: string;
  genieData: string;
}): Promise<string> {
  const genieDataTruncated = params.genieData.length > MAX_TEXT
    ? params.genieData.slice(0, MAX_TEXT - 3) + "..."
    : params.genieData;

  const response = await notion.pages.create({
    parent: { database_id: DATABASE_ID },
    properties: {
      Title:             { title: [{ text: { content: params.topic } }] },
      League:            { rich_text: [{ text: { content: params.league } }] },
      Content:           { rich_text: [{ text: { content: params.tweetDraft } }] },
      "Data Infomation": { rich_text: [{ text: { content: genieDataTruncated } }] },
      Status:            { select: { name: "Draft" } },
      Type:              { select: { name: "Tweet" } },
      "Scheduled At":    { date: { start: new Date().toISOString() } },
    },
  });
  return (response as any).url ?? response.id;
}
