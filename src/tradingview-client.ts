/**
 * Unofficial TradingView data client.
 *
 * TradingView does not publish a free public API. This client talks to the
 * same WebSocket endpoint the tradingview.com website itself uses to stream
 * chart and quote data (wss://data.tradingview.com/socket.io/websocket).
 * It works anonymously (no login) but data may be delayed for some symbols
 * and this endpoint is undocumented/unofficial, so TradingView can change
 * or block it at any time. Use at your own risk and respect their Terms
 * of Service.
 */

import WebSocket from "ws";

const SOCKET_URL = "wss://data.tradingview.com/socket.io/websocket";
const ORIGIN = "https://www.tradingview.com";

export interface Candle {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Quote {
  symbol: string;
  price?: number;
  change?: number;
  changePercent?: number;
  open?: number;
  high?: number;
  low?: number;
  prevClose?: number;
  volume?: number;
}

function randomId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function buildMessage(func: string, params: unknown[]): string {
  const payload = JSON.stringify({ m: func, p: params });
  return `~m~${payload.length}~m~${payload}`;
}

/** Splits TradingView's "~m~<len>~m~<json>" frame format into individual JSON packets. */
function parseFrames(raw: string): any[] {
  const packets: any[] = [];
  const parts = raw.split(/~m~\d+~m~/).filter((p) => p.length > 0);
  for (const part of parts) {
    if (part.startsWith("~h~")) continue; // heartbeat, handled separately
    try {
      packets.push(JSON.parse(part));
    } catch {
      // ignore non-JSON fragments
    }
  }
  return packets;
}

export class TradingViewClient {
  private ws: WebSocket | null = null;
  private connected = false;
  private connectPromise: Promise<void> | null = null;

  private connect(): Promise<void> {
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = new Promise((resolve, reject) => {
      const ws = new WebSocket(SOCKET_URL, {
        headers: { Origin: ORIGIN },
      });
      this.ws = ws;

      const timeout = setTimeout(() => {
        reject(new Error("Timed out connecting to TradingView"));
      }, 10_000);

      ws.on("open", () => {
        clearTimeout(timeout);
        this.connected = true;
        // Anonymous/unauthorized session - works for most public symbols.
        ws.send(buildMessage("set_auth_token", ["unauthorized_user_token"]));
        resolve();
      });

      ws.on("message", (data) => {
        const raw = data.toString();
        // Reply to heartbeats so the server keeps the connection alive.
        const heartbeats = raw.match(/~m~\d+~m~~h~\d+/g);
        if (heartbeats) {
          for (const hb of heartbeats) ws.send(hb);
        }
        const packets = parseFrames(raw);
        for (const packet of packets) this.dispatch(packet);
      });

      ws.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      ws.on("close", () => {
        this.connected = false;
      });
    });

    return this.connectPromise;
  }

  private listeners: Array<(packet: any) => void> = [];
  private dispatch(packet: any) {
    for (const listener of this.listeners) listener(packet);
  }

  private send(func: string, params: unknown[]) {
    if (!this.ws || !this.connected) throw new Error("Not connected");
    this.ws.send(buildMessage(func, params));
  }

  /** Fetches a single real-time (or slightly delayed) quote snapshot. */
  async getQuote(symbol: string, timeoutMs = 8000): Promise<Quote> {
    await this.connect();
    const sessionId = randomId("qs");

    return new Promise((resolve, reject) => {
      const quote: Quote = { symbol };
      let gotAny = false;

      const timer = setTimeout(() => {
        cleanup();
        if (gotAny) resolve(quote);
        else reject(new Error(`No quote data received for ${symbol} (check the symbol format, e.g. "NASDAQ:AAPL")`));
      }, timeoutMs);

      const onPacket = (packet: any) => {
        if (packet?.m === "qsd" && packet.p?.[0] === sessionId) {
          const data = packet.p[1];
          if (data?.n === symbol && data.v) {
            gotAny = true;
            const v = data.v;
            if (v.lp !== undefined) quote.price = v.lp;
            if (v.ch !== undefined) quote.change = v.ch;
            if (v.chp !== undefined) quote.changePercent = v.chp;
            if (v.open_price !== undefined) quote.open = v.open_price;
            if (v.high_price !== undefined) quote.high = v.high_price;
            if (v.low_price !== undefined) quote.low = v.low_price;
            if (v.prev_close_price !== undefined) quote.prevClose = v.prev_close_price;
            if (v.volume !== undefined) quote.volume = v.volume;
          }
        }
      };

      const cleanup = () => {
        clearTimeout(timer);
        this.listeners = this.listeners.filter((l) => l !== onPacket);
        try {
          this.send("quote_remove_symbols", [sessionId, symbol]);
          this.send("quote_delete_session", [sessionId]);
        } catch {
          /* best effort */
        }
      };

      this.listeners.push(onPacket);

      try {
        this.send("quote_create_session", [sessionId]);
        this.send("quote_set_fields", [
          sessionId,
          "lp",
          "ch",
          "chp",
          "open_price",
          "high_price",
          "low_price",
          "prev_close_price",
          "volume",
        ]);
        this.send("quote_add_symbols", [sessionId, symbol]);
      } catch (err) {
        cleanup();
        reject(err as Error);
      }
    });
  }

  /**
   * Fetches historical OHLCV candles.
   * interval examples: "1", "5", "15", "60", "240", "D", "W", "M"
   */
  async getHistorical(symbol: string, interval: string, barCount: number, timeoutMs = 12000): Promise<Candle[]> {
    await this.connect();
    const chartSession = randomId("cs");
    const seriesId = "sds_1";

    return new Promise((resolve, reject) => {
      let resolved = false;

      const timer = setTimeout(() => {
        cleanup();
        if (!resolved) reject(new Error(`No historical data received for ${symbol} (check the symbol format, e.g. "NASDAQ:AAPL")`));
      }, timeoutMs);

      const onPacket = (packet: any) => {
        if (packet?.m === "symbol_error" || packet?.m === "series_error") {
          cleanup();
          if (!resolved) reject(new Error(`TradingView rejected symbol "${symbol}"`));
          return;
        }
        if ((packet?.m === "timescale_update" || packet?.m === "du") && packet.p?.[0] === chartSession) {
          const seriesData = packet.p[1]?.[seriesId];
          if (seriesData?.s) {
            const candles: Candle[] = seriesData.s.map((bar: any) => ({
              time: bar.v[0],
              open: bar.v[1],
              high: bar.v[2],
              low: bar.v[3],
              close: bar.v[4],
              volume: bar.v[5] ?? 0,
            }));
            resolved = true;
            cleanup();
            resolve(candles.sort((a, b) => a.time - b.time));
          }
        }
      };

      const cleanup = () => {
        clearTimeout(timer);
        this.listeners = this.listeners.filter((l) => l !== onPacket);
        try {
          this.send("chart_delete_session", [chartSession]);
        } catch {
          /* best effort */
        }
      };

      this.listeners.push(onPacket);

      try {
        this.send("chart_create_session", [chartSession, ""]);
        this.send("resolve_symbol", [
          chartSession,
          "sds_sym_1",
          `=${JSON.stringify({ symbol, adjustment: "splits" })}`,
        ]);
        this.send("create_series", [chartSession, seriesId, "s1", "sds_sym_1", interval, barCount, ""]);
      } catch (err) {
        cleanup();
        reject(err as Error);
      }
    });
  }

  close() {
    this.ws?.close();
    this.connected = false;
    this.connectPromise = null;
  }
               }
