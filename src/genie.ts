import axios, { AxiosError } from "axios";

const DATABRICKS_HOST = process.env.DATABRICKS_HOST!;
const DATABRICKS_TOKEN = process.env.DATABRICKS_TOKEN!;

const POLL_INTERVAL_MS = 3000;
const MAX_POLLS = 100; // ~5 minutes

const client = axios.create({
  baseURL: DATABRICKS_HOST,
  headers: {
    Authorization: `Bearer ${DATABRICKS_TOKEN}`,
    "Content-Type": "application/json",
  },
});

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startConversation(
  spaceId: string,
  question: string
): Promise<{ conversation_id: string; message_id: string }> {
  const response = await client.post(
    `/api/2.0/genie/spaces/${spaceId}/start-conversation`,
    { content: question }
  );
  return response.data;
}

async function continueConversation(
  spaceId: string,
  conversationId: string,
  question: string
): Promise<{ conversation_id: string; message_id: string }> {
  const response = await client.post(
    `/api/2.0/genie/spaces/${spaceId}/conversations/${conversationId}/messages`,
    { content: question }
  );
  return { conversation_id: conversationId, message_id: response.data.message_id };
}

async function pollMessage(
  spaceId: string,
  conversationId: string,
  messageId: string
): Promise<any> {
  for (let i = 0; i < MAX_POLLS; i++) {
    await sleep(POLL_INTERVAL_MS);

    let data: any;
    try {
      const response = await client.get(
        `/api/2.0/genie/spaces/${spaceId}/conversations/${conversationId}/messages/${messageId}`
      );
      data = response.data;
    } catch (err) {
      const axiosErr = err as AxiosError;
      if (axiosErr.response?.status === 429) {
        console.log("Rate limited, waiting 5 seconds...");
        await sleep(5000);
        continue;
      }
      throw err;
    }

    const status: string = data.status;
    console.log(`[Genie poll ${i + 1}] status: ${status}`);

    if (status === "COMPLETED") {
      return data;
    }
    if (status === "FAILED") {
      const errorMsg =
        data.error?.message ?? data.attachments?.[0]?.text?.content ?? "Unknown error";
      throw new Error(`Genie query failed: ${errorMsg}`);
    }
  }
  throw new Error("Genie query timed out after 5 minutes.");
}

async function fetchQueryResult(
  spaceId: string,
  conversationId: string,
  messageId: string
): Promise<any> {
  const response = await client.get(
    `/api/2.0/genie/spaces/${spaceId}/conversations/${conversationId}/messages/${messageId}/query-result`
  );
  return response.data;
}

function formatMarkdownTable(queryResult: any): string {
  const columns: string[] = queryResult.statement_response?.result?.schema?.columns?.map(
    (c: any) => c.name
  ) ?? [];
  const rows: any[][] = queryResult.statement_response?.result?.data_array ?? [];

  if (columns.length === 0 || rows.length === 0) {
    return "";
  }

  const totalRows = rows.length;
  const displayRows = rows.slice(0, 50);

  const header = `| ${columns.join(" | ")} |`;
  const divider = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = displayRows
    .map((row) => `| ${row.map((cell) => String(cell ?? "")).join(" | ")} |`)
    .join("\n");

  let table = `${header}\n${divider}\n${body}`;
  if (totalRows > 50) {
    table += `\n\n_Showing 50 of ${totalRows} rows._`;
  } else {
    table += `\n\n_${totalRows} row${totalRows !== 1 ? "s" : ""} total._`;
  }
  return table;
}

async function queryGenieSpace(
  spaceId: string,
  question: string,
  conversationId?: string
): Promise<string> {
  try {
    const { conversation_id, message_id } = conversationId
      ? await continueConversation(spaceId, conversationId, question)
      : await startConversation(spaceId, question);

    console.log(`[Genie:${spaceId}] conversation_id=${conversation_id} message_id=${message_id}`);

    const messageData = await pollMessage(spaceId, conversation_id, message_id);

    const summary: string =
      messageData.attachments
        ?.filter((a: any) => a.text?.content)
        .map((a: any) => a.text.content as string)
        .join("\n\n") ?? "";

    const hasQueryResult = messageData.attachments?.some(
      (a: any) => a.query?.query
    );

    let tableSection = "";
    if (hasQueryResult) {
      try {
        const queryResult = await fetchQueryResult(spaceId, conversation_id, message_id);
        tableSection = formatMarkdownTable(queryResult);
      } catch (err) {
        console.error("Failed to fetch query result:", err);
      }
    }

    const answer = [summary, tableSection].filter(Boolean).join("\n\n")
      || "Genie returned no results.";

    // Append conversation_id so Claude can pass it back for follow-up questions
    return `${answer}\n\n---\n_conversation_id: ${conversation_id}_`;
  } catch (err) {
    const axiosErr = err as AxiosError;
    if (axiosErr.response) {
      const status = axiosErr.response.status;
      const detail = (axiosErr.response.data as any)?.message ?? axiosErr.message;
      throw new Error(`Databricks API error (${status}): ${detail}`);
    }
    throw err;
  }
}

// Space 1: General stats — players, teams, season aggregates, conceded metrics
export async function queryGeneralStats(
  question: string,
  conversationId?: string
): Promise<string> {
  const spaceId = process.env.DATABRICKS_GENIE_SPACE_ID_GENERAL!;
  return queryGenieSpace(spaceId, question, conversationId);
}

// Space 2: Shot/goal events with timing, game-state, and build-up context
export async function queryMatchEvents(
  question: string,
  conversationId?: string
): Promise<string> {
  const spaceId = process.env.DATABRICKS_GENIE_SPACE_ID_MATCH!;
  return queryGenieSpace(spaceId, question, conversationId);
}
