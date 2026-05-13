#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { ResearchPipeline, validateUrl, SecurityError } from "@lucifer/core";
import { createDefaultRegistry } from "@lucifer/extractors";

function buildPipeline(): ResearchPipeline {
  const pipeline = new ResearchPipeline({ concurrency: 5 });
  for (const [key, extractor] of createDefaultRegistry()) {
    pipeline.register(key, extractor);
  }
  return pipeline;
}

const pipeline = buildPipeline();

const server = new Server(
  { name: "lucifer-research", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "lucifer_extract",
      description:
        "Extract structured content (title, Markdown body, engagement, trust score) from a single URL. " +
        "Supports GitHub, YouTube, HackerNews, Bluesky, Qiita, RSS feeds, and general web pages. " +
        "Uses a tiered fallback chain: API → RSS → Jina Reader → Readability.",
      inputSchema: {
        type: "object" as const,
        properties: {
          url: { type: "string", description: "HTTPS URL to extract content from" },
          timeout: {
            type: "number",
            description: "Fetch timeout in milliseconds (default: 15000)",
          },
          fallback: {
            type: "boolean",
            description: "Fall back to next extraction tier on failure (default: true)",
          },
        },
        required: ["url"],
      },
    },
    {
      name: "lucifer_pipeline",
      description:
        "Extract structured content from multiple URLs in parallel with concurrency control (max 5 concurrent). " +
        "Returns one result per URL in input order. Failed extractions return an error result " +
        "instead of being dropped, so callers can always correlate results back to the input list.",
      inputSchema: {
        type: "object" as const,
        properties: {
          urls: {
            type: "array",
            items: { type: "string" },
            description: "List of HTTPS URLs to extract (max 20 per call)",
          },
          timeout: {
            type: "number",
            description: "Per-URL fetch timeout in milliseconds (default: 15000)",
          },
        },
        required: ["urls"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const a = (args ?? {}) as Record<string, unknown>;

  if (name === "lucifer_extract") {
    const url = String(a["url"] ?? "");
    const rawTimeout = typeof a["timeout"] === "number" ? a["timeout"] : 15_000;
    const timeout = Number.isFinite(rawTimeout) ? Math.max(1_000, Math.min(120_000, rawTimeout)) : 15_000;
    const fallback = a["fallback"] !== false;

    try {
      validateUrl(url);
    } catch (err) {
      if (err instanceof SecurityError) {
        return {
          content: [{ type: "text", text: `Security error: ${err.message} (${err.code})` }],
          isError: true,
        };
      }
      return {
        content: [{ type: "text", text: `Invalid URL: ${url}` }],
        isError: true,
      };
    }

    try {
      const result = await pipeline.extract(url, { timeout, fallback });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: `Extraction error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  }

  if (name === "lucifer_pipeline") {
    const raw = a["urls"];
    const urls = Array.isArray(raw) ? raw.map(String) : [];
    const rawTimeout = typeof a["timeout"] === "number" ? a["timeout"] : 15_000;
    const timeout = Number.isFinite(rawTimeout) ? Math.max(1_000, Math.min(120_000, rawTimeout)) : 15_000;

    if (urls.length === 0) {
      return {
        content: [{ type: "text", text: "Error: urls must be a non-empty array" }],
        isError: true,
      };
    }
    if (urls.length > 20) {
      return {
        content: [{ type: "text", text: "Error: urls array exceeds maximum of 20 per call" }],
        isError: true,
      };
    }

    const results = await pipeline.extractAll(urls, { timeout });
    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
    };
  }

  return {
    content: [{ type: "text", text: `Unknown tool: ${name}` }],
    isError: true,
  };
});

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Use stderr for lifecycle logs — stdout is reserved for JSON-RPC messages
  process.stderr.write("lucifer-research MCP server v0.1.0 started\n");
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
