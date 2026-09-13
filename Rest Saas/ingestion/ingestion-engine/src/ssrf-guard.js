"use strict";

/**
 * SSRF egress guard, re-checked here (not just Django's core/network_guard.py
 * pre-flight check) immediately before each connection attempt. The gap
 * between the Python-side check and the moment this process actually dials
 * out is a DNS-rebinding window — re-resolving right here, right before
 * connect, shrinks it to effectively nothing instead of leaving it open for
 * the full time a job sits in the queue.
 */

const dns = require("dns").promises;
const net = require("net");

function isPrivateIPv4(ip) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return false;
  const [a, b] = parts;
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 0) return true; // "this network"
  if (a >= 224) return true; // multicast (224+) / reserved (240+) / broadcast
  return false;
}

function isPrivateIPv6(ip) {
  const lower = ip.toLowerCase();
  if (lower === "::1") return true; // loopback
  if (lower === "::") return true; // unspecified
  if (lower.startsWith("fe80:")) return true; // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local (fc00::/7)
  if (lower.startsWith("::ffff:")) {
    // IPv4-mapped IPv6 — unwrap and re-check as v4
    return isPrivateIPv4(lower.slice("::ffff:".length));
  }
  return false;
}

function isUnsafeIp(ip) {
  const family = net.isIP(ip);
  if (family === 4) return isPrivateIPv4(ip);
  if (family === 6) return isPrivateIPv6(ip);
  return true; // couldn't classify it — fail closed
}

/**
 * @param {string} hostname
 * @param {string[]} [allowedHosts] lowercase-compared explicit allowlist
 */
async function assertSafeHost(hostname, allowedHosts = []) {
  if (!hostname) return;
  const host = hostname.replace(/^\[|\]$/g, "");

  if (allowedHosts.includes(host.toLowerCase())) return;

  let addresses;
  try {
    addresses = await dns.lookup(host, { all: true });
  } catch (e) {
    throw new Error(`Could not resolve host '${host}': ${e.message}`);
  }

  for (const { address } of addresses) {
    if (isUnsafeIp(address)) {
      throw new Error(
        `Host '${host}' resolves to '${address}', a private/internal/reserved address. Refusing to connect.`
      );
    }
  }
}

/**
 * Pull every hostname out of a connection-string-style URL, without relying
 * on the WHATWG URL parser — Mongo replica-set URIs can list several
 * comma-separated hosts in the authority section (`mongodb://a:27017,b:27017/db`),
 * which `new URL()` mis-parses as a single garbled hostname.
 */
function extractHosts(connectionString) {
  if (!connectionString) return [];
  try {
    const withoutScheme = connectionString.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, "");
    const authority = withoutScheme.split("/")[0].split("?")[0];
    const hostPart = authority.includes("@") ? authority.split("@").pop() : authority;
    return hostPart
      .split(",")
      .map((h) => h.trim().replace(/:\d+$/, ""))
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * `mongodb+srv://` hostnames (the standard Atlas connection-string format)
 * have no A/AAAA record of their own — only a `_mongodb._tcp.<host>` SRV
 * record pointing at the real replica-set member hostnames, which is what
 * the driver actually connects to. A plain dns.lookup() on the bare srv
 * hostname just fails (ENOTFOUND), which would otherwise reject every valid
 * Atlas URI as unresolvable.
 */
async function resolveSrvTargetHosts(host) {
  let records;
  try {
    records = await dns.resolveSrv(`_mongodb._tcp.${host}`);
  } catch (e) {
    throw new Error(`Could not resolve SRV record for '${host}': ${e.message}`);
  }
  return records.map((r) => r.name);
}

async function assertSafeConnectionString(connectionString, allowedHosts = []) {
  const isSrv = /^mongodb\+srv:\/\//i.test(connectionString || "");
  for (const host of extractHosts(connectionString)) {
    if (isSrv && !allowedHosts.includes(host.toLowerCase())) {
      for (const target of await resolveSrvTargetHosts(host)) {
        await assertSafeHost(target, allowedHosts);
      }
    } else {
      await assertSafeHost(host, allowedHosts);
    }
  }
}

function allowedHostsFromEnv() {
  return (process.env.SSRF_ALLOWED_HOSTS || "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

module.exports = {
  assertSafeHost,
  assertSafeConnectionString,
  extractHosts,
  allowedHostsFromEnv,
  isUnsafeIp,
};
