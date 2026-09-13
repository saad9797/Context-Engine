"use strict";

const { S3Client, ListBucketsCommand, ListObjectsV2Command } = require("@aws-sdk/client-s3");
const { BlobServiceClient } = require("@azure/storage-blob");
const { assertSafeHost, allowedHostsFromEnv } = require("../ssrf-guard");

const IMAGE_EXTS   = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".bmp", ".ico", ".tiff"]);
const DOC_EXTS     = new Set([".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt", ".csv"]);
const VIDEO_EXTS   = new Set([".mp4", ".mov", ".avi", ".mkv", ".webm", ".flv"]);
const AUDIO_EXTS   = new Set([".mp3", ".wav", ".ogg", ".flac", ".aac"]);
const ARCHIVE_EXTS = new Set([".zip", ".tar", ".gz", ".rar", ".7z"]);

function classifyKey(key) {
  const lower = key.toLowerCase();
  const ext = lower.includes(".") ? "." + lower.split(".").pop() : "";
  if (IMAGE_EXTS.has(ext))   return "image";
  if (DOC_EXTS.has(ext))     return "document";
  if (VIDEO_EXTS.has(ext))   return "video";
  if (AUDIO_EXTS.has(ext))   return "audio";
  if (ARCHIVE_EXTS.has(ext)) return "archive";
  return "other";
}

function inferFolderPurpose(prefix) {
  const lower = prefix.toLowerCase();
  if (/avatar|profile|user/.test(lower)) return "user profile images";
  if (/product|item|catalog/.test(lower)) return "product/catalog media";
  if (/invoice|receipt|billing/.test(lower)) return "billing documents";
  if (/upload|temp|tmp/.test(lower)) return "temporary uploads";
  if (/thumb|preview/.test(lower)) return "thumbnails/previews";
  if (/backup|export/.test(lower)) return "backups/exports";
  if (/public|static|asset/.test(lower)) return "public static assets";
  if (/private|secure/.test(lower)) return "private/secured files";
  return "general storage";
}

function summarizeObjects(objects) {
  const byType = {};
  let totalSize = 0;
  const prefixes = new Set();

  for (const obj of objects) {
    const type = classifyKey(obj.key);
    byType[type] = (byType[type] || 0) + 1;
    totalSize += obj.size || 0;
    const parts = obj.key.split("/");
    if (parts.length > 1) prefixes.add(parts[0]);
  }

  const folders = Array.from(prefixes).slice(0, 20).map((p) => ({
    name: p,
    inferred_purpose: inferFolderPurpose(p),
  }));

  return { by_type: byType, total_sampled: objects.length, approx_total_size_bytes: totalSize, folders };
}

