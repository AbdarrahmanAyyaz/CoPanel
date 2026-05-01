import { streamText } from "ai";
import {
  SYNTHESIS_SYSTEM_PROMPT,
  buildSynthesisUserMessage,
  type PersonaId,
} from "@/lib/personas";
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

interface SynthesizeRequest {
  description?: unknown;
  reactions?: unknown;
  scores?: unknown;
}

function pickReactions(value: unknown): Partial<Record<PersonaId, string>> {
  if (!value || typeof value !== "object") return {};
  const v = value as Record<string, unknown>;
  const out: Partial<Record<PersonaId, string>> = {};
  for (const id of ["privacy", "compliance", "security"] as PersonaId[]) {
    const r = v[id];
    if (typeof r === "string" && r.trim().length > 0) {
      out[id] = r.slice(0, LIMITS.reactionMaxChars);
    }
  }
  return out;
}

function pickScores(value: unknown): Partial<Record<PersonaId, number>> {
  if (!value || typeof value !== "object") return {};
  const v = value as Record<string, unknown>;
  const out: Partial<Record<PersonaId, number>> = {};
  for (const id of ["privacy", "compliance", "security"] as PersonaId[]) {
    const s = v[id];
    if (typeof s === "number" && Number.isFinite(s)) {
      out[id] = Math.max(0, Math.min(100, Math.round(s)));
    }
  }
  return out;
}

export async function POST(req: Request) {
  if (isPanelDisabled()) return disabledResponse();

  const ip = getClientIp(req);
  const rl = checkRateLimit(ip, "synthesize");
  if (!rl.ok) {
    return new Response(rl.reason || "rate limited", {
      status: 429,
      headers: rl.retryAfterSeconds
        ? { "Retry-After": String(rl.retryAfterSeconds) }
        : undefined,
    });
  }

  let body: SynthesizeRequest;
  try {
    body = (await req.json()) as SynthesizeRequest;
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  const description =
    typeof body.description === "string" ? body.description.trim() : "";
  const reactions = pickReactions(body.reactions);
  const scores = pickScores(body.scores);

  if (!description) return new Response("description required", { status: 400 });
  if (description.length > LIMITS.descriptionMaxChars) {
    return new Response(
      `description too long (max ${LIMITS.descriptionMaxChars} chars)`,
      { status: 413 },
    );
  }
  if (Object.keys(reactions).length === 0) {
    return new Response("at least one reaction required", { status: 400 });
  }

  const userMessage = buildSynthesisUserMessage({
    description,
    reactions,
    scores,
  });
  const upstreamAbort = new AbortController();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      const safeClose = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* already torn down */
        }
      };
      const safeError = (err: unknown) => {
        if (closed) return;
        closed = true;
        try {
          controller.error(err);
        } catch {
          /* already torn down */
        }
      };
      try {
        const result = streamText({
          model: pickModel(),
          system: SYNTHESIS_SYSTEM_PROMPT,
          prompt: userMessage,
          maxOutputTokens: 1200,
          abortSignal: upstreamAbort.signal,
        });
        for await (const chunk of result.textStream) {
          if (closed) break;
          if (chunk.length > 0) controller.enqueue(encoder.encode(chunk));
        }
        safeClose();
      } catch (err) {
        safeError(err);
      }
    },
    cancel() {
      upstreamAbort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
