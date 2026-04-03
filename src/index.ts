import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { registerTools } from "./tools";

const PORT = process.env.PORT ?? 3000;
const MCP_SECRET = process.env.MCP_SECRET;

const app = express();
app.use(express.json());

// Auth middleware
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

// MCP SSE transport — one server instance per SSE connection
const transports: Record<string, SSEServerTransport> = {};

app.get("/sse", requireSecret, async (req: Request, res: Response) => {
  const transport = new SSEServerTransport("/messages", res);

  const server = new McpServer({
    name: "genie-mcp",
    version: "1.0.0",
  });

  registerTools(server);

  transports[transport.sessionId] = transport;

  res.on("close", () => {
    delete transports[transport.sessionId];
  });

  await server.connect(transport);
});

app.post("/messages", requireSecret, async (req: Request, res: Response) => {
  const sessionId = req.query.sessionId as string;
  const transport = transports[sessionId];

  if (!transport) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  // Pass the already-parsed body so raw-body doesn't try to re-read the stream
  await transport.handlePostMessage(req, res, req.body);
});

app.listen(PORT, () => {
  console.log(`Genie MCP server running on port ${PORT}`);
  console.log(`  SSE endpoint:   http://localhost:${PORT}/sse`);
  console.log(`  Health check:   http://localhost:${PORT}/health`);
});
