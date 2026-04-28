import Anthropic from "@anthropic-ai/sdk";
import {
  MODEL_ID,
  SYNTHESIS_SYSTEM_PROMPT,
  buildSynthesisUserMessage,
  type PersonaId,
} from "@/lib/personas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SynthesizeRequest {
  pitch?: unknown;
  reactions?: unknown;
}

function pickReactions(value: unknown): Partial<Record<PersonaId, string>> {
  if (!value || typeof value !== "object") return {};
  const v = value as Record<string, unknown>;
  const out: Partial<Record<PersonaId, string>> = {};
  for (const id of ["engineer", "investor", "customer"] as PersonaId[]) {
    const r = v[id];
    if (typeof r === "string" && r.trim().length > 0) out[id] = r;
  }
  return out;
}

export async function POST(req: Request) {
  let body: SynthesizeRequest;
  try {
    body = (await req.json()) as SynthesizeRequest;
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  const pitch = typeof body.pitch === "string" ? body.pitch.trim() : "";
  const reactions = pickReactions(body.reactions);

  if (!pitch) return new Response("pitch required", { status: 400 });
  if (Object.keys(reactions).length === 0) {
    return new Response("at least one reaction required", { status: 400 });
  }

  const userMessage = buildSynthesisUserMessage({ pitch, reactions });
  const client = new Anthropic();
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
        const response = client.messages.stream(
          {
            model: MODEL_ID,
            max_tokens: 600,
            system: SYNTHESIS_SYSTEM_PROMPT,
            messages: [{ role: "user", content: userMessage }],
          },
          { signal: upstreamAbort.signal },
        );

        for await (const event of response) {
          if (closed) break;
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            controller.enqueue(encoder.encode(event.delta.text));
          }
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
