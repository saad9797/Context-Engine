#!/usr/bin/env node
"use strict";

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");
const { apiRequest } = require("./client.js");

const server = new McpServer({ name: "contexa", version: "0.1.0" });

const json = (value) => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

server.tool(
  "list_projects",
  "List the caller's saved Contexa ingestion contexts (past ingestion runs), most recent first. " +
    "Each entry is summary-only — table/collection counts and which sources were included — " +
    "not the full schema. Use get_context on a specific id to fetch the actual distilled context " +
    "before writing code against a project you don't already have context on.",
  {},
  async () => json(await apiRequest("/api/ingestion/"))
);

server.tool(
  "get_context",
  "Fetch the distilled claude_context for one saved Contexa ingestion: database schema, " +
    "relationships, storage conventions, codebase structure and key files, and the unified " +
    "architecture graph. This is the actual artifact meant to be read before generating code — " +
    "call list_projects first if you don't already have a context_id.",
  { context_id: z.string().describe("An ingestion context id, from list_projects") },
  async ({ context_id }) => json(await apiRequest(`/api/ingestion/${context_id}/claude-context/`))
);

server.tool(
  "check_freshness",
  "Report how long ago a saved context was generated. Does NOT detect whether the underlying " +
    "database schema or repository has actually changed since then (Contexa doesn't do drift " +
    "detection yet) — this is only an age check, so treat a large age_hours as a reason to " +
    "consider calling run_ingestion again before relying on the context for a real task.",
  { context_id: z.string() },
  async ({ context_id }) => {
    const contexts = await apiRequest("/api/ingestion/");
    const match = contexts.find((c) => c.id === context_id);
    if (!match) {
      throw new Error(`No context with id ${context_id} found for this account.`);
    }
    const ageMs = Date.now() - new Date(match.created_at).getTime();
    return json({
      context_id,
      generated_at: match.created_at,
      age_hours: Math.round((ageMs / 3600000) * 10) / 10,
      note:
        "Age only, not verified drift. If this looks stale and you're about to generate code " +
        "against it, consider calling run_ingestion first.",
    });
  }
);

server.tool(
  "list_connections",
  "List the caller's saved data-source connections (Postgres/MongoDB/object storage) by id, " +
    "name, and kind. Credentials themselves are never returned. Use the returned ids with " +
    "run_ingestion.",
  {},
  async () => json(await apiRequest("/api/connections/"))
);

server.tool(
  "list_github_installations",
  "List the GitHub App installations (repos/orgs) the caller has connected. Use the returned " +
    "installation_id with run_ingestion's github_installation_id parameter.",
  {},
  async () => json(await apiRequest("/api/integrations/github/installations/"))
);

server.tool(
  "run_ingestion",
  "Start a fresh ingestion run against one or more connected sources and wait for it to finish. " +
    "Requires at least one of postgres_connection_id, mongo_connection_id, or " +
    "github_installation_id (with github_owner/github_repo) — get these from list_connections " +
    "and list_github_installations first. Returns the new context_id once the job succeeds; " +
    "call get_context with it to fetch the result.",
  {
    postgres_connection_id: z.string().optional(),
    mongo_connection_id: z.string().optional(),
    mongo_db_name: z.string().optional().describe("Overrides the name saved on the connection"),
    mongo_scan_all_databases: z.boolean().optional().describe("Inspect every database on the cluster instead of one"),
    storage_connection_id: z.string().optional(),
    github_installation_id: z.number().optional(),
    github_owner: z.string().optional(),
    github_repo: z.string().optional(),
    github_branch: z.string().optional(),
    project_name: z.string().optional(),
    timeout_seconds: z.number().optional().describe("Max time to wait for completion (default 180)"),
  },
  async ({ timeout_seconds, project_name, ...refs }) => {
    const body = { ...refs, meta: { project_name: project_name || "" } };
    const { job_id } = await apiRequest("/api/ingestion/run/", { method: "POST", body });

    const deadline = Date.now() + (timeout_seconds ?? 180) * 1000;
    while (Date.now() < deadline) {
      await sleep(2500);
      const job = await apiRequest(`/api/ingestion/jobs/${job_id}/`);
      if (job.status === "succeeded") {
        return json({ status: "succeeded", context_id: job.result, job_id });
      }
      if (job.status === "failed") {
        throw new Error(`Ingestion job ${job_id} failed: ${job.error || "unknown error"}`);
      }
      // pending/running — keep polling
    }
    return json({
      status: "still_running",
      job_id,
      note: "Timed out waiting in this call, but the job is still running server-side — poll it directly via the Contexa API/UI, or call run_ingestion again later isn't needed, just check the job.",
    });
  }
);

const transport = new StdioServerTransport();
server.connect(transport);
