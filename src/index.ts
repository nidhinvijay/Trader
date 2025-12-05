// src/index.ts
import dotenv from "dotenv";
import express from "express";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { startDeltaFeed } from "./deltaFeed.js";
import logger from "./logger.js";

// Basic types so TS understands the shapes
type ModeFlag = 0 | 1;
type ManualDirection = "up" | "down" | "none";

interface Tick {
  symbol: string;
  price: number;
  time: number;
  source: string;
}

dotenv.config();

// Use BTCUSD on Delta
const SYMBOL = (process.env.SYMBOL || "BTCUSD").toUpperCase();
const PORT = Number(process.env.PORT || 3000);

// "api" = live from Delta, "manual" = manual price mode
const INITIAL_MODE = (process.env.FEED_MODE || "api").toLowerCase();

// 1 = API (Delta), 0 = MANUAL
let flag: ModeFlag = INITIAL_MODE === "manual" ? 0 : 1;
let manualDirection: ManualDirection = "none"; // "up" | "down" | "none"
let currentPrice: number | null = null;        // latest LTP (from Delta or manual)
let manualTimer: any = null;
let deltaWs: WebSocket | null = null;

const app = express();

// Serve sir's index.html from /public
app.use(express.static("public"));
app.use(express.json());

// Log every HTTP request (method, URL, status, duration)
app.use((req, res, next) => {
  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;
    logger.info(`HTTP ${req.method} ${req.originalUrl} -> ${res.statusCode} in ${duration}ms`);
  });

  next();
});


// -------------------- Helpers for modes --------------------

function startDeltaMode() {
  logger.info("Starting API mode (Delta)");

  // Stop manual loop if running
  stopManualLoop();

  // Only start if not already running
  if (!deltaWs && process.env.NODE_ENV !== "test") {
    deltaWs = startDeltaFeed(SYMBOL, handleDeltaTick);
  }
}

function stopDeltaMode() {
  if (deltaWs) {
    logger.info("Stopping Delta feed");
    try {
      deltaWs.close();
    } catch (e) {
      logger.error(`Error closing Delta WS: ${e.message}`);
    }
    deltaWs = null;
  }
}

function startManualLoop() {
  logger.info("Starting MANUAL mode");

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
    logger.info("Stopping MANUAL loop");
    clearInterval(manualTimer);
    manualTimer = null;
  }
}

// Called every time Delta gives a tick
function handleDeltaTick(tick: Tick) {
  // Only trust Delta price in API mode
  if (flag === 1) {
    currentPrice = tick.price;
  }
  broadcastTick(tick);
}

// -------------------- WebSocket (optional for future) --------------------

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ticks" });

function broadcastTick(tick: Tick) {
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

wss.on("connection", (ws: WebSocket) => {
  logger.info("WebSocket client connected");

  ws.send(JSON.stringify({
    type: "info",
    message: "Connected to tick stream",
    mode: flag === 1 ? "API" : "MANUAL"
  }));

  ws.on("close", () => {
    logger.info("WebSocket client disconnected");
  });
});

// -------------------- HTTP Routes (used by sir's index.html) --------------------

// Simple health check
app.get("/health", (req, res) => {
  try {
    res.json({
      status: "ok",
      symbol: SYMBOL,
      mode: flag === 1 ? "API" : "MANUAL",
      manualDirection,
      currentPrice,
    });
  } catch (err) {
    logger.error("Error in /health route: " + err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /mode → for initial UI state
app.get("/mode", (req, res) => {
  try {
    res.json({
      flag, // 1 = API, 0 = MANUAL
      manualDirection,
    });
  } catch (err) {
    logger.error("Error in /mode GET route: " + err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /mode → toggle between API and MANUAL
app.post("/mode", (req, res) => {
  try {
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
      manualDirection,
    });
  } catch (err) {
    logger.error("Error in /mode POST route: " + err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /btc-price → sir's UI polls this every 2s
app.get("/btc-price", (req, res) => {
  try {
    res.json({
      price: currentPrice,
      mode: flag === 1 ? "API" : "MANUAL",
      manualDirection,
    });
  } catch (err) {
    logger.error("Error in /btc-price route: " + err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /manual-direction → "up" | "down"
app.post("/manual-direction", (req, res) => {
  try {
    const { direction } = req.body;

    // Validate direction
    if (!["up", "down", "none"].includes(direction)) {
      logger.warn("Invalid manual direction", { direction });
      return res.status(400).json({
        error: "direction must be 'up', 'down' or 'none'",
      });
    }

    // Log before + after
    const oldDirection = manualDirection;
    manualDirection = direction;

    logger.info("Manual direction changed", {
      from: oldDirection,
      to: manualDirection,
    });

    res.json({ manualDirection });
  } catch (err) {
    logger.error("Error in /manual-direction", { message: err.message });
    res.status(500).json({ error: "Internal server error" });
  }
});


// -------------------- Start server + initial mode --------------------

export { app, server };

export function startServer() {
  server.listen(PORT, () => {
    logger.info(`Server running at http://localhost:${PORT}`);
    logger.info(`Symbol: ${SYMBOL}`);
    logger.info(`Initial mode: ${flag === 1 ? "API (Delta)" : "MANUAL"}`);

    // In tests we don't start any background loops or WebSockets
    if (process.env.NODE_ENV !== "test") {
      if (flag === 1) {
        startDeltaMode();
      } else {
        startManualLoop();
      }
    }
  });
}

// In normal run (not tests), start immediately
if (process.env.NODE_ENV !== "test") {
  startServer();
}
