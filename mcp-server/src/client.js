"use strict";

/**
 * Thin wrapper around the Contexa REST API — every tool in index.js just
 * calls one of these. No logic lives here beyond auth and error shaping;
 * the MCP server intentionally adds nothing the API doesn't already do
 * (see roadmap.md, P1 — this is meant to be a thin wrapper, not a second
 * implementation of ingestion logic).
 */

const BASE_URL = (process.env.CONTEXA_API_URL || "http://localhost:8000").replace(/\/$/, "");
const TOKEN = process.env.CONTEXA_API_TOKEN;

async function apiRequest(path, { method = "GET", body } = {}) {
  if (!TOKEN) {
    throw new Error(
      "CONTEXA_API_TOKEN is not set. Get a token from your Contexa account " +
        "(POST /api/auth/login/ returns one) and set it in this MCP server's " +
        "environment configuration."
    );
  }

  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Token ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new Error(
      `Could not reach Contexa API at ${BASE_URL}${path}: ${e.message}. ` +
        "Is the backend running and is CONTEXA_API_URL correct?"
    );
  }

  const text = await res.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!res.ok) {
    // A malformed id in the URL (e.g. not a valid UUID) never reaches our
    // views at all — Django's router 404s with an HTML page before that,
    // not a JSON error. Collapse that to a plain message instead of
    // dumping raw HTML into a tool error.
    let detail;
    if (payload && typeof payload === "object") {
      detail = payload.error || payload.detail || JSON.stringify(payload);
    } else if (typeof payload === "string" && payload.trim().startsWith("<")) {
      detail = `${res.status} ${res.statusText || "Not Found"} — check that the id is valid.`;
    } else {
      detail = payload;
    }
    throw new Error(`Contexa API ${method} ${path} → ${res.status}: ${detail}`);
  }

  return payload;
}

module.exports = { apiRequest, BASE_URL };
