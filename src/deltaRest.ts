// src/deltaRest.ts
import { createRequire } from "module";
import logger from "./logger.js";

// In ESM ("type": "module") we must create a local require
const require = createRequire(import.meta.url);
const DeltaRestClient = require("delta-rest-client") as any;

// Default symbol if caller doesn't pass one
const DEFAULT_SYMBOL = (process.env.SYMBOL || "BTCUSD").toUpperCase();

// Client singleton, initialised lazily once env is definitely loaded
let deltaClientPromise: Promise<any> | null = null;

function formatToTwoDecimals(num: number | string): number | null {
  const n = Number(num);
  if (Number.isNaN(n)) {
    return null;
  }
  return Number(n.toFixed(2));
}

/**
 * Fetch latest ticker price for a Delta symbol via HTTP API.
 * Returns a numeric price (2 decimals) or null on error.
 */
export async function fetchDeltaRestPrice(
  symbol: string = DEFAULT_SYMBOL
): Promise<number | null> {
  try {
    if (!deltaClientPromise) {
      const apiKey = process.env.DELTA_API_KEY ?? "";
      const apiSecret = process.env.DELTA_API_SECRET ?? "";

      if (!apiKey || !apiSecret) {
        logger.warn(
          "[Delta REST] Missing DELTA_API_KEY / DELTA_API_SECRET, returning null"
        );
        return null;
      }

      deltaClientPromise = Promise.resolve(
        new DeltaRestClient(apiKey, apiSecret)
      );
    }

    const client = await deltaClientPromise;

    // Use Products.getTicker for a single symbol
    const response = await client.apis.Products.getTicker({ symbol });

    const rawData =
      typeof response.data === "string"
        ? response.data
        : response.data?.toString?.() ?? "";

    if (!rawData) {
      logger.warn("[Delta REST] Empty response from getTicker");
      return null;
    }

    const body = JSON.parse(rawData);

    // Response can be { ...fields } or { result: {...} } or { result: [ {...} ] }
    let ticker: any = body;
    if (body.result) {
      ticker = Array.isArray(body.result) ? body.result[0] : body.result;
    }

    const rawPrice =
      ticker.mark_price ??
      ticker.last_price ??
      ticker.close ??
      ticker.spot_price ??
      ticker.ask ??
      ticker.bid ??
      null;

    if (rawPrice == null) {
      logger.warn("[Delta REST] No usable price field in getTicker response");
      return null;
    }

    const price = formatToTwoDecimals(rawPrice);
    if (price == null) {
      logger.warn("[Delta REST] Parsed price is NaN");
      return null;
    }

    logger.info(`[Delta REST] ${symbol} price=${price}`);
    return price;
  } catch (err: any) {
    logger.error(
      `[Delta REST] Error in fetchDeltaRestPrice: ${err?.message ?? err}`
    );
    return null;
  }
}
