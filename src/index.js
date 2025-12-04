// src/index.js
import dotenv from "dotenv";
import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import { startDeltaFeed } from "./deltaFeed.js";

dotenv.config();

// Use BTCUSD on Delta
const SYMBOL = (process.env.SYMBOL || "BTCUSD").toUpperCase();
const PORT = Number(process.env.PORT || 3000);

// "api" = live from Delta, "manual" = manual price mode
const INITIAL_MODE = (process.env.FEED_MODE || "api").toLowerCase();

// 1 = API (Delta), 0 = MANUAL
let flag = INITIAL_MODE === "manual" ? 0 : 1;
let manualDirection = "none"; // "up" | "down" | "none"
let currentPrice = null;      // latest LTP (from Delta or manual)
let manualTimer = null;
let deltaWs = null;

const app = express();

// Serve sir's index.html from /public
app.use(express.static("public"));
app.use(express.json());

// -------------------- Helpers for modes --------------------

function startDeltaMode() {
  console.log("▶️ Starting API mode (Delta)");

  // Stop manual loop if running
  stopManualLoop();

  // Only start if not already running
  if (!deltaWs) {
    deltaWs = startDeltaFeed(SYMBOL, handleDeltaTick);
  }
}

function stopDeltaMode() {
  if (deltaWs) {
    console.log("⏹ Stopping Delta feed");
    try {
      deltaWs.close();
    } catch (e) {
      console.log("Error closing Delta WS:", e.message);
    }
    deltaWs = null;
  }
}

function startManualLoop() {
  console.log("▶️ Starting MANUAL mode");

  // Stop Delta so we don't mix live ticks
  stopDeltaMode();

  // If no starting price, set default
  if (currentPrice == null) {
    currentPrice = 100;
  }

  if (manualTimer) clearInterval(manualTimer);

  manualTimer = setInterval(() => {
    const step = 10; // how much to move price per tick

    if (manualDirection === "up") {
      currentPrice += step;
    } else if (manualDirection === "down") {
      currentPrice -= step;
    }
    // if "none" → no change
  }, 1000); // adjust every 1 second
}

function stopManualLoop() {
  if (manualTimer) {
    console.log("⏹ Stopping MANUAL loop");
    clearInterval(manualTimer);
    manualTimer = null;
  }
}

// Called every time Delta gives a tick
function handleDeltaTick(tick) {
  // Only trust Delta price in API mode
  if (flag === 1) {
    currentPrice = tick.price;
  }
  broadcastTick(tick);
}

// -------------------- WebSocket (optional for future) --------------------

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ticks" });

function broadcastTick(tick) {
  const data = JSON.stringify({
    type: "tick",
    symbol: tick.symbol,
    price: tick.price,
    time: tick.time,
    source: tick.source,
    mode: flag === 1 ? "API" : "MANUAL"
  });

  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(data);
    }
  });
}

wss.on("connection", (ws) => {
  console.log("🌐 WebSocket client connected");

  ws.send(JSON.stringify({
    type: "info",
    message: "Connected to tick stream",
    mode: flag === 1 ? "API" : "MANUAL"
  }));

  ws.on("close", () => {
    console.log("🌐 WebSocket client disconnected");
  });
});

// -------------------- HTTP Routes (used by sir's index.html) --------------------

// Simple health check
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    symbol: SYMBOL,
    mode: flag === 1 ? "API" : "MANUAL",
    manualDirection,
    currentPrice
  });
});

// GET /mode → for initial UI state
app.get("/mode", (req, res) => {
  res.json({
    flag,              // 1 = API, 0 = MANUAL
    manualDirection
  });
});

// POST /mode → toggle between API and MANUAL
app.post("/mode", (req, res) => {
  const newFlag = req.body.flag;

  if (newFlag !== 0 && newFlag !== 1) {
    return res.status(400).json({ error: "flag must be 0 or 1" });
  }

  flag = newFlag;

  if (flag === 1) {
    // Switch to API (Delta)
    manualDirection = "none";
    stopManualLoop();
    startDeltaMode();
  } else {
    // Switch to MANUAL
    manualDirection = "none";
    startManualLoop();
  }

  res.json({
    flag,
    manualDirection
  });
});

// GET /btc-price → sir's UI polls this every 2s
app.get("/btc-price", (req, res) => {
  res.json({
    price: currentPrice,
    mode: flag === 1 ? "API" : "MANUAL",
    manualDirection
  });
});

// POST /manual-direction → "up" | "down"
app.post("/manual-direction", (req, res) => {
  const { direction } = req.body;

  if (!["up", "down", "none"].includes(direction)) {
    return res.status(400).json({
      error: "direction must be 'up', 'down' or 'none'"
    });
  }

  manualDirection = direction;

  res.json({
    manualDirection
  });
});

// -------------------- Start server + initial mode --------------------

server.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  console.log(`Symbol: ${SYMBOL}`);
  console.log(`Initial mode: ${flag === 1 ? "API (Delta)" : "MANUAL"}`);

  if (flag === 1) {
    startDeltaMode();
  } else {
    startManualLoop();
  }
});
