import { streamText } from "ai";
import { PERSONAS, type PersonaId } from "@/lib/personas";
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

interface PersonaRequest {
  description?: unknown;
  persona?: unknown;
}

function isPersonaId(v: unknown): v is PersonaId {
  return v === "privacy" || v === "compliance" || v === "security";
}

export async function POST(req: Request) {
  if (isPanelDisabled()) return disabledResponse();

  const ip = getClientIp(req);
  const rl = checkRateLimit(ip, "persona");
  if (!rl.ok) {
    return new Response(rl.reason || "rate limited", {
      status: 429,
      headers: rl.retryAfterSeconds
        ? { "Retry-After": String(rl.retryAfterSeconds) }
        : undefined,
    });
  }

  let body: PersonaRequest;
  try {
    body = (await req.json()) as PersonaRequest;
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  const description =
    typeof body.description === "string" ? body.description.trim() : "";
  const personaId = isPersonaId(body.persona) ? body.persona : null;

  if (!description) return new Response("description required", { status: 400 });
  if (description.length > LIMITS.descriptionMaxChars) {
    return new Response(
      `description too long (max ${LIMITS.descriptionMaxChars} chars)`,
      { status: 413 },
    );
  }
  if (!personaId) return new Response("invalid persona", { status: 400 });

  const persona = PERSONAS[personaId];
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
          system: persona.systemPrompt,
          prompt: description,
          maxOutputTokens: 600,
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
