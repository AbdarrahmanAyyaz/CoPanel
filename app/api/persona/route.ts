import Anthropic from "@anthropic-ai/sdk";
import { MODEL_ID, PERSONAS, type PersonaId } from "@/lib/personas";

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
  if (!personaId) return new Response("invalid persona", { status: 400 });

  const persona = PERSONAS[personaId];
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
            system: persona.systemPrompt,
            messages: [{ role: "user", content: description }],
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
