"use strict";

/**
 * Env var handling (roadmap.md P4, proposal §6.4/§9): record which env keys
 * a project expects and an inferred purpose for each, never a value — not
 * even from a "template" file, since real-world .env.example files
 * sometimes carry a real value someone forgot to blank out. Parsing down to
 * {name, inferred_purpose, likely_sensitive} right here, at extraction
 * time, means a stray real value never reaches the raw context, the
 * database, or claude_context in the first place — narrower than filtering
 * it out later, and matches the proposal's "never scraped wholesale"
 * principle rather than just "never shown".
 */

// Deliberately broad — matches AWS_ACCESS_KEY_ID (ends in _ID, not _KEY, but
// is very much credential-shaped) as well as the more obvious *_SECRET/
// *_TOKEN/*_PASSWORD names. False positives here just mean an ordinary
// config value gets an extra badge; false negatives mean a real credential
// name slips through unflagged, which is the worse failure mode.
const SENSITIVE_NAME_PATTERN = /password|passwd|pwd|secret|token|api[_-]?key|apikey|private[_-]?key|access[_-]?key|credential|auth/i;

function inferPurpose(key) {
  if (/(_url|_uri|_dsn|_connection_string|_conn_str)$/i.test(key)) return "connection string";
  if (/(_key|_secret|_token|_password|_pwd)$/i.test(key) || SENSITIVE_NAME_PATTERN.test(key)) return "credential";
  if (/(^|_)(port)$/i.test(key)) return "network port";
  if (/(^|_)(host|hostname)$/i.test(key)) return "hostname";
  if (/(_id)$/i.test(key)) return "identifier";
  if (/^(debug|env|node_env|environment|app_env)$/i.test(key)) return "environment flag";
  if (/(_bucket|_container)$/i.test(key)) return "storage bucket/container name";
  return "configuration value";
}

/**
 * @param {string|null} envFileText  Raw content of a .env.example/.template/
 *   .sample file — consumed here and only here; the caller should not also
 *   retain the raw text.
 * @returns {{name: string, inferred_purpose: string, likely_sensitive: boolean}[]}
 */
function parseEnvKeys(envFileText) {
  if (!envFileText) return [];
  const keys = [];
  const seen = new Set();
  for (const line of envFileText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!match) continue;
    const name = match[1];
    if (seen.has(name)) continue;
    seen.add(name);
    keys.push({
      name,
      inferred_purpose: inferPurpose(name),
      likely_sensitive: SENSITIVE_NAME_PATTERN.test(name),
    });
  }
  return keys;
}

module.exports = { parseEnvKeys, inferPurpose, SENSITIVE_NAME_PATTERN };
