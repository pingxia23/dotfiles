#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function usage() {
  fail(`Usage: ${path.basename(process.argv[1] ?? "fetch-pr-context.mjs")} <pr-url>`);
}

function parsePrUrl(prUrl) {
  const trimmed = prUrl.split("#", 1)[0].split("?", 1)[0];
  const match = trimmed.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/([0-9]+)$/);
  if (!match) {
    fail(`Unsupported PR URL: ${prUrl}`);
  }

  const [, owner, repoName, prNumber] = match;
  return {
    owner,
    repoName,
    repo: `${owner}/${repoName}`,
    prNumber,
    canonicalPrUrl: `https://github.com/${owner}/${repoName}/pull/${prNumber}`,
  };
}

function runGh(args, failureMessage) {
  try {
    return execFileSync("gh", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    fail(failureMessage);
  }
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    fail(`Unable to parse ${label}`);
  }
}

function flattenSlurpedPages(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((page) => (Array.isArray(page) ? page : [page]));
}

function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1) {
    usage();
  }

  const { owner, repoName, repo, prNumber, canonicalPrUrl } = parsePrUrl(args[0]);
  const bundleDir = mkdtempSync(path.join(tmpdir(), "pr-review-guidance."));

  const prJsonPath = path.join(bundleDir, "pr.json");
  const filesJsonPath = path.join(bundleDir, "files.json");
  const commentsJsonPath = path.join(bundleDir, "comments.json");
  const reviewThreadsJsonPath = path.join(bundleDir, "review_threads.json");
  const diffPatchPath = path.join(bundleDir, "diff.patch");

  const prText = runGh(
    [
      "pr",
      "view",
      "--repo",
      repo,
      prNumber,
      "--json",
      "number,title,author,body,baseRefName,headRefName,headRefOid,additions,deletions,changedFiles,url",
    ],
    `Unable to load PR metadata for ${canonicalPrUrl}`,
  );
  const pr = parseJson(prText, "PR metadata");
  writeFileSync(prJsonPath, prText.endsWith("\n") ? prText : `${prText}\n`, "utf8");

  const filesText = runGh(
    ["api", "--paginate", "--slurp", `repos/${repo}/pulls/${prNumber}/files?per_page=100`],
    `Unable to load PR files for ${canonicalPrUrl}`,
  );
  writeJson(filesJsonPath, flattenSlurpedPages(parseJson(filesText, "PR files")));

  const commentsText = runGh(
    ["api", "--paginate", "--slurp", `repos/${repo}/issues/${prNumber}/comments?per_page=100`],
    `Unable to load PR comments for ${canonicalPrUrl}`,
  );
  writeJson(commentsJsonPath, flattenSlurpedPages(parseJson(commentsText, "PR comments")));

  const reviewThreadsQuery = `
query($owner: String!, $name: String!, $number: Int!, $endCursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $endCursor) {
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          originalLine
          startLine
          originalStartLine
          diffSide
          subjectType
          comments(first: 100) {
            nodes {
              id
              fullDatabaseId
              url
              body
              createdAt
              diffHunk
              author {
                login
              }
              replyTo {
                fullDatabaseId
              }
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
}
`;

  const reviewThreadsText = runGh(
    [
      "api",
      "graphql",
      "--paginate",
      "--slurp",
      "-F",
      `owner=${owner}`,
      "-F",
      `name=${repoName}`,
      "-F",
      `number=${prNumber}`,
      "-f",
      `query=${reviewThreadsQuery}`,
    ],
    `Unable to load PR review threads for ${canonicalPrUrl}`,
  );
  const reviewThreads = flattenSlurpedPages(parseJson(reviewThreadsText, "PR review threads"))
    .flatMap((page) => page?.data?.repository?.pullRequest?.reviewThreads?.nodes ?? [])
    .filter((thread) => !thread.isResolved && !thread.isOutdated);
  writeJson(reviewThreadsJsonPath, reviewThreads);

  const diffPatch = runGh(
    ["pr", "diff", "--repo", repo, prNumber, "--patch"],
    `Unable to load PR diff for ${canonicalPrUrl}`,
  );
  writeFileSync(diffPatchPath, diffPatch, "utf8");

  console.log(
    JSON.stringify(
      {
        repo,
        pr_number: Number(prNumber),
        pr_url: canonicalPrUrl,
        author_login: pr.author?.login ?? "",
        head_sha: pr.headRefOid ?? "",
        bundle_dir: bundleDir,
      },
      null,
      2,
    ),
  );
}

main();
