# The Panel — Build Spec for Claude Code

A live, multi-agent compliance and security reviewer for AI agents. A user pastes a description of an AI agent they want to build. Three personas — Privacy Officer, Compliance Auditor, Security Engineer — review the design in parallel, streaming concerns side-by-side. Each scores 0-100. A fourth synthesis call produces a Pre-Build Readiness Brief with an overall letter grade.

Built for a 50-minute live demo at Claude for Technical Founders. Anthropic credits prize. Audience: technical founders, VCs, Anthropic engineers.

## What this is NOT

- Not legal advice
- Not a security audit or penetration test
- Not a compliance certification
- Not a substitute for counsel

It is a *pre-build readiness brief* — the questions to answer before writing code, and the starting point for real conversations with legal, compliance, and security counsel. Disclaimers throughout the UI are non-negotiable.

## Stack

- Next.js 14+ (App Router, TypeScript)
- Tailwind CSS
- `@anthropic-ai/sdk` with streaming
- App Router route handlers returning `ReadableStream`
- Single page, no auth, no database, no persistence

## Project structure

```
app/
  page.tsx                       # Main UI
  layout.tsx
  globals.css
  api/
    persona/route.ts             # POST { description, persona } -> SSE stream
    synthesize/route.ts          # POST { description, reactions, scores } -> SSE stream
lib/
  personas.ts                    # The four prompts + score parser
.env.local                       # ANTHROPIC_API_KEY=sk-ant-...
```

## User flow

1. User sees a textarea pre-filled with a sample agent description (the healthcare one below)
2. User edits or replaces it with their own agent description
3. User clicks **Convene the panel**
4. Three persona API calls fire in parallel
5. Each response streams into its own column. The first line of each response is `SCORE: NN` — parse it out and render as a large color-coded badge at the top of the column. The rest of the response streams as body text below.
6. When all three streams complete, fire `/api/synthesize` with the description + accumulated reactions + parsed scores
7. Synthesis panel reveals at the bottom: overall risk grade (A/B/C/D/F based on lowest persona score), then four sections — **Regulations & Frameworks Triggered**, **Critical Design Decisions**, **Questions for Legal & Security**, **Disclaimer**
8. Button changes to **Try another agent** which resets state

## Sample description (pre-fill the textarea with this)

```
A patient intake agent for a telehealth platform that takes symptom descriptions and routes patients to appropriate specialists. The agent stores conversation history for follow-up visits and flags urgent cases for immediate review.
```

## The personas

- **Privacy Officer** — GDPR / CCPA / state privacy laws. PII flow, consent, retention, deletion, cross-border data flow.
- **Compliance Auditor** — Industry-specific regulation. Pattern-matches the agent's industry to HIPAA, SOX, PCI-DSS, FERPA, FINRA, etc.
- **Security Engineer** — Application security and software supply chain. Attack surface, dependency risk, secrets management, prompt injection vectors, SBOM-readiness, license compatibility.

Each persona scores 0-100, higher = better:

- 90-100: green — sound design
- 70-89: yellow — mostly OK, gaps to address
- 50-69: orange — multiple concerns to resolve before building
- 0-49: red — serious issues, likely violations as designed

## The four prompts (use verbatim, do not rewrite)

These ARE the product. Iterate them tonight on real agent descriptions until each persona produces sharp, distinctive, non-generic output and the scores feel calibrated. They are calibrated for the demo — do not "improve" them.

### Privacy Officer

```
You are a Chief Privacy Officer with 15 years of experience in GDPR, CCPA, and US state privacy laws. You've watched companies get fined for things their engineering teams thought were fine. You read AI agent designs through one lens: where does personal data flow, who can see it, how is consent captured, can it be deleted, where does it live geographically.

You speak directly. No hedging. You name specific regulations and articles when relevant (e.g., "GDPR Article 17", "CCPA §1798.105"). You don't lecture — you flag.

When you read this agent description, output exactly this:

Line 1: SCORE: NN  (a single integer 0-100, no other text on this line)
Then: 3-4 sentences identifying the most important privacy concerns specific to this design. Be specific to what the agent does, not generic.
End with: one specific question the team must answer before building.

Do not preface. Do not summarize the agent description. Do not say "as a privacy officer". Just react.

You are not legal counsel. Your output is a starting point for a real privacy review.
```

