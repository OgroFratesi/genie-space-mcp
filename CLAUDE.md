# Databricks Genie MCP Server

## Project Goal
Build a Model Context Protocol (MCP) server that connects Claude to a Databricks Genie Space, allowing Claude to query data using natural language. The server will be deployed on Railway (persistent server, no timeout issues).

## Tech Stack
- **Runtime:** Node.js with TypeScript
- **MCP SDK:** `@modelcontextprotocol/sdk`
- **HTTP Server:** Express.js
- **Transport:** SSE (Server-Sent Events) via `@modelcontextprotocol/sdk/server/sse`
- **Deployment:** Railway

---

## Environment Variables
These must be defined in `.env` locally and in Railway's environment settings for production:

```
DATABRICKS_HOST=https://<your-workspace>.azuredatabricks.net
DATABRICKS_TOKEN=<your-personal-access-token>
DATABRICKS_GENIE_SPACE_ID=<your-genie-space-id>
MCP_SECRET=<a-random-secret-to-protect-your-endpoint>
PORT=3000
```

---

## Project Structure
```
/
├── src/
│   ├── index.ts          # Entry point, Express + MCP server setup
│   ├── genie.ts          # Databricks Genie API client
│   └── tools.ts          # MCP tool definitions
├── .env
├── .env.example
├── package.json
├── tsconfig.json
├── Dockerfile            # For Railway deployment
└── railway.toml
```

---

## Databricks Genie API Flow

Genie Space uses an **async polling pattern**. The implementation must follow these steps:

### Step 1 — Start a Conversation
```
POST /api/2.0/genie/spaces/{space_id}/start-conversation
Body: { "content": "<user question>" }
Response: { "conversation_id": "...", "message_id": "..." }
```

### Step 2 — Poll for Result
```
GET /api/2.0/genie/spaces/{space_id}/conversations/{conversation_id}/messages/{message_id}
```
Poll every **3 seconds** until `status` is `"COMPLETED"` or `"FAILED"`.

Expected statuses: `EXECUTING_QUERY`, `FETCHING_DATA`, `COMPLETED`, `FAILED`

### Step 3 — Fetch Query Result (if applicable)
If the response contains a `query_result`, fetch it:
```
GET /api/2.0/genie/spaces/{space_id}/conversations/{conversation_id}/messages/{message_id}/query-result
```

### Step 4 — Return to Claude
Return a clean, readable text response combining:
- The Genie natural language summary (`attachments[].text.content`)
- The query result data (if present, format as a markdown table)

---

## MCP Tool to Implement

### Tool: `query_databricks`
```json
{
  "name": "query_databricks",
  "description": "Query the Databricks Genie Space using natural language. Use this to answer questions about the company data, metrics, or any database-related question.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "question": {
        "type": "string",
        "description": "The natural language question to ask Genie"
      }
    },
    "required": ["question"]
  }
}
```

---

## Implementation Notes

### Polling Logic
- Poll every **3000ms**
- Set a **maximum timeout of 5 minutes** (100 iterations) to avoid infinite loops
- Log each polling attempt with the current status for debugging
- If status is `FAILED`, return a meaningful error message to Claude

### Auth Protection
- All incoming MCP requests must include the header: `x-mcp-secret: <MCP_SECRET>`
- Return `401 Unauthorized` if the header is missing or wrong

### Error Handling
- Wrap all Databricks API calls in try/catch
- Return human-readable errors to Claude (not raw stack traces)
- Handle rate limits (429) with a retry after 5 seconds

### Query Result Formatting
- If results have columns + rows, format as a **markdown table**
- Limit to **50 rows** to avoid overwhelming Claude's context
- Always include the total row count even if truncated

---

## Express Server Setup

The server should expose two routes:
- `GET /sse` — SSE endpoint for MCP transport
- `POST /messages` — Message handler for MCP transport
- `GET /health` — Health check (returns `{ status: "ok" }`)

Use the `SSEServerTransport` from `@modelcontextprotocol/sdk/server/sse.js`.

---

## package.json Scripts
```json
{
  "scripts": {
    "dev": "ts-node-dev --respawn src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  }
}
```

## Key Dependencies
```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "latest",
    "express": "^4.18.0",
    "axios": "^1.6.0",
    "dotenv": "^16.0.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "ts-node-dev": "^2.0.0",
    "@types/express": "^4.17.0",
    "@types/node": "^20.0.0"
  }
}
```

---

## Dockerfile (for Railway)
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

## railway.toml
```toml
[build]
builder = "dockerfile"

[deploy]
restartPolicyType = "always"
```

---

## Connecting to Claude

Once deployed, add the MCP server in Claude.ai:
1. Go to **Settings → Integrations → Add MCP Server**
2. Enter the Railway public URL: `https://<your-app>.railway.app/sse`
3. Add the header: `x-mcp-secret: <your MCP_SECRET value>`

---

## Testing Locally

1. Run `npm run dev`
2. Use the MCP Inspector to test:
   ```
   npx @modelcontextprotocol/inspector http://localhost:3000/sse
   ```
3. Try a sample question: `"What were the total sales last month?"`

---

## Definition of Done
- [ ] MCP server starts and exposes `/sse` and `/messages` endpoints
- [ ] `query_databricks` tool is registered and callable
- [ ] Genie polling loop works correctly and returns results
- [ ] Query results are formatted as markdown tables when applicable
- [ ] Auth header protection is working
- [ ] Health check endpoint returns 200
- [ ] Dockerfile builds and runs correctly
- [ ] Successfully deployed on Railway
- [ ] Claude can invoke the tool and get answers from Genie Space
