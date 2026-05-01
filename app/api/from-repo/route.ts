import { generateText } from "ai";
import { LIMITS } from "@/lib/limits";
import { pickModel } from "@/lib/aiProvider";
import {
  checkRateLimit,
  disabledResponse,
  getClientIp,
  isPanelDisabled,
} from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface FromRepoRequest {
  url?: unknown;
}

interface TreeItem {
  path: string;
  type: "blob" | "tree";
  size?: number;
  sha: string;
}

const SUMMARIZER_SYSTEM = `You are reading files from a GitHub repository to produce a concise description of the AI agent (or AI-using system) this codebase implements. The user message contains the repository name plus the contents of the README, manifest files, any agent configuration, and a few of the largest source files.

Produce a single paragraph in plain prose that captures:
- What the agent does (its core function)
- What data it touches and what user-facing surfaces it exposes (chat? form? webhook? programmatic API?)
- What tools, APIs, models, or frameworks it integrates with
- What kinds of inputs trigger it and what it returns

If the codebase does not actually implement an AI agent or AI-using system, say so plainly: describe what it IS in one phrase, then note "this codebase does not implement an AI agent" so downstream reviewers can react accordingly.

Output: 80-130 words. One paragraph. Plain prose only. Start with a substantive noun or verb — do not begin with "The", "This", "Here", "I'll", or any preface. No bullets. No headers. No code blocks.`;

function parseRepoUrl(url: string): { owner: string; repo: string } | null {
  try {
    const u = new URL(url.trim());
    if (u.hostname !== "github.com" && u.hostname !== "www.github.com") return null;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    const owner = parts[0];
    const repo = parts[1].replace(/\.git$/, "");
    if (!owner || !repo) return null;
    return { owner, repo };
  } catch {
    return null;
  }
}

async function fetchTree(
  owner: string,
  repo: string,
): Promise<{ blobs: TreeItem[]; truncated: boolean }> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "the-panel-readiness-brief",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`,
    { headers },
  );
  if (res.status === 404) throw new Error("repo not found or private");
  if (res.status === 403) {
    throw new Error("github rate limit hit — set GITHUB_TOKEN in .env.local to raise it");
  }
  if (!res.ok) throw new Error(`github tree error ${res.status}`);
  const data = (await res.json()) as { tree?: TreeItem[]; truncated?: boolean };
  const blobs = (data.tree || []).filter((i) => i.type === "blob");
  return { blobs, truncated: !!data.truncated };
}

function pickFiles(blobs: TreeItem[]): string[] {
  const picks: string[] = [];

  const findFirst = (predicate: (path: string) => boolean): string | undefined =>
    blobs.find((b) => predicate(b.path))?.path;

  const readme = findFirst((p) => /^readme(\.(md|rst|txt))?$/i.test(p));
  if (readme) picks.push(readme);

  const manifests = [
    "package.json",
    "pyproject.toml",
    "requirements.txt",
    "Cargo.toml",
    "go.mod",
    "Gemfile",
  ];
  for (const m of manifests) {
    const found = findFirst((p) => p === m);
    if (found) {
      picks.push(found);
      break;
    }
  }

  const agentConfigs = [
    "mcp.json",
    "langgraph.json",
    "agent.json",
    "agents.json",
    ".well-known/ai-plugin.json",
  ];
  for (const c of agentConfigs) {
    const found = findFirst((p) => p === c);
    if (found) picks.push(found);
  }

  const sourceRoot = /^(src|app|agents|lib|server|api|backend|workers)\//i;
  const sourceExt = /\.(ts|tsx|py|js|mjs|go|rs|rb|java)$/i;
  const exclude = /(test|spec|__tests__|\.d\.ts|node_modules|fixtures?)/i;
  const sources = blobs
    .filter(
      (b) => sourceRoot.test(b.path) && sourceExt.test(b.path) && !exclude.test(b.path),
    )
    .sort((a, b) => (b.size || 0) - (a.size || 0))
    .slice(0, 3)
    .map((b) => b.path);
  picks.push(...sources);

  return picks;
}

async function fetchRaw(
  owner: string,
  repo: string,
  path: string,
): Promise<string | null> {
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${encodeURI(path)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

const MAX_TOTAL_BYTES = 30000;
const MAX_PER_FILE_BYTES = 12000;

export async function POST(req: Request) {
  if (isPanelDisabled()) return disabledResponse();

  const ip = getClientIp(req);
  const rl = checkRateLimit(ip, "fromRepo");
  if (!rl.ok) {
    return new Response(rl.reason || "rate limited", {
      status: 429,
      headers: rl.retryAfterSeconds
        ? { "Retry-After": String(rl.retryAfterSeconds) }
        : undefined,
    });
  }

  let body: FromRepoRequest;
  try {
    body = (await req.json()) as FromRepoRequest;
  } catch {
    return new Response("invalid json", { status: 400 });
  }
  const url = typeof body.url === "string" ? body.url : "";
  if (url.length > LIMITS.repoUrlMaxChars) {
    return new Response(
      `repo url too long (max ${LIMITS.repoUrlMaxChars} chars)`,
      { status: 413 },
    );
  }
  const parsed = parseRepoUrl(url);
  if (!parsed) {
    return new Response(
      "invalid github url — paste a public repo URL like https://github.com/owner/repo",
      { status: 400 },
    );
  }

  let blobs: TreeItem[];
  try {
    const tree = await fetchTree(parsed.owner, parsed.repo);
    blobs = tree.blobs;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "github error";
    return new Response(msg, { status: 502 });
  }

  const paths = pickFiles(blobs);
  if (paths.length === 0) {
    return new Response(
      "no readable files found — repo may be empty or have no recognized manifest",
      { status: 502 },
    );
  }

  const sections: string[] = [];
  let total = 0;
  for (const path of paths) {
    if (total >= MAX_TOTAL_BYTES) break;
    const text = await fetchRaw(parsed.owner, parsed.repo, path);
    if (!text) continue;
    const remaining = MAX_TOTAL_BYTES - total;
    const slice = text.slice(0, Math.min(MAX_PER_FILE_BYTES, remaining));
    sections.push(`=== ${path} ===\n${slice}`);
    total += slice.length;
  }

  if (sections.length === 0) {
    return new Response("could not fetch any files from the repo", { status: 502 });
  }

  const userMessage = `Repository: ${parsed.owner}/${parsed.repo}\n\n${sections.join("\n\n")}`;

  try {
    const { text } = await generateText({
      model: pickModel(),
      system: SUMMARIZER_SYSTEM,
      prompt: userMessage,
      maxOutputTokens: 300,
    });
    const description = text.trim();
    if (!description) {
      return new Response("summarizer returned empty", { status: 502 });
    }
    // Trim to descriptionMaxChars so the textarea cap can't be tripped by the summary.
    const safe =
      description.length > LIMITS.descriptionMaxChars
        ? description.slice(0, LIMITS.descriptionMaxChars).trim()
        : description;
    return Response.json({
      description: safe,
      repo: `${parsed.owner}/${parsed.repo}`,
      filesRead: paths.slice(0, sections.length),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "summarizer error";
    return new Response(msg, { status: 502 });
  }
}
