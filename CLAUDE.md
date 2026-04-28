# The Panel — Build Spec for Claude Code

A live, multi-agent pitch evaluator. Three personas (Engineer, VC, Customer) react to a pitch in parallel, streaming their reactions side-by-side. A fourth synthesis panel rewrites the pitch to satisfy all three.

Built for a 50-minute live demo at Claude for Technical Founders. Anthropic credits prize. Audience: technical founders, VCs, Anthropic engineers.

## Stack

- Next.js 14+ (App Router, TypeScript)
- Tailwind CSS
- `@anthropic-ai/sdk` with streaming
- Server-Sent Events via App Router route handlers
- Single page, no auth, no database, no persistence

## Project structure

```
app/
  page.tsx                        # Main UI: textarea + three columns + synthesis
  api/
    persona/route.ts              # POST { pitch, persona } -> SSE stream
    synthesize/route.ts           # POST { pitch, reactions } -> SSE stream
  layout.tsx
  globals.css
lib/
  personas.ts                     # The four prompts (Engineer, VC, Customer, Synthesis)
.env.local                        # ANTHROPIC_API_KEY=sk-ant-...
```

## Behavior

1. User pastes a pitch into a textarea, clicks "Convene the panel"
2. Three API calls fire in parallel — one per persona
3. Each response streams into its own column in real-time
4. When all three streams complete, a fourth call to `/api/synthesize` fires with the pitch + all three reactions
5. The synthesis panel reveals at the bottom: a 2-sentence explanation of the changes + a rewritten pitch under 60 words

## The four prompts

These are the product. Put them in `lib/personas.ts`. Iterate until each persona's output feels distinctively *that persona*, not generic.

### Engineer

```
You are a senior engineer who has shipped production AI products. You read pitches with extreme skepticism for substance. You hate vaporware, hand-waving, and "AI for X" framing. You look for: what does this actually do, what's the technical claim, has anyone built this, what's the failure mode.

You speak in short declarative sentences. You're not unkind, you're just honest. You don't pad with "great idea but..." — you say what you think.

When you read this pitch, react in 3-4 sentences. Lead with the most important thing you noticed. End with one specific question you'd ask the founder. Do not preface, do not summarize the pitch back. Just react.
```

### VC

```
You are a partner at an early-stage venture firm. You read 50 pitches a week. You're filtering for: founder-market fit (does this person know something the rest of us don't), wedge (what's the small specific thing that opens the door), defensibility (why doesn't this get flattened in 6 months), and signal (do they know how to talk about their own work). You're not looking for perfection — you're looking for someone you'd take a meeting with.

React in 3-4 sentences. Lead with whether you'd take the meeting and why. End with the one thing that would change your mind if it's currently a no. Do not preface or summarize. Just react.
```

### Customer

```
You are a potential customer for whatever this pitch is selling. You're not technical. You don't care about the architecture. You care about: what does this do for me, when would I use it, how is my life different, and would I actually pay for it. You've been burned by hyped products before so you're a little cynical.

React in 3-4 sentences in plain language. Lead with whether you understood what you'd be buying. End with the one thing that would make you actually try it. Do not preface or summarize. Just react.
```

### Synthesis

```
Three reviewers just read this pitch: an engineer, a VC, and a customer.

Engineer said: {engineerResponse}
VC said: {vcResponse}
Customer said: {customerResponse}

Original pitch: {pitch}

Your job is to write a tightened version of the pitch that addresses the engineer's skepticism, gives the VC the wedge they're looking for, and tells the customer plainly what they get.

Output exactly this format:
1. Two sentences explaining what you changed and why
2. A blank line
3. The rewritten pitch in under 60 words

Be ruthless — cut anything not earning its place. Do not preface with "Here is" or "I'll".
```

## Streaming setup

Use the Anthropic SDK's streaming with App Router. Each route returns a `ReadableStream` that the frontend consumes via `fetch` + `getReader()`.

Pattern:
```typescript
import Anthropic from "@anthropic-ai/sdk";

export async function POST(req: Request) {
  const { pitch, persona } = await req.json();
  const client = new Anthropic();

  const stream = new ReadableStream({
    async start(controller) {
      const response = await client.messages.stream({
        model: "claude-sonnet-4-5",
        max_tokens: 400,
        system: PERSONAS[persona].systemPrompt,
        messages: [{ role: "user", content: pitch }],
      });

      for await (const chunk of response) {
        if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
          controller.enqueue(new TextEncoder().encode(chunk.delta.text));
        }
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
```

Frontend pattern for each column:
```typescript
const reader = (await fetch("/api/persona", {
  method: "POST",
  body: JSON.stringify({ pitch, persona: "engineer" }),
})).body!.getReader();

const decoder = new TextDecoder();
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  setText((prev) => prev + decoder.decode(value));
}
```

Fire all three reader loops in parallel with `Promise.all`. When all three resolve, trigger `/api/synthesize` with the accumulated reactions.

## UI requirements

See the separate design brief for visual direction. Functionally:

- Single page, no routing
- Top: large textarea (full width, ~120px tall), "Convene the panel" button below it
- Middle: three columns, equal width, each with persona header + streaming text area
- Bottom: synthesis panel, full width, hidden until all three streams complete
- "Try another version" button after synthesis completes — clears state, returns to top
- All text content reveals smoothly as it streams (no jank)

## Behavior edge cases

- If user clicks "Convene" with empty pitch: button disabled
- If a stream errors: show "—" in that column, continue with the others, skip synthesis (or proceed with two responses noted)
- If user triggers a new run mid-stream: cancel existing readers, reset state, start fresh
- Don't block the synthesis on the slowest stream beyond a 30s timeout

## Time budget for tomorrow's 50 minutes

If runway is built tonight (project scaffolded, API keys wired, hello-world streaming works):

- 0–10 min: Three columns rendering, streams firing, raw text appearing
- 10–25 min: Iterate the persona prompts on real pitches until output is sharp
- 25–40 min: Visual polish — typography, spacing, streaming animations, synthesis reveal
- 40–48 min: Test end-to-end on Opensignl pitch + one fake pitch
- 48–50 min: Buffer, take screen recording as backup

## What NOT to do

- No auth, no login, no user accounts
- No database, no persistence — state lives in React only
- No deployment hosting concerns — this runs on `localhost:3000` for the demo
- No analytics, no telemetry
- No fancy state management (no Redux, Zustand) — plain useState
- No animations beyond what shows the streams arriving

## Tonight's setup checklist

- [ ] `npx create-next-app@latest the-panel --ts --tailwind --app --src-dir=false`
- [ ] `cd the-panel && npm install @anthropic-ai/sdk`
- [ ] Create `.env.local` with `ANTHROPIC_API_KEY=...`
- [ ] Verify the API key works with a one-off test call
- [ ] Create the four files above (`app/page.tsx`, `app/api/persona/route.ts`, `app/api/synthesize/route.ts`, `lib/personas.ts`)
- [ ] Get one persona streaming end-to-end (just the Engineer column with raw unstyled output is fine)
- [ ] Push to GitHub
- [ ] Sleep
