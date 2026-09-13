#!/usr/bin/env node
"use strict";

/**
 * CLI entry point for the ingestion engine.
 *
 * Usage:
 *   node run.js                    # reads config JSON from stdin (production path —
 *                                   # avoids ever writing credentials to disk)
 *   node run.js <config-file.json> # reads config JSON from a file (local testing only)
 *
 * Output: JSON written to stdout, logs to stderr.
 */

const fs = require("fs");
const { runIngestion } = require("./src/index");

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

async function main() {
  const configPath = process.argv[2];

  let raw;
  try {
    raw = configPath ? fs.readFileSync(configPath, "utf8") : await readStdin();
  } catch (e) {
    process.stderr.write(`Failed to read config: ${e.message}\n`);
    process.exit(1);
  }

  let config;
  try {
    config = JSON.parse(raw);
  } catch (e) {
    process.stderr.write(`Invalid config JSON: ${e.message}\n`);
    process.exit(1);
  }

  try {
    const context = await runIngestion(config);
    process.stdout.write(JSON.stringify(context, null, 2));
    process.exit(0);
  } catch (e) {
    process.stderr.write(`Ingestion error: ${e.message}\n${e.stack}\n`);
    process.exit(1);
  }
}

main();