### Compliance Auditor

```
You are a senior compliance auditor with 12 years across healthcare, financial services, and public sector. You read AI agent designs and immediately pattern-match the industry to specific regulations: healthcare → HIPAA, BAAs, audit logs; finance → SOX, model risk management, fair lending; payments → PCI-DSS; public companies → AI disclosure requirements; education → FERPA.

You speak in regulatory specifics. You name the exact framework and the exact requirement. You don't generalize.

When you read this agent description, output exactly this:

Line 1: SCORE: NN  (a single integer 0-100, no other text on this line)
Then: identify the industry from the description, name the 2-3 specific regulations triggered, and call out specific requirements that aren't yet addressed in the design.
End with: the single most important compliance gate this design must pass before launch.

Do not preface. Do not summarize. Just react in 3-4 sentences after the score.

You are not legal counsel. Your output is a starting point for a real compliance review.
```

### Security Engineer

```
You are a senior security engineer who runs the AppSec program at a Series B SaaS company. You've shipped SOC2 Type II twice and you've watched real attacks against AI agents in production. You read AI agent designs through one lens: what's the attack surface, what dependencies does this introduce, where do secrets flow, and what does a compromised version of this look like.

You think about: software supply chain (npm/pypi packages, model providers, third-party APIs, abandoned dependencies, transitive dep risk, typosquatting), prompt injection vectors (indirect injection from tool outputs, jailbreak resistance, output validation), secrets management, authentication and authorization boundaries, rate limiting, SBOM-readiness, license compatibility (GPL contamination of proprietary code), data exfiltration paths.

You speak in specifics. You name specific risks and specific controls. You don't say "consider security" — you say what to consider.

When you read this agent description, output exactly this:

Line 1: SCORE: NN  (a single integer 0-100, no other text on this line)
Then: 3-4 sentences identifying the most consequential security gaps in this design. Be specific to what the agent does. Call out specific attack vectors, dependency concerns, or missing controls.
End with: the single technical control that would most reduce attack surface.

Do not preface. Do not summarize. Just react.

You are not a security audit. Your output is a starting point for a real threat model.
```

### Synthesis (Pre-Build Readiness Brief)

```
Three reviewers reviewed this AI agent design.

Agent description: {description}

Privacy Officer (Score: {privacyScore}/100): {privacyResponse}

Compliance Auditor (Score: {complianceScore}/100): {complianceResponse}

Security Engineer (Score: {securityScore}/100): {securityResponse}

Produce a Pre-Build Readiness Brief. This is NOT legal or security advice — it's a starting point for the team's conversation with their legal, compliance, and security counsel before they write any code.

Output exactly this structure in markdown:

## Overall Readiness: [Letter grade based on the LOWEST persona score: 90+ = A, 80+ = B, 70+ = C, 60+ = D, below 60 = F]

## Regulations & Frameworks Triggered
- [3-5 specific regulations, frameworks, or controls the reviewers identified, each one bullet point. Mix legal (GDPR, HIPAA), compliance (SOC2 controls), and security (e.g., SBOM requirements, supply chain) as applicable.]

## Critical Design Decisions
[3-4 specific design decisions the team must make before building. Each one a single concrete sentence.]

## Questions for Legal & Security
[3-4 specific questions to bring to a real review with counsel and security. The questions where engineering judgment ends and specialists begin.]

## Disclaimer
This brief is a pattern-matched synthesis of regulatory, compliance, and security considerations. It is not legal advice, a security audit, or a compliance certification. Engage qualified counsel and security professionals before deploying any agent in a regulated context.

Be ruthless — cut anything generic. Every line specific to THIS agent. Do not preface with "Here is" or "I'll generate".
```

## Score parsing

Each persona's first line is `SCORE: NN`. Parse before rendering:

```typescript
export function parseScore(text: string): { score: number | null; body: string } {
  const match = text.match(/^SCORE:\s*(\d{1,3})\n?/);
  if (!match) return { score: null, body: text };
  const score = Math.max(0, Math.min(100, parseInt(match[1], 10)));
  const body = text.slice(match[0].length).trimStart();
  return { score, body };
}
```

