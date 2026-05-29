#!/usr/bin/env node

import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DIGEST_DIR = path.join(os.homedir(), "Documents/obsidian/Digests");
const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const LOG_PREFIX = "[hacker-digest]";
const HN_URL = "https://news.ycombinator.com/";
const DISCUSSION_COUNT = 20;
const REVIEW_FOOTER_PREFIX = "Review Hacker News digest";

function log(message) {
  const timestamp = new Date().toISOString();
  console.log(`${timestamp} ${LOG_PREFIX} ${message}`);
}

function logError(message) {
  const timestamp = new Date().toISOString();
  console.error(`${timestamp} ${LOG_PREFIX} ${message}`);
}

function todayLocalDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function decodeHtml(value) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, number) => String.fromCodePoint(Number.parseInt(number, 10)))
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripTags(value) {
  return decodeHtml(value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

function absoluteUrl(url) {
  if (/^https?:\/\//i.test(url)) {
    return decodeHtml(url);
  }

  return new URL(decodeHtml(url), HN_URL).toString();
}

function parseHackerNewsFrontPage(html) {
  const stories = [];
  const storyRegex = /<tr class="athing submission" id="(\d+)">([\s\S]*?)<\/tr>\s*<tr>([\s\S]*?)<\/tr>/g;

  for (const match of html.matchAll(storyRegex)) {
    const [, id, storyRow, subtextRow] = match;
    const rankMatch = storyRow.match(/<span class="rank">(\d+)\.<\/span>/);
    const titleMatch = storyRow.match(/<span class="titleline"><a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    const siteMatch = storyRow.match(/<span class="sitestr">([\s\S]*?)<\/span>/);
    const scoreMatch = subtextRow.match(/<span class="score"[^>]*>(\d+) points?<\/span>/);
    const authorMatch = subtextRow.match(/<a href="user\?id=[^"]+" class="hnuser">([\s\S]*?)<\/a>/);
    const ageMatch = subtextRow.match(/<span class="age"[^>]*><a href="item\?id=\d+">([\s\S]*?)<\/a><\/span>/);
    const commentsMatch = subtextRow.match(/<a href="item\?id=\d+">((?:\d+&nbsp;comments)|discuss)<\/a>/);

    if (!titleMatch || !commentsMatch) {
      continue;
    }

    const commentsText = decodeHtml(commentsMatch[1]);
    const commentCount = commentsText === "discuss" ? 0 : Number.parseInt(commentsText, 10);

    stories.push({
      rank: rankMatch ? Number.parseInt(rankMatch[1], 10) : stories.length + 1,
      id,
      title: stripTags(titleMatch[2]),
      url: absoluteUrl(titleMatch[1]),
      site: siteMatch ? stripTags(siteMatch[1]) : "news.ycombinator.com",
      score: scoreMatch ? Number.parseInt(scoreMatch[1], 10) : 0,
      author: authorMatch ? stripTags(authorMatch[1]) : null,
      age: ageMatch ? stripTags(ageMatch[1]) : null,
      comments: commentCount,
      discussionUrl: `https://news.ycombinator.com/item?id=${id}`,
    });

    if (stories.length >= DISCUSSION_COUNT) {
      break;
    }
  }

  return stories;
}

function containsRejectedOutput(file) {
  const content = fs.readFileSync(file, "utf8");
  return /failed to authenticate\. api error:|invalid internal auth token|not enough segments|^\{"errors"|^\[\{"status"|title":"unauthorized"/im.test(content);
}

function isValidDigestOutput(file, reviewFooter) {
  const content = fs.readFileSync(file, "utf8");
  if (content.length === 0) {
    return false;
  }

  if (content === "Nothing interesting today.") {
    return true;
  }

  const lines = content.split(/\r?\n/);
  const firstLine = lines[0] ?? "";
  const lastNonemptyLine = [...lines].reverse().find((line) => line.trim().length > 0) ?? "";
  return firstLine.startsWith("## ") && lastNonemptyLine === reviewFooter;
}

function createPrompt({ today, outputFile, reviewFooter, stories }) {
  return `Create a daily Hacker News intelligence digest for ${today}.

READER

The reader is a software engineer who wants Hacker News to surface useful signals in three lanes:

1. Technical: new tools, new libraries, technical design discussions, architecture tradeoffs, implementation details, benchmarks, debugging lessons, infrastructure patterns, AI/ML engineering, and other concrete engineering learnings.
2. Career development: how software engineers grow their careers, improve judgment, work with AI tools, become staff/principal-level engineers, manage scope, handle interviews, choose jobs, avoid burnout, collaborate better, or navigate the changing engineering job market.
3. Startup, product, and industry updates: startup news, Show HN launches, cool products people are showcasing, founder stories, startup ideas, market shifts, company/product announcements, funding/acquisition/business news when it changes the builder landscape, pricing/distribution lessons, and industry trends.

The digest should not be only a technical digest. It should help the reader learn what is technically interesting, what is professionally useful, and what is happening in startups/products/industry today.

INPUT

The calling script fetched the top ${DISCUSSION_COUNT} current discussions from ${HN_URL}. Use this snapshot as the candidate set:

${JSON.stringify(stories, null, 2)}

For each candidate:

- Use discussionUrl as the Hacker News discussion link.
- Read the HN discussion when comments are likely to add useful context, objections, technical details, founder/customer signal, or career perspective.
- Read the linked source when it is relevant and accessible.
- Combine the source and HN discussion into one item. Do not write separate items for the source and the comments.

SELECTION RULES

Select the strongest items across the three interest lanes. Target 6-10 items, but do not include filler. If only a few items are genuinely useful, include only those.

Prefer a balanced digest when the front page supports it:

- Include technical items when they teach concrete engineering details.
- Include career items when they give useful software-engineer career judgment or workplace lessons.
- Include startup/product/industry items when they reveal a notable company move, product launch, market shift, startup idea, founder lesson, or product/business pattern.

Do not select items only because they have many points or comments. Select them because a busy engineer would be glad to have read the summary.

Good HN digest items can include:

- A new library, tool, framework, database, model, devtool, hardware project, or infrastructure product.
- A technical design debate with tradeoffs and constraints.
- A benchmark, incident, migration, or debugging writeup with numbers.
- A career essay or thread about engineering growth, hiring, AI impact on engineers, management, staff engineering, or productivity.
- A Show HN or product demo that is genuinely interesting as a product, startup, UX pattern, technical execution, or market wedge.
- Startup or company news that changes the industry context for builders.
- Founder stories with concrete lessons about building, selling, positioning, pricing, or distribution.
- Industry updates that explain where developer attention, customer budgets, platforms, regulations, or AI/product markets are moving.

Usually skip:

- Job posts.
- Pure politics or culture-war threads.
- Generic business news with no builder, career, product, market, or technical lesson.
- Product announcements that only say "X launched" without explaining why it matters.
- Trivia that is interesting but not useful.
- Threads where neither the article nor comments add real signal.

WRITING STYLE

Use plain English. Be concrete and concise. Avoid hype and vague words like "innovative", "important", or "game-changing" unless you explain exactly why.

Every selected item should answer:

- What happened or what was discussed?
- Why should a software engineer care?
- What can the reader learn technically, professionally, or strategically?

OUTPUT RULES

If there are no relevant discussions, write exactly:

Nothing interesting today.

Otherwise:

- Start directly with the first ## heading.
- No frontmatter.
- No table of contents.
- No intro or outro.
- Use the Hacker News discussion URL as the heading link.
- Include inline markdown links where claims, numbers, or details come from the source or HN discussion.
- Do not add a separate Sources section.
- Each item must be self-contained. The reader should get the useful signal without clicking through.

FORMAT FOR EACH ITEM

## [Topic title](hacker_news_discussion_url) — Technical | Career | Startup | Industry

Choose one or two labels after the dash. Examples:

- Technical
- Career
- Startup
- Industry
- Technical / Startup
- Career / Industry

### Why It Matters

1-2 bullets explaining why this is worth the reader's attention. Keep each bullet to 1-2 sentences.

### Key Takeaways

3-5 bullets. Each bullet must teach one concrete thing. Format each as:

- **[Short phrase]** — 1-2 sentences with specific details, tradeoffs, numbers, names, tools, market context, or career lesson.

### Builder Notes

Include this section only when the item suggests actions, experiments, startup ideas, product opportunities, technical practices, or career moves. Otherwise omit it.

1-3 bullets. Start each with a verb. Make them practical, not generic.

QUALITY BAR

- Technical items must explain mechanisms, architecture, tradeoffs, implementation details, or concrete numbers.
- Career items must explain a specific professional lesson or decision pattern for software engineers.
- Startup/product/industry items must explain what changed, why the product/company/news is interesting, and what signal builders should take from it.
- Show HN/product items should cover what the product does, who it appears to be for, why it is interesting, and any notable product/technical/business angle.
- Startup ideas should name the pain, likely user/customer, wedge, and constraint when the source supports it.
- Industry updates should explain the second-order implication for engineers, founders, products, or developer tools.
- If claims are uncertain or debated in the HN thread, say so.
- Do not invent numbers, traction, pricing, or market size. If those details are missing, say what is observable instead.
- Prefer useful synthesis over exhaustive summary.

ENDING

For successful digests only, at the very end add one blank line and then exactly:

${reviewFooter}

IMPORTANT: Write ONLY the final markdown content to ${outputFile}. No preamble, no code fences, no commentary.
IMPORTANT: The file must be exactly one of these forms:
- The exact text: Nothing interesting today.
- A markdown digest that starts with ## on the first line and ends with the exact review checkbox line above.
IMPORTANT: If any API call fails, browsing fails completely, WebFetch/WebSearch is unavailable, authentication errors occur, or the linked sources cannot be checked well enough to produce a reliable digest, do NOT write ${outputFile}. Do not write error messages, do not write partial digests, do not write explanations.
IMPORTANT: Never write raw error text or payloads such as:
- Failed to authenticate
- API Error
- Unauthorized
- Invalid JWT
- {"errors": ...}
- [{"status":401, ...}]
`;
}

async function main() {
  const today = todayLocalDate();
  const digestFile = path.join(DIGEST_DIR, `${today}-hacker-digest.md`);
  const reviewFooter = `- [ ] ${REVIEW_FOOTER_PREFIX} ${today} 📅 ${today}`;

  log(`Generating digest for ${today}`);
  log(`Digest path: ${digestFile}`);
  log(`Script directory: ${SCRIPT_DIR}`);

  if (fs.existsSync(digestFile) && fs.statSync(digestFile).size > 0) {
    log(`Digest already exists at ${digestFile}, skipping.`);
    return;
  }

  if (fs.existsSync(digestFile) && fs.statSync(digestFile).size === 0) {
    log("Removing empty digest file from failed run.");
    fs.rmSync(digestFile);
  }

  const claudePath = childProcess.spawnSync("command", ["-v", "claude"], {
    shell: true,
    encoding: "utf8",
  }).stdout.trim();
  if (!claudePath) {
    throw new Error("claude CLI is not installed or not on PATH.");
  }

  log(`Fetching ${HN_URL}`);
  const response = await fetch(HN_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch Hacker News: HTTP ${response.status}`);
  }

  const html = await response.text();
  const stories = parseHackerNewsFrontPage(html);
  if (stories.length < DISCUSSION_COUNT) {
    throw new Error(`Expected ${DISCUSSION_COUNT} Hacker News discussions, found ${stories.length}.`);
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hacker-digest-"));
  const outputFile = path.join(tempDir, "output.md");

  try {
    const prompt = createPrompt({ today, outputFile, reviewFooter, stories });

    log(`Invoking claude for ${stories.length} discussions.`);
    const result = childProcess.spawnSync(
      "claude",
      [
        "-p",
        prompt,
        "--model",
        "claude-opus-4-7[1m]",
        "--no-session-persistence",
        "--allowedTools",
        "Read,Write,Edit,Bash,Glob,Grep,WebFetch,WebSearch",
      ],
      {
        encoding: "utf8",
        maxBuffer: 1024 * 1024 * 20,
        stdio: ["ignore", "ignore", "pipe"],
      },
    );

    if (result.status !== 0) {
      if (result.stderr) {
        logError(result.stderr.trim());
      }
      throw new Error("Claude invocation failed; digest not created.");
    }

    if (!fs.existsSync(outputFile) || fs.statSync(outputFile).size === 0) {
      throw new Error("Claude did not write the digest file; digest not created.");
    }

    if (containsRejectedOutput(outputFile)) {
      throw new Error("Rejected digest output containing error text; digest not created.");
    }

    if (!isValidDigestOutput(outputFile, reviewFooter)) {
      throw new Error("Rejected invalid digest output; digest not created.");
    }

    fs.mkdirSync(DIGEST_DIR, { recursive: true });
    fs.renameSync(outputFile, digestFile);
    log(`Digest saved to ${digestFile}`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  logError(error.message);
  process.exitCode = 1;
});
