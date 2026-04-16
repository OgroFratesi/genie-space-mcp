import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { registerTools } from "./tools";
import { runQuestionGenerationPipeline, runTweetDraftPipeline, runScheduledTweetPostingPipeline } from "./daily-tweet";
import { runImpactPlayerPipeline, ImpactPlayerPayload } from "./impact-player";
import { runRankChangeRecordPipeline, RankChangeRecordPayload } from "./rank-change-record";

const PORT = process.env.PORT ?? 3000;
const MCP_SECRET = process.env.MCP_SECRET;

const app = express();
app.use(express.json());

// Auth middleware — accepts secret via header or query param
function requireSecret(req: Request, res: Response, next: NextFunction): void {
  if (!MCP_SECRET) {
    next();
    return;
  }
  const fromHeader = req.headers["x-mcp-secret"];
  const fromQuery = req.query.secret;
  if (fromHeader !== MCP_SECRET && fromQuery !== MCP_SECRET) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

// Health check
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

// Pipeline 1: Generate draft questions → saves to Draft Questions DB
app.post("/generate-questions", requireSecret, async (req: Request, res: Response) => {
  const count = Number(req.body?.count) || 5;
  try {
    const result = await runQuestionGenerationPipeline(count);
    res.json({ status: "ok", result });
  } catch (err: any) {
    console.error("[generate-questions] Error:", err);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// Pipeline 2: Process Ready questions → query Genie + draft tweets
app.post("/draft-tweets", requireSecret, async (_req: Request, res: Response) => {
  try {
    const result = await runTweetDraftPipeline();
    res.json({ status: "ok", result });
  } catch (err: any) {
    console.error("[draft-tweets] Error:", err);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// Pipeline 3: Post scheduled tweets from Tweet Content DB
app.post("/post-scheduled-tweets", requireSecret, async (_req: Request, res: Response) => {
  try {
    const result = await runScheduledTweetPostingPipeline();
    res.json({ status: "ok", result });
  } catch (err: any) {
    console.error("[post-scheduled-tweets] Error:", err);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// Pipeline 4: Evaluate impact player candidate from Databricks
app.post("/impact-player-candidate", requireSecret, async (req: Request, res: Response) => {
  const payload = req.body as ImpactPlayerPayload;
  if (!payload?.event_id || !payload?.entity_id || !payload?.matchId || !payload?.metric) {
    res.status(400).json({ error: "Missing required fields: event_id, entity_id, matchId, metric" });
    return;
  }
  try {
    const result = await runImpactPlayerPipeline(payload);
    res.json({ status: "ok", result });
  } catch (err: any) {
    console.error("[impact-player-candidate] Error:", err);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// Pipeline 5: Evaluate rank-change-record from Databricks
app.post("/rank-change-record", requireSecret, async (req: Request, res: Response) => {
  const payload = req.body as RankChangeRecordPayload;
  if (!payload?.event_id || !payload?.entity_id || !payload?.matchId || !payload?.metric) {
    res.status(400).json({ error: "Missing required fields: event_id, entity_id, matchId, metric" });
    return;
  }
  try {
    const result = await runRankChangeRecordPipeline(payload);
    res.json({ status: "ok", result });
  } catch (err: any) {
    console.error("[rank-change-record] Error:", err);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ── Streamable HTTP transport (Claude.ai web/mobile) ──────────────────────────
// Single endpoint: POST /mcp (and GET /mcp for SSE streaming responses)
app.all("/mcp", requireSecret, async (req: Request, res: Response) => {
  const server = new McpServer({ name: "genie-mcp", version: "1.0.0" });
  registerTools(server);

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless — new session per request
  });

  res.on("close", () => transport.close());
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

// ── Legacy SSE transport (Claude Code, MCP Inspector) ─────────────────────────
const sseTransports: Record<string, SSEServerTransport> = {};

app.get("/sse", requireSecret, async (req: Request, res: Response) => {
  const transport = new SSEServerTransport("/messages", res);
  const server = new McpServer({ name: "genie-mcp", version: "1.0.0" });
  registerTools(server);

  sseTransports[transport.sessionId] = transport;
  res.on("close", () => delete sseTransports[transport.sessionId]);

  await server.connect(transport);
});

app.post("/messages", requireSecret, async (req: Request, res: Response) => {
  const sessionId = req.query.sessionId as string;
  const transport = sseTransports[sessionId];

  if (!transport) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  await transport.handlePostMessage(req, res, req.body);
});

app.listen(PORT, () => {
  console.log(`Genie MCP server running on port ${PORT}`);
  console.log(`  Streamable HTTP: http://localhost:${PORT}/mcp`);
  console.log(`  Legacy SSE:      http://localhost:${PORT}/sse`);
  console.log(`  Health check:    http://localhost:${PORT}/health`);
});
