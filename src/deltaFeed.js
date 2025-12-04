// src/deltaFeed.js
import WebSocket from "ws";

export function startDeltaFeed(symbol, onTick) {
  const url = "wss://socket.india.delta.exchange";

  console.log("Connecting to Delta WebSocket:", url);

  const ws = new WebSocket(url);

  ws.on("open", () => {
    console.log("✅ Connected to Delta WS");

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
    console.log("📡 Subscribed to:", upperSymbol);
  });

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());

      // Uncomment this to debug incoming messages:
      // console.log("RAW MSG:", msg);

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
      console.log("Error parsing Delta msg:", err.message);
    }
  });

  ws.on("close", () => {
    console.log("❌ Delta WebSocket closed");
  });

  ws.on("error", (err) => {
    console.log("⚠️ Delta WebSocket error:", err.message);
  });

  return ws;
}
