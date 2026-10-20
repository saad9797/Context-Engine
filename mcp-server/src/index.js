#!/usr/bin/env node
"use strict";

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");
const { apiRequest } = require("./client.js");

const server = new McpServer({ name: "contexa", version: "0.1.0" });

const json = (value) => ({ content: [{ type: "text", text: JSON.stringify(value) }] });
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
  "get_context_packs",
  "Preferred context for coding: default self-contained handoff with complete source units, ORM blocks, enums and coverage gaps within one estimated budget. Check handoff.status, context_gaps and follow_up; request missing symbols/paths before generating code. Reusable base/task split remains optional. Never assume generated code is verified.",
  {
    context_id: z.string().uuid(),
    pack: z.enum(["handoff", "both", "base", "task"]).optional().describe("Default handoff is self-contained within one budget. Task-only requires the matching base."),
    task: z.string().max(4000).optional(),
    endpoints: z.string().max(2000).optional(),
    access: z.string().max(2000).optional(),
    rules: z.string().max(4000).optional(),
    response_shape: z.string().max(4000).optional(),
    max_tokens: z.number().int().min(1000).max(32000).optional(),
    include_paths: z.array(z.string().max(500)).max(15).optional(),
    include_symbols: z.array(z.string().max(500)).max(20).optional().describe("Exact declaration names or path#symbol for missing-context follow-up"),
    include_report: z.boolean().optional().describe("Optional diagnostics outside the copied-pack budget; omitted by default to save context"),
  },
  async ({ context_id, pack = "handoff", include_report = false, ...body }) => {
    const output = await apiRequest(`/api/ingestion/${context_id}/context-pack/`, { method: "POST", body });
    if (pack === "both") return json(output);
    if (include_report) return json({ [pack]: output[pack], report: output.report });
    return json(output[pack]);
  }
);

server.tool(
  "get_context",
  "Legacy overview export; prefer get_context_packs for code generation and small task-focused context. Fetch the distilled claude_context for one saved Contexa ingestion: database schema, " +
    "relationships, storage conventions, codebase structure and key files, and the unified " +
    "architecture graph. This is the actual artifact meant to be read before generating code — " +
    "call list_projects first if you don't already have a context_id. Pass `task` to trim the " +
    "result down to what's relevant to that task (e.g. 'add an endpoint for applicant job " +
    "applications') instead of the full schema — check the returned _scoping.matched field: " +
    "if false, nothing matched closely enough and the full context was returned instead.",
  {
    context_id: z.string().describe("An ingestion context id, from list_projects"),
    task: z.string().optional().describe("What you're building — trims the context to relevant entities if given"),
  },
  async ({ context_id, task }) => {
    const path = task
      ? `/api/ingestion/${context_id}/claude-context/?task=${encodeURIComponent(task)}`
      : `/api/ingestion/${context_id}/claude-context/`;
    return json(await apiRequest(path));
  }
);

server.tool(
  "check_freshness",
  "Check how long ago a saved context was generated, and — when possible — whether the " +
    "underlying database/repo has actually drifted since then via a fresh, cheap live re-check " +
    "(schema shape for Postgres, collection existence for Mongo, latest commit for GitHub). " +
    "Check the response's checked_live field: if false, only age is known (older context, or " +
    "the original connections/job can't be found) — treat a large age_hours as a reason to " +
    "consider run_ingestion regardless. If checked_live is true, trust `drifted` directly.",
  { context_id: z.string() },
  async ({ context_id }) => json(await apiRequest(`/api/ingestion/${context_id}/freshness/`))
);

server.tool(
  "get_changes",
  "Structural diff against the most recent earlier run of the same project (same GitHub repo, " +
    "or same Postgres/Mongo connection) — tables/collections/routes/key files added or removed, " +
    "and column type changes. Check has_previous first: false means no earlier run was found " +
    "(first run, or not enough identity to match one) rather than 'nothing changed'.",
  { context_id: z.string() },
  async ({ context_id }) => json(await apiRequest(`/api/ingestion/${context_id}/diff/`))
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
    mysql_connection_id: z.string().uuid().optional(),
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
