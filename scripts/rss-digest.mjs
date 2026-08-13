#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { generateRssDigest } from "./learning-digest.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const FEEDS_FILE = path.join(SCRIPT_DIR, "rss-feeds.txt");
const LOG_PREFIX = "[rss-digest]";
const USAGE = `Usage: rss-digest.mjs [--start <time> --end <time>]

Without arguments, process the complete previous day in the local timezone.
For a backfill, provide both ISO 8601 times. The start is inclusive. The end is exclusive.`;

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

function validDate(value) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function entryPublicationDate(entry) {
  return validDate(entry.published) ?? validDate(entry.updated);
}

export function parseTimeWindow(args, now = new Date()) {
  if (args.length === 0) {
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const start = new Date(end);
    start.setDate(start.getDate() - 1);
    return { end, start };
  }

  let startValue;
  let endValue;
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (!value || !["--start", "--end"].includes(option)) {
      throw new Error(USAGE);
    }
    if (option === "--start") {
      startValue = value;
    } else {
      endValue = value;
    }
  }

  if (!startValue || !endValue) {
    throw new Error(`Both --start and --end are required.\n\n${USAGE}`);
  }
  const start = validDate(startValue);
  const end = validDate(endValue);
  if (!start || !end) {
    throw new Error(`--start and --end must be valid ISO 8601 times.\n\n${USAGE}`);
  }
  if (start >= end) {
    throw new Error("--start must be earlier than --end.");
  }
  return { end, start };
}

export function selectEntriesInWindow(entries, start, end) {
  const candidates = [];

  for (const entry of entries) {
    const publishedAt = entryPublicationDate(entry);
    if (!publishedAt || publishedAt < start || publishedAt >= end) {
      continue;
    }

    let normalizedUrl;
    try {
      normalizedUrl = normalizeArticleUrl(entry.url);
    } catch {
      continue;
    }

    candidates.push({
      content: entry.content || "The feed did not provide an article summary.",
      normalizedUrl,
      publishedAt: publishedAt.toISOString(),
      title: entry.title,
      url: entry.url,
    });
  }

  candidates.sort((left, right) => right.publishedAt.localeCompare(left.publishedAt));

  const seenUrls = new Set();
  return candidates
    .filter(({ normalizedUrl }) => {
      if (seenUrls.has(normalizedUrl)) {
        return false;
      }
      seenUrls.add(normalizedUrl);
      return true;
    })
    .map(({ normalizedUrl: _, ...entry }) => entry);
}

export function selectRecentEntries(entries, now = new Date()) {
  const { end, start } = parseTimeWindow([], now);
  return selectEntriesInWindow(entries, start, end);
}

function readFeedUrls() {
  return readFileSync(FEEDS_FILE, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
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
  return entries.map((entry) => ({
    ...entry,
    url: new URL(entry.url, feedUrl).href,
  }));
}

function printFeedFailures(failures) {
  if (failures.length === 0) {
    return;
  }
  console.log("\n## Feed failures\n");
  for (const failure of failures) {
    console.log(`- ${failure}`);
  }
}

async function main() {
  if (process.argv[2] === "--help") {
    console.log(USAGE);
    return;
  }
  const { end, start } = parseTimeWindow(process.argv.slice(2));
  const feedUrls = readFeedUrls();
  if (feedUrls.length === 0) {
    throw new Error(`No feeds configured in ${FEEDS_FILE}`);
  }

  const results = await Promise.allSettled(feedUrls.map(fetchFeed));
  const entries = [];
  const failures = [];

  for (const [index, result] of results.entries()) {
    if (result.status === "fulfilled") {
      entries.push(...result.value);
    } else {
      failures.push(result.reason?.message ?? `${feedUrls[index]}: unknown error`);
    }
  }

  if (failures.length === feedUrls.length) {
    throw new Error(`All feeds failed:\n- ${failures.join("\n- ")}`);
  }

  const recentEntries = selectEntriesInWindow(entries, start, end);
  if (recentEntries.length === 0) {
    console.log(
      `No RSS entries were published from ${start.toISOString()} through ${end.toISOString()}.`,
    );
  } else {
    const digest = generateRssDigest({
      entries: recentEntries,
      windowEnd: end.toISOString(),
      windowStart: start.toISOString(),
    });
    if (!digest) {
      throw new Error("Digest generation returned no content");
    }
    console.log(digest);
  }

  printFeedFailures(failures);
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
