#!/usr/bin/env node
import express from "express";
import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { TradingViewClient } from "./tradingview-client.js";
import { rsi, macd, sma, ema, closesOf } from "./indicators.js";

const client = new TradingViewClient();

function createMcpServer(): Server {
  const server = new Server(
    { name: "tradingview-mcp", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "get_quote",
        description:
          'Get a real-time (or lightly delayed) quote snapshot for a symbol, e.g. "NASDAQ:AAPL", "BINANCE:BTCUSDT", "IDX:BBCA".',
        inputSchema: {
          type: "object",
          properties: {
            symbol: { type: "string", description: 'Exchange-prefixed symbol, e.g. "NASDAQ:AAPL"' },
          },
          required: ["symbol"],
        },
      },
      {
        name: "get_historical",
        description: "Get historical OHLCV candles for a symbol.",
        inputSchema: {
          type: "object",
          properties: {
            symbol: { type: "string", description: 'Exchange-prefixed symbol, e.g. "NASDAQ:AAPL"' },
            interval: {
              type: "string",
              description: 'Candle interval: "1","5","15","30","60","240" (minutes), "D","W","M"',
              default: "D",
            },
            bars: { type: "number", description: "Number of candles to fetch (max ~5000)", default: 100 },
          },
          required: ["symbol"],
        },
      },
      {
        name: "get_indicator",
        description: "Compute a technical indicator (RSI, MACD, SMA, or EMA) from recent historical closes.",
        inputSchema: {
          type: "object",
          properties: {
            symbol: { type: "string", description: 'Exchange-prefixed symbol, e.g. "NASDAQ:AAPL"' },
            indicator: { type: "string", enum: ["RSI", "MACD", "SMA", "EMA"] },
            interval: { type: "string", default: "D" },
            period: { type: "number", description: "Lookback period (default 14 for RSI/SMA/EMA)", default: 14 },
            bars: { type: "number", description: "How many candles to pull to compute the indicator", default: 200 },
          },
          required: ["symbol", "indicator"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      if (name === "get_quote") {
        const symbol = String(args?.symbol);
        const quote = await client.getQuote(symbol);
        return { content: [{ type: "text", text: JSON.stringify(quote, null, 2) }] };
      }

      if (name === "get_historical") {
        const symbol = String(args?.symbol);
        const interval = String(args?.interval ?? "D");
        const bars = Number(args?.bars ?? 100);
        const candles = await client.getHistorical(symbol, interval, bars);
        return { content: [{ type: "text", text: JSON.stringify(candles, null, 2) }] };
      }

      if (name === "get_indicator") {
        const symbol = String(args?.symbol);
        const indicator = String(args?.indicator).toUpperCase();
        const interval = String(args?.interval ?? "D");
        const period = Number(args?.period ?? 14);
        const bars = Number(args?.bars ?? 200);

        const candles = await client.getHistorical(symbol, interval, bars);
        const closes = closesOf(candles);

        let result: unknown;
        switch (indicator) {
          case "RSI":
            result = rsi(closes, period);
            break;
          case "MACD":
            result = macd(closes);
            break;
          case "SMA":
            result = sma(closes, period);
            break;
          case "EMA":
            result = ema(closes, period);
            break;
          default:
            throw new Error(`Unknown indicator "${indicator}". Use RSI, MACD, SMA, or EMA.`);
        }

        const times = candles.map((c) => c.time);
        return {
          content: [{ type: "text", text: JSON.stringify({ symbol, indicator, interval, times, values: result }, null, 2) }],
        };
      }

      throw new Error(`Unknown tool: ${name}`);
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  });

  return server;
}

// --- Remote (HTTP) MCP server, so it can run on free hosting and be added ---
// --- to Claude on mobile via a URL, instead of running locally on a phone. ---

const app = express();
app.use(express.json());

const transports: Record<string, StreamableHTTPServerTransport> = {};

app.get("/", (_req, res) => {
  res.send("TradingView MCP server is running. Point your MCP client at POST/GET/DELETE /mcp");
});

app.post("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  let transport = sessionId ? transports[sessionId] : undefined;

  if (!transport) {
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        transports[id] = transport as StreamableHTTPServerTransport;
      },
    });

    transport.onclose = () => {
      if (transport?.sessionId) delete transports[transport.sessionId];
    };

    const server = createMcpServer();
    await server.connect(transport);
  }

  await transport.handleRequest(req, res, req.body);
});

async function handleSessionRequest(req: express.Request, res: express.Response) {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !transports[sessionId]) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }
  await transports[sessionId].handleRequest(req, res);
}

app.get("/mcp", handleSessionRequest);
app.delete("/mcp", handleSessionRequest);

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`TradingView MCP server listening on port ${port}`);
});
