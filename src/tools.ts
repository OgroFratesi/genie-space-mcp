import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { queryGenie } from "./genie";

export function registerTools(server: McpServer): void {
  server.tool(
    "query_databricks",
    "Query the Databricks Genie Space using natural language. Use this to answer questions about the company data, metrics, or any database-related question.",
    {
      question: z
        .string()
        .describe("The natural language question to ask Genie"),
    },
    async ({ question }) => {
      try {
        const result = await queryGenie(question);
        return {
          content: [{ type: "text", text: result }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
