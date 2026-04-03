import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { registerTools } from "./tools";

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