async function inspectS3(config) {
  const clientCfg = {
    region: config.region || "us-east-1",
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  };
  if (config.endpoint) {
    clientCfg.endpoint = config.endpoint;
    clientCfg.forcePathStyle = true;
    // A bare AWS endpoint is a fixed, well-known public service — only a
    // custom S3-compatible endpoint (self-hosted MinIO, etc.) is tenant-
    // controlled input worth re-validating here.
    let endpointHost;
    try {
      endpointHost = new URL(config.endpoint).hostname;
    } catch {
      endpointHost = null;
    }
    if (endpointHost) {
      await assertSafeHost(endpointHost, allowedHostsFromEnv());
    }
  }

  const s3 = new S3Client(clientCfg);
  // NOTE: this must stay shaped exactly like inspectAzureBlob()'s return
  // value (`containers` holding `blobs_sample`, not `buckets`/
  // `objects_sample`) — context-filter.js's filterObjectStorage only reads
  // `.containers`/`.blobs_sample`, and the mismatch here used to make every
  // S3 ingestion silently produce an empty `containers: []` in the
  // distilled claude_context with no error at all.
  const result = { provider: config.endpoint ? "s3-compatible" : "aws-s3", containers: [] };

  let bucketNames = [];
  if (config.bucket) {
    bucketNames = [config.bucket];
  } else {
    try {
      const { Buckets } = await s3.send(new ListBucketsCommand({}));
      bucketNames = (Buckets || []).map((b) => b.Name);
    } catch (e) {
      result.error = `Failed to list buckets: ${e.message}`;
      return result;
    }
  }

  for (const bucketName of bucketNames.slice(0, 10)) {
    const containerInfo = { name: bucketName, blobs_sample: [], summary: {} };
    try {
      const objects = [];
      let token;
      let page = 0;
      do {
        const res = await s3.send(
          new ListObjectsV2Command({ Bucket: bucketName, MaxKeys: 200, ContinuationToken: token })
        );
        for (const obj of res.Contents || []) {
          objects.push({ key: obj.Key, size: obj.Size, last_modified: obj.LastModified });
        }
        token = res.NextContinuationToken;
        page++;
      } while (token && page < 5);

      containerInfo.blobs_sample = objects.slice(0, 20).map((o) => ({
        key: o.key,
        size_bytes: o.size,
        type: classifyKey(o.key),
        last_modified: o.last_modified,
      }));
      containerInfo.summary = summarizeObjects(objects);
    } catch (e) {
      containerInfo.error = e.message;
    }
    result.containers.push(containerInfo);
  }

  return result;
}

async function inspectAzureBlob(connectionString) {
  // A custom BlobEndpoint= segment (self-hosted/Azurite) is tenant-
  // controlled input; the default *.blob.core.windows.net Azure endpoint
  // derived from AccountName is a fixed public service, not worth
  // re-validating.
  const endpointMatch = /BlobEndpoint=([^;]+)/i.exec(connectionString);
  if (endpointMatch) {
    let endpointHost;
    try {
      endpointHost = new URL(endpointMatch[1]).hostname;
    } catch {
      endpointHost = null;
    }
    if (endpointHost) {
      await assertSafeHost(endpointHost, allowedHostsFromEnv());
    }
  }

  const serviceClient = BlobServiceClient.fromConnectionString(connectionString);
  const result = { provider: "azure-blob", containers: [] };

  let containerIterator;
  try {
    containerIterator = serviceClient.listContainers();
  } catch (e) {
    result.error = `Failed to list containers: ${e.message}`;
    return result;
  }

  try {
    for await (const container of containerIterator) {
      const containerInfo = { name: container.name, properties: container.properties, blobs_sample: [], summary: {} };
      try {
      const containerClient = serviceClient.getContainerClient(container.name);
      const blobs = [];
      for await (const blob of containerClient.listBlobsFlat()) {
        blobs.push({
          key: blob.name,
          size: blob.properties?.contentLength || 0,
          content_type: blob.properties?.contentType,
          last_modified: blob.properties?.lastModified,
        });
        if (blobs.length >= 1000) break;
      }
      containerInfo.blobs_sample = blobs.slice(0, 20).map((b) => ({
        key: b.key, size_bytes: b.size, type: classifyKey(b.key),
        content_type: b.content_type, last_modified: b.last_modified,
      }));
      containerInfo.summary = summarizeObjects(blobs);
      } catch (e) {
        containerInfo.error = e.message;
      }
      result.containers.push(containerInfo);
    }
  } catch (e) {
    // The async iterator itself failed mid-stream (auth expired, network
    // drop, etc.) — keep whatever containers were already collected instead
    // of losing them, and surface the failure at the result level.
    result.error = `Container listing interrupted: ${e.message}`;
  }

  return result;
}


async function inspectObjectStorage(config) {
  if (!config || !config.type) return null;
  if (config.type === "azure") return await inspectAzureBlob(config.connectionString);
  if (config.type === "s3" || config.type === "s3-compatible") return await inspectS3(config);
  return null;
}

module.exports = { inspectObjectStorage };
