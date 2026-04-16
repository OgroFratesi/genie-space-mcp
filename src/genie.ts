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

async function fetchSqlStatement(statementId: string): Promise<any> {
  const response = await client.get(`/api/2.0/sql/statements/${statementId}`);
  return response.data;
}

function cellValue(cell: any): string {
  if (cell === null || cell === undefined) return "";
  if (typeof cell !== "object") return String(cell);
  // Databricks PROTOBUF_ARRAY typed value wrappers
  const v = cell.str ?? cell.i64 ?? cell.f64 ?? cell.bool ?? cell.date ?? cell.timestamp;
  return v !== undefined ? String(v) : JSON.stringify(cell);
}

function formatMarkdownTable(sqlData: any): string {
  console.log(`[Genie] sqlData top-level keys: ${JSON.stringify(Object.keys(sqlData))}`);

  // /api/2.0/sql/statements/{id} returns columns under manifest.schema and rows under result.data_array
  const columns: string[] = sqlData.manifest?.schema?.columns?.map(
    (c: any) => c.name
  ) ?? [];
  const rows: any[][] = sqlData.result?.data_array ?? [];

  console.log(`[Genie] table columns=${columns.length} rows=${rows.length}`);

  if (columns.length === 0 || rows.length === 0) {
    return "";
  }

  const totalRows = rows.length;
  const displayRows = rows.slice(0, 50);

  const header = `| ${columns.join(" | ")} |`;
  const divider = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = displayRows
    .map((row) => `| ${row.map(cellValue).join(" | ")} |`)
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

    const statementId = messageData.query_result?.statement_id;
    const rowCount = messageData.query_result?.row_count ?? 0;
    console.log(`[Genie] summary.length=${summary.length} statementId=${statementId} rowCount=${rowCount}`);

    let tableSection = "";
    if (statementId && rowCount > 0) {
      try {
        const sqlData = await fetchSqlStatement(statementId);
        tableSection = formatMarkdownTable(sqlData);
        console.log(`[Genie] tableSection.length=${tableSection.length}`);
      } catch (err) {
        console.error("Failed to fetch SQL statement:", err);
      }
    }

    const answer = [summary, tableSection].filter(Boolean).join("\n\n")
      || "Genie returned no results.";
    console.log(`[Genie] answer.length=${answer.length}`);

    // Append conversation_id so Claude can pass it back for follow-up questions
    return `${answer}\n\n---\nconversation_id: ${conversation_id}`;
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

// ── Direct SQL query (Player Impact Table) ────────────────────────────────────

const SQL_WAREHOUSE_ID = process.env.DATABRICKS_SQL_WAREHOUSE_ID!;
const PLAYER_IMPACT_TABLE = process.env.PLAYER_IMPACT_TABLE!;

async function pollSqlStatement(statementId: string): Promise<any> {
  for (let i = 0; i < MAX_POLLS; i++) {
    const data = await fetchSqlStatement(statementId);
    const state: string = data.status?.state;
    console.log(`[SQL poll ${i + 1}] state: ${state}`);

    if (state === "SUCCEEDED") return data;
    if (state === "FAILED" || state === "CANCELED") {
      const msg = data.status?.error?.message ?? "Unknown error";
      throw new Error(`SQL statement failed (${state}): ${msg}`);
    }

    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error("SQL statement timed out after 5 minutes.");
}

export async function queryPlayerImpactTable(
  matchId: string,
  playerId: string
): Promise<string> {
  const statement = `
SELECT
  imp.matchId, imp.league, imp.season, imp.startDate, imp.GW,
  imp.teamId, imp.teamName, imp.playerId, imp.playerName, imp.player_position,
  imp.total_minutes_played, imp.important_game_type,
  imp.team_goals, imp.opponent_goals, imp.opponentTeamId, imp.opponentTeamName,
  imp.team_result, imp.clean_sheet_flag,
  imp.goal, imp.assist, imp.goal_contributions, imp.goal_share,
  imp.goal_contribution_share, imp.big_chance_created, imp.shots_total,
  imp.pass_key, imp.pass_accurate, imp.successful_final_third_passes,
  imp.clearance_total, imp.interception_all, imp.outfielder_block,
  imp.tackle_total, imp.ball_recovery, imp.duel_aerial_won,
  imp.defensive_contributions_total,
  imp.final_third_pass_share, 
  imp.touches_pct_position_season, imp.pass_accurate_pct_position_season,
  imp.successful_final_third_passes_pct_position_season,
  imp.defensive_contributions_total_pct_position_season,
  imp.rank_clearance_total_in_match,
  imp.rank_interception_all_in_match,
  imp.rank_outfielder_block_in_match,
  imp.rank_duel_aerial_won_in_match,
  imp.rank_tackle_total_in_match
FROM ${PLAYER_IMPACT_TABLE} imp
WHERE imp.matchId = '${matchId}'
  AND imp.playerId = '${playerId}'
  `.trim();

  const submitResponse = await client.post("/api/2.0/sql/statements", {
    statement,
    warehouse_id: SQL_WAREHOUSE_ID,
    wait_timeout: "30s",
    on_wait_timeout: "CONTINUE",
  });

  let data = submitResponse.data;
  const statementId: string = data.statement_id;
  const state: string = data.status?.state;

  console.log(`[SQL impact] statement_id=${statementId} initial_state=${state}`);

  // If not yet complete, poll until done
  if (state !== "SUCCEEDED") {
    if (state === "FAILED" || state === "CANCELED") {
      throw new Error(`SQL statement failed immediately (${state}): ${data.status?.error?.message ?? "Unknown error"}`);
    }
    data = await pollSqlStatement(statementId);
  }

  const table = formatMarkdownTable(data);
  if (!table) return "No data found in impact table for this player/match.";
  return table;
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

// Space 3: Pass events — pass accuracy, zones, crosses, progressive passes, pass flow
export async function queryPassEvents(
  question: string,
  conversationId?: string
): Promise<string> {
  const spaceId = process.env.DATABRICKS_GENIE_SPACE_ID_PASSES!;
  return queryGenieSpace(spaceId, question, conversationId);
}
