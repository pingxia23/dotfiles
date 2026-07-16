#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import path from "node:path";

const DEFAULT_OWNER_LOGIN = "pingxia23";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function usage() {
  fail(`Usage: ${path.basename(process.argv[1] ?? "upsert_pr_comment.mjs")} --pr-url <url> --marker <marker> (--body <body> | --delete-existing) [--owner-login <login>] [--gh-function <function>]`);
}

function parseArgs(argv) {
  const args = {
    prUrl: "",
    marker: "",
    body: null,
    ownerLogin: DEFAULT_OWNER_LOGIN,
    ghFunction: "gh",
    deleteExisting: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];

    if (arg === "--pr-url") {
      args.prUrl = value ?? "";
      index += 1;
    } else if (arg === "--marker") {
      args.marker = value ?? "";
      index += 1;
    } else if (arg === "--body") {
      args.body = value ?? "";
      index += 1;
    } else if (arg === "--owner-login") {
      args.ownerLogin = value ?? "";
      index += 1;
    } else if (arg === "--gh-function") {
      args.ghFunction = value ?? "";
      index += 1;
    } else if (arg === "--delete-existing") {
      args.deleteExisting = true;
    } else if (arg === "--help" || arg === "-h") {
      usage();
    } else {
      fail(`unknown argument: ${arg}`);
    }
  }

  if (
    !args.prUrl ||
    !args.marker ||
    !args.ownerLogin ||
    !args.ghFunction ||
    (args.deleteExisting ? args.body !== null : args.body === null)
  ) {
    usage();
  }

  return args;
}

function parsePrUrl(prUrl) {
  const trimmed = prUrl.split("#", 1)[0].split("?", 1)[0];
  const match = trimmed.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/([0-9]+)$/);
  if (!match) {
    fail(`Unsupported PR URL: ${prUrl}`);
  }

  const [, owner, repoName, prNumber] = match;
  return {
    repo: `${owner}/${repoName}`,
    prNumber,
    canonicalPrUrl: `https://github.com/${owner}/${repoName}/pull/${prNumber}`,
  };
}

function runGh(ghFunction, args, failureMessage) {
  try {
    return execFileSync(
      "zsh",
      [
        "-ic",
        'source "$HOME/dotfiles/zshrc"; "$@"',
        "upsert-pr-comment-gh",
        ghFunction,
        ...args,
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  } catch {
    fail(failureMessage);
  }
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

function findExistingComment({
  repo,
  prNumber,
  ownerLogin,
  marker,
  ghFunction,
}) {
  const commentsText = runGh(
    ghFunction,
    ["api", "--paginate", "--slurp", `repos/${repo}/issues/${prNumber}/comments?per_page=100`],
    `Unable to load PR comments for ${repo}#${prNumber}`,
  );

  return flattenSlurpedPages(parseJson(commentsText, "PR comments"))
    .filter((comment) => comment?.user?.login === ownerLogin && comment?.body?.includes(marker))
    .sort((left, right) => {
      const leftCreated = left.created_at ?? "";
      const rightCreated = right.created_at ?? "";
      if (leftCreated !== rightCreated) {
        return leftCreated.localeCompare(rightCreated);
      }
      return Number(left.id ?? 0) - Number(right.id ?? 0);
    })
    .at(-1);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const { repo, prNumber, canonicalPrUrl } = parsePrUrl(args.prUrl);
  const body = args.body;

  if (!args.deleteExisting) {
    if (!body.trim()) {
      fail("Comment body must not be empty");
    }
    if (!body.includes(args.marker)) {
      fail("Comment body must include hidden marker");
    }
  }

  const existingComment = findExistingComment({
    repo,
    prNumber,
    ownerLogin: args.ownerLogin,
    marker: args.marker,
    ghFunction: args.ghFunction,
  });

  if (args.deleteExisting) {
    if (existingComment) {
      runGh(
        args.ghFunction,
        [
          "api",
          "--method",
          "DELETE",
          `repos/${repo}/issues/comments/${existingComment.id}`,
        ],
        `Unable to delete PR comment for ${canonicalPrUrl}`,
      );
    }
    console.log(
      JSON.stringify(
        {
          action: existingComment ? "deleted" : "skipped",
          comment_url: existingComment?.html_url ?? "",
        },
        null,
        2,
      ),
    );
    return;
  }

  const responseText = existingComment
    ? runGh(
        args.ghFunction,
        ["api", "--method", "PATCH", `repos/${repo}/issues/comments/${existingComment.id}`, "-f", `body=${body}`],
        `Unable to update PR comment for ${canonicalPrUrl}`,
      )
    : runGh(
        args.ghFunction,
        ["api", "--method", "POST", `repos/${repo}/issues/${prNumber}/comments`, "-f", `body=${body}`],
        `Unable to create PR comment for ${canonicalPrUrl}`,
      );

  const response = parseJson(responseText, "comment response");
  const commentUrl = response.html_url ?? "";
  if (!commentUrl) {
    fail(`Unable to determine comment URL for ${canonicalPrUrl}`);
  }

  console.log(
    JSON.stringify(
      {
        action: existingComment ? "updated" : "created",
        comment_url: commentUrl,
      },
      null,
      2,
    ),
  );
}

main();
