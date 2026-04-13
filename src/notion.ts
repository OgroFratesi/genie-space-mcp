import { Client } from "@notionhq/client";

const notion = new Client({ auth: process.env.NOTION_TOKEN! });
const DATABASE_ID = process.env.NOTION_DATABASE_ID!;

export async function saveTweetDraft(params: {
  topic: string;
  league: string;
  tweetDraft: string;
  dataSummary: string;
}): Promise<string> {
  const response = await notion.pages.create({
    parent: { database_id: DATABASE_ID },
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
