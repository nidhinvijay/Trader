// src/deltaFeed.js
import WebSocket from "ws";
import logger from "./logger.js";

export function startDeltaFeed(symbol, onTick) {
  const url = "wss://socket.india.delta.exchange";

  logger.info(`Connecting to Delta WebSocket: ${url}`);

  const ws = new WebSocket(url);

  ws.on("open", () => {
    logger.info("Connected to Delta WS");

    const upperSymbol = symbol.toUpperCase();

    const sub = {
      type: "subscribe",
      payload: {
        channels: [
          {
            name: "v2/ticker",
            symbols: [upperSymbol]
          }
        ]
      }
    };

    ws.send(JSON.stringify(sub));
    logger.info(`Subscribed to: ${upperSymbol}`);
  });

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());

      // Uncomment this to debug incoming messages:
      // logger.info(`RAW MSG: ${JSON.stringify(msg)}`);

      // Delta ticker messages DO NOT have "type" or "payload"
      // They come as direct objects with fields like:
      // { symbol: "BTCUSD", mark_price: "1234.56", timestamp: 123456789 }

      if (!msg.symbol) return;        // ignore heartbeats
      if (!msg.mark_price && !msg.close) return;

      const price =
        Number(msg.mark_price) ||
        Number(msg.close) ||
        Number(msg.spot_price);

      if (!price) return;

      onTick({
        symbol: msg.symbol,
        price,
        time: msg.timestamp ? msg.timestamp : Date.now(),
        source: "delta"
      });

    } catch (err) {
      logger.error(`Error parsing Delta msg: ${err.message}`);
    }
  });

  ws.on("close", () => {
    logger.warn("Delta WebSocket closed");
  });

  ws.on("error", (err) => {
    logger.error(`Delta WebSocket error: ${err.message}`);
  });

  return ws;
}