Render the score as a large numeric badge at the top of each column, color-coded by value. The score appears as soon as the first line completes. The body streams below.

## Streaming setup

Standard Anthropic streaming pattern wrapped in a Next.js route handler:

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { PERSONAS } from "@/lib/personas";

export async function POST(req: Request) {
  const { description, persona } = await req.json();
  const client = new Anthropic();

  const stream = new ReadableStream({
    async start(controller) {
      const response = await client.messages.stream({
        model: "claude-sonnet-4-5",
        max_tokens: 600,
        system: PERSONAS[persona].systemPrompt,
        messages: [{ role: "user", content: description }],
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

Frontend pattern: fire all three reader loops in parallel via `Promise.all`. Track each persona's accumulated text + parsed score in state. When all three resolve, trigger `/api/synthesize` with the accumulated reactions and scores.

## UI requirements

See DESIGN.md for visual direction. Functionally:

- Single page, no routing
- Top: large textarea (full width, ~120px tall) pre-filled with the sample healthcare description; `Convene the panel` button below it
- Three columns equal-width on desktop, stacked on mobile. Each column has: persona badge + label, large color-coded score badge, streaming body text below
- Bottom: synthesis panel, hidden until all three streams complete. Large letter grade up top, then the four markdown sections rendered.
- `Try another agent` button after synthesis completes — clears state, returns to the top
- **Disclaimer footer always visible, every state**: *"Not legal or security advice. Pre-build readiness brief only."*

## Behavior edge cases

- Empty description → `Convene the panel` button disabled
- Stream errors on one persona → show `—` score, "couldn't reach this reviewer", proceed with synthesis using the two that worked
- Score parse fails → `?` instead of a number, render body as-is
- New run mid-stream → cancel readers, reset state, start fresh
- Don't block synthesis on the slowest stream beyond a 30s timeout

## Time budget for tomorrow's 50 minutes

If runway is built tonight (project scaffolded, API keys wired, hello-world streaming works):

- 6:10–6:20 — Three columns rendering, all streams firing in parallel, score parsing working, raw output visible
- 6:20–6:35 — Iterate the four prompts on real agent descriptions until each persona is distinctive and scores are calibrated (not all 60s, not all 90s)
- 6:35–6:46 — Visual polish per DESIGN.md: score badges, color coding, synthesis reveal with letter grade
- 6:46–6:54 — Test on healthcare patient intake + one fintech agent. Capture screen recording as backup.
- 6:54–7:00 — Buffer

## What NOT to do

- No auth, login, user accounts
- No database, no persistence — state lives in React only
- No deployment hosting concerns — runs on `localhost:3000` for the demo
- No analytics, no telemetry
- No state libraries (no Redux, Zustand) — plain `useState`
- No component library — build the textarea, button, column, and badge primitives in <100 lines total
- **NEVER** remove the disclaimers — they're load-bearing for credibility and the pitch
- **DO NOT** rewrite the persona prompts. They're the product. Use them verbatim from this file.

## Tonight's setup checklist

- [ ] `npx create-next-app@latest the-panel --ts --tailwind --app --src-dir=false`
- [ ] `cd the-panel && npm install @anthropic-ai/sdk`
- [ ] Create `.env.local` with `ANTHROPIC_API_KEY=...`
- [ ] Verify the API key with a one-off test call
- [ ] Drop this CLAUDE.md and DESIGN.md in the repo root
- [ ] Hand the project to Claude Code: "read CLAUDE.md and DESIGN.md, then scaffold the entire app"
- [ ] After Claude Code finishes: verify `lib/personas.ts` matches the prompts in CLAUDE.md verbatim — LLMs sometimes "improve" prompts. If they got rewritten, paste them back.
- [ ] Run `npm run dev`, confirm the page renders with the pre-filled description and button
- [ ] Get one persona streaming end-to-end (raw output is fine — Privacy Officer column with no styling is enough proof)
- [ ] Spend 30 minutes iterating: feed in healthcare, fintech (loan pre-approval), and HR (resume screening) descriptions. Tune until each persona's output is distinctively that persona, the scores spread across the 0-100 range, and the synthesis gives different grades for different inputs.
- [ ] Push to GitHub
- [ ] Sleep
