// Simple tests for the /health endpoint in both MANUAL and API modes
import test from "node:test";
import assert from "node:assert";
import http from "http";

// Use a fixed port just for the test
const TEST_PORT = 4000;

// Make sure the app starts in MANUAL mode (no Delta API call)
process.env.PORT = String(TEST_PORT);
process.env.FEED_MODE = "manual";
process.env.SYMBOL = "BTCUSD";
process.env.NODE_ENV = "test";

// Small helper to do an HTTP request and return parsed JSON
async function requestJson(
  path: string,
  method: "GET" | "POST",
  body?: unknown
): Promise<any> {
  const payload = body ? JSON.stringify(body) : undefined;

  return await new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "localhost",
        port: TEST_PORT,
        path,
        method,
        headers: payload
          ? {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(payload),
            }
          : undefined,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(err);
          }
        });
      }
    );

    req.on("error", (err) => reject(err));

    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

test("GET /health reports MANUAL then API mode", async () => {
  const { startServer, server } = await import("./index.js");

  // Start the server for this test
  startServer();

  // Wait until the server is listening
  await new Promise<void>((resolve) => {
    if (server.listening) return resolve();
    server.on("listening", () => resolve());
  });

  // First check: should be MANUAL mode (because FEED_MODE=manual)
  const manual = await requestJson("/health", "GET");
  assert.strictEqual(manual.status, "ok");
  assert.strictEqual(manual.mode, "MANUAL");

  // Switch the server to API mode using the /mode endpoint
  await requestJson("/mode", "POST", { flag: 1 });

  // Second check: now /health should say API
  const api = await requestJson("/health", "GET");
  assert.strictEqual(api.status, "ok");
  assert.strictEqual(api.mode, "API");

  // Cleanly stop the server after the test
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}
);
