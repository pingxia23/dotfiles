#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const FEEDS_FILE = path.join(SCRIPT_DIR, "rss-feeds.txt");
const CLIPPINGS_DIR = path.join(
  homedir(),
  "Documents",
  "obsidian",
  "Digests",
  "clippings",
);
const DIGEST_DIR = path.join(
  homedir(),
  "Documents",
  "obsidian",
  "Digests",
  "clippings_digest",
);
const SAVED_DIR = path.join(homedir(), "Documents", "obsidian", "Digests", "saved");
const DIGEST_SCRIPT = path.join(SCRIPT_DIR, "clippings-digest.sh");
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const HASH_LENGTH = 12;
const LOG_PREFIX = "[rss-digest]";

function log(message) {
  console.log(`${LOG_PREFIX} ${message}`);
}

function decodeXml(value) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, number) =>
      String.fromCodePoint(Number.parseInt(number, 16)),
    )
    .replace(/&#([0-9]+);/g, (_, number) =>
      String.fromCodePoint(Number.parseInt(number, 10)),
    )
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function htmlToText(value) {
  return decodeXml(value)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|h[1-6])\s*>/gi, "\n")
    .replace(/<li(?:\s[^>]*)?>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tagValue(block, names) {
  for (const name of names) {
    const escapedName = escapeRegExp(name);
    const match = block.match(
      new RegExp(`<${escapedName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapedName}\\s*>`, "i"),
    );
    if (match) {
      return match[1].trim();
    }
  }
  return "";
}

function tagBlocks(xml, name) {
  const escapedName = escapeRegExp(name);
  return Array.from(
    xml.matchAll(
      new RegExp(`<${escapedName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapedName}\\s*>`, "gi"),
    ),
    (match) => match[1],
  );
}

function atomLink(block) {
  const links = Array.from(block.matchAll(/<link\b([^>]*)\/?>/gi), (match) => {
    const attributes = {};
    for (const attribute of match[1].matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g)) {
      attributes[attribute[1].toLowerCase()] = decodeXml(attribute[3]);
    }
    return attributes;
  });
  return (
    links.find((link) => link.rel === "alternate" && link.href)?.href ??
    links.find((link) => !link.rel && link.href)?.href ??
    ""
  );
}

export function parseFeedEntries(xml) {
  const rssItems = tagBlocks(xml, "item");
  const blocks = rssItems.length > 0 ? rssItems : tagBlocks(xml, "entry");
  const isAtom = rssItems.length === 0;

  return blocks
    .map((block) => {
      const rssLink = htmlToText(tagValue(block, ["link"]));
      const guid = htmlToText(tagValue(block, ["guid"]));
      const url = isAtom ? atomLink(block) : rssLink || guid;
      return {
        title: htmlToText(tagValue(block, ["title"])) || "Untitled article",
        url,
        published: htmlToText(tagValue(block, ["pubDate", "published", "dc:date"])),
        updated: htmlToText(tagValue(block, ["updated"])),
        content: htmlToText(
          tagValue(block, ["content:encoded", "content", "description", "summary"]),
        ),
      };
    })
    .filter((entry) => entry.url);
}

export function normalizeArticleUrl(value) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`Unsupported article URL: ${value}`);
  }

  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    const isMediumSource =
      url.hostname.endsWith("medium.com") && key.toLowerCase() === "source";
    if (
      /^utm_/i.test(key) ||
      ["fbclid", "gclid"].includes(key.toLowerCase()) ||
      isMediumSource
    ) {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.sort();
  if (url.pathname.length > 1) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }
  return url.toString();
}

export function urlHash(normalizedUrl) {
  return createHash("sha256")
    .update(normalizedUrl)
    .digest("hex")
    .slice(0, HASH_LENGTH);
}

export function isWithinPastMonth(published, now = new Date()) {
  if (!published) {
    return false;
  }
  const publishedAt = new Date(published);
  if (Number.isNaN(publishedAt.getTime())) {
    return false;
  }
  return publishedAt <= now && publishedAt >= new Date(now.getTime() - MONTH_MS);
}

export function entryIsWithinPastMonth(entry, now = new Date()) {
  return (
    isWithinPastMonth(entry.published, now) ||
    isWithinPastMonth(entry.updated, now)
  );
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function localDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function slugify(title) {
  return (
    title
      .normalize("NFKD")
      .replace(/\p{Mark}/gu, "")
      .toLowerCase()
      .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80)
      .replace(/-$/g, "") || "article"
  );
}

export function buildFilename(title, publishedAt, hash) {
  return `${isoDate(publishedAt)}-${slugify(title)}--${hash}.md`;
}

export function renderClipping({
  title,
  url,
  publishedAt,
  createdAt,
  content,
}) {
  const body = content || "The feed did not provide an article summary.";
  return `---
title: ${JSON.stringify(title)}
source: ${JSON.stringify(url)}
published: ${isoDate(publishedAt)}
created: ${localDate(createdAt)}
---

Source: [Read the original article](<${url}>)

${body}
`;
}

export function synchronizeDigestFrontmatter(source, digest, digestCreatedAt) {
  const sourceMatch = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  const digestMatch = digest.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/);
  if (!sourceMatch || !digestMatch) {
    throw new Error("Unable to synchronize malformed RSS digest frontmatter");
  }

  return `---
${sourceMatch[1]}
digest_created: ${localDate(digestCreatedAt)}
---

${digestMatch[1].trimStart()}`;
}

