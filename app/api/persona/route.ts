import Anthropic from "@anthropic-ai/sdk";
import { MODEL_ID, PERSONAS, type PersonaId } from "@/lib/personas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PersonaRequest {
  pitch?: unknown;
  persona?: unknown;
}

function isPersonaId(v: unknown): v is PersonaId {
  return v === "engineer" || v === "investor" || v === "customer";
}

export async function POST(req: Request) {
  let body: PersonaRequest;
  try {
    body = (await req.json()) as PersonaRequest;
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  const pitch = typeof body.pitch === "string" ? body.pitch.trim() : "";
  const personaId = isPersonaId(body.persona) ? body.persona : null;

  if (!pitch) return new Response("pitch required", { status: 400 });
  if (!personaId) return new Response("invalid persona", { status: 400 });

  const persona = PERSONAS[personaId];
  const client = new Anthropic();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      try {
        const response = client.messages.stream({
          model: MODEL_ID,
          max_tokens: 400,
          system: persona.systemPrompt,
          messages: [{ role: "user", content: pitch }],
        });

        for await (const event of response) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "stream error";
        controller.enqueue(encoder.encode(`\n\n[error: ${msg}]`));
      } finally {
        controller.close();
      }
    },
    cancel() {
      // client aborted; nothing else to clean up
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
