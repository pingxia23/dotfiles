#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { access, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const GITLAB_HOST = "https://gitlab.ddbuild.io";

function usage() {
  console.error(`Usage: ${path.basename(process.argv[1] ?? "fetch-mosaic-ci-log.mjs")} <mosaic-url>

Fetch a GitLab-backed Mosaic CI job trace, write it to a temp file, and print JSON metadata.

Requirements:
  - URL query must include taskId=gitlab and taskExecutionId=<job_id>
  - GITLAB_TOKEN must be set in the environment
`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  if (argv.length !== 1 || argv[0] === "--help" || argv[0] === "-h") {
    if (argv[0] === "--help" || argv[0] === "-h") {
      usage();
      process.exit(0);
    }
    usage();
    process.exit(1);
  }
  return argv[0];
}

function parseGitHubRepoFromRemote(remoteUrl) {
  const match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!match) {
    return null;
  }
  return {
    owner: match[1],
    repository: match[2],
  };
}

function resolveProjectFromGit() {
  try {
    const originUrl = execFileSync("git", ["remote", "get-url", "origin"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return parseGitHubRepoFromRemote(originUrl);
  } catch {
    return null;
  }
}

function requireProject(urlObject) {
  const owner = urlObject.searchParams.get("owner");
  const repository = urlObject.searchParams.get("repository");
  if (owner && repository) {
    return { owner, repository };
  }

  const gitProject = resolveProjectFromGit();
  if (gitProject) {
    return gitProject;
  }

  fail(
    "Unable to resolve owner/repository from the Mosaic URL or current git origin remote."
  );
}

async function fetchJson(url, token) {
  const response = await fetch(url, {
    headers: {
      "PRIVATE-TOKEN": token,
    },
  });

  if (!response.ok) {
    fail(`GitLab API request failed (${response.status}) for ${url}`);
  }

  return response.json();
}

async function fetchText(url, token) {
  const response = await fetch(url, {
    headers: {
      "PRIVATE-TOKEN": token,
    },
  });

  if (!response.ok) {
    fail(`GitLab trace request failed (${response.status}) for ${url}`);
  }

  return response.text();
}

async function writeTraceFile(jobId, traceText) {
  if (!traceText.trim()) {
    fail(`GitLab trace for job ${jobId} was empty.`);
  }

  const tempDir = await mkdtemp(path.join(tmpdir(), `mosaic-ci-${jobId}-`));
  const traceFile = path.join(tempDir, `job-${jobId}.log`);
  await writeFile(traceFile, traceText, "utf8");
  await access(traceFile);
  return traceFile;
}

async function main() {
  const mosaicUrl = parseArgs(process.argv.slice(2));

  let urlObject;
  try {
    urlObject = new URL(mosaicUrl);
  } catch {
    fail(`Invalid URL: ${mosaicUrl}`);
  }

  const taskId = urlObject.searchParams.get("taskId");
  if (taskId !== "gitlab") {
    fail(
      `Unsupported Mosaic backend: ${taskId ?? "missing taskId"}. Only taskId=gitlab is supported.`
    );
  }

  const jobId = urlObject.searchParams.get("taskExecutionId");
  if (!jobId) {
    fail("Missing taskExecutionId in the Mosaic URL.");
  }

  const token = process.env.GITLAB_TOKEN;
  if (!token) {
    fail("Missing GITLAB_TOKEN in the environment.");
  }

  const { owner, repository } = requireProject(urlObject);
  const projectPath = `${owner}/${repository}`;
  const projectEncoded = encodeURIComponent(projectPath);
  const jobUrl = `${GITLAB_HOST}/api/v4/projects/${projectEncoded}/jobs/${jobId}`;
  const traceUrl = `${jobUrl}/trace`;

  const job = await fetchJson(jobUrl, token);
  const traceText = await fetchText(traceUrl, token);
  const traceFile = await writeTraceFile(jobId, traceText);

  console.log(
    JSON.stringify({
      backend: "gitlab",
      host: GITLAB_HOST,
      project_path: projectPath,
      job_id: String(job.id ?? jobId),
      job_name: job.name ?? null,
      job_stage: job.stage ?? null,
      job_status: job.status ?? null,
      ref: job.ref ?? null,
      web_url: job.web_url ?? null,
      trace_file: traceFile,
    })
  );
}

await main();