function readFeedUrls() {
  return readFileSync(FEEDS_FILE, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

export function sourceUrlFromNote(note) {
  const frontmatter = note.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
  const source = frontmatter.match(
    /^source:\s*(?:"([^"]+)"|'([^']+)'|(\S.*?))\s*$/m,
  );
  return source?.[1] ?? source?.[2] ?? source?.[3] ?? "";
}

function knownHashes() {
  const hashes = new Set();
  for (const directory of [CLIPPINGS_DIR, DIGEST_DIR, SAVED_DIR]) {
    let filenames = [];
    try {
      filenames = readdirSync(directory);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
    for (const filename of filenames) {
      const match = filename.match(/--([a-f0-9]{12})\.md$/);
      if (match) {
        hashes.add(match[1]);
      }
      if (!filename.endsWith(".md")) {
        continue;
      }
      const note = readFileSync(path.join(directory, filename), "utf8");
      const sourceUrl = sourceUrlFromNote(note);
      if (sourceUrl) {
        try {
          hashes.add(urlHash(normalizeArticleUrl(sourceUrl)));
        } catch {
          // Ignore non-URL source fields from unrelated notes.
        }
      }
    }
  }
  return hashes;
}

function rssDigestContents() {
  const contents = new Map();
  for (const directory of [DIGEST_DIR, SAVED_DIR]) {
    let filenames = [];
    try {
      filenames = readdirSync(directory);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
    for (const filename of filenames) {
      if (/--[a-f0-9]{12}\.md$/.test(filename)) {
        contents.set(filename, readFileSync(path.join(directory, filename), "utf8"));
      }
    }
  }
  return contents;
}

function synchronizeChangedRssDigests(previousContents, now) {
  for (const filename of readdirSync(CLIPPINGS_DIR)) {
    if (!/--[a-f0-9]{12}\.md$/.test(filename)) {
      continue;
    }
    const source = readFileSync(path.join(CLIPPINGS_DIR, filename), "utf8");
    for (const directory of [DIGEST_DIR, SAVED_DIR]) {
      const digestPath = path.join(directory, filename);
      let digest;
      try {
        digest = readFileSync(digestPath, "utf8");
      } catch (error) {
        if (error.code === "ENOENT") {
          continue;
        }
        throw error;
      }
      if (previousContents.get(filename) !== digest) {
        writeFileSync(
          digestPath,
          synchronizeDigestFrontmatter(source, digest, now),
          "utf8",
        );
      }
    }
  }
}

async function fetchFeed(feedUrl) {
  const response = await fetch(feedUrl, {
    headers: { "user-agent": "rss-digest/1.0" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`${feedUrl}: HTTP ${response.status}`);
  }
  const entries = parseFeedEntries(await response.text());
  if (entries.length === 0 && response.headers.get("content-type")?.includes("text/html")) {
    throw new Error(`${feedUrl}: no RSS or Atom entries found`);
  }
  return entries.map((entry) => ({
    ...entry,
    url: new URL(entry.url, feedUrl).href,
  }));
}

async function main() {
  const feedUrls = readFeedUrls();
  if (feedUrls.length === 0) {
    log(`No feeds configured in ${FEEDS_FILE}`);
    return;
  }

  mkdirSync(CLIPPINGS_DIR, { recursive: true });
  const hashes = knownHashes();
  const now = new Date();
  let createdCount = 0;
  let failedFeedCount = 0;

  const results = await Promise.allSettled(
    feedUrls.map(async (feedUrl) => ({
      feedUrl,
      entries: await fetchFeed(feedUrl),
    })),
  );

  for (const result of results) {
    if (result.status === "rejected") {
      failedFeedCount += 1;
      console.error(`${LOG_PREFIX} Feed failed: ${result.reason.message}`);
      continue;
    }

    for (const entry of result.value.entries) {
      if (!entryIsWithinPastMonth(entry, now)) {
        continue;
      }

      let normalizedUrl;
      try {
        normalizedUrl = normalizeArticleUrl(entry.url);
      } catch (error) {
        console.error(`${LOG_PREFIX} Skipping ${entry.url}: ${error.message}`);
        continue;
      }

      const hash = urlHash(normalizedUrl);
      if (hashes.has(hash)) {
        continue;
      }

      const publishedAt = new Date(entry.published || entry.updated);
      const filename = buildFilename(entry.title, publishedAt, hash);
      writeFileSync(
        path.join(CLIPPINGS_DIR, filename),
        renderClipping({
          title: entry.title,
          url: entry.url,
          publishedAt,
          createdAt: now,
          content: entry.content,
        }),
        { encoding: "utf8", flag: "wx" },
      );
      hashes.add(hash);
      createdCount += 1;
      log(`Fetched: ${filename}`);
    }
  }

  log(`Fetched ${createdCount} new entries from the past 30 days.`);
  const previousDigestContents = rssDigestContents();
  execFileSync(DIGEST_SCRIPT, { stdio: "inherit" });
  synchronizeChangedRssDigests(previousDigestContents, now);

  if (failedFeedCount > 0) {
    throw new Error(`${failedFeedCount} feed(s) failed`);
  }
}

const isMain =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  main().catch((error) => {
    console.error(`${LOG_PREFIX} ${error.message}`);
    process.exitCode = 1;
  });
}
