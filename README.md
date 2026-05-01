# The Panel

A live, multi-agent compliance and security reviewer for AI agents. Paste a description of an agent you want to build (or a public GitHub repo). Three reviewers — a Privacy Officer, a Compliance Auditor, and a Security Engineer — score it 0–100 and react in parallel. A fourth pass produces a Pre-Build Readiness Brief with an overall letter grade.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FAbdarrahmanAyyaz%2FCoPanel&env=GOOGLE_GENERATIVE_AI_API_KEY,ANTHROPIC_API_KEY,GITHUB_TOKEN&envDescription=Set%20at%20least%20one%20provider%20key.%20Gemini%20is%20auto-preferred%20when%20both%20are%20present.&project-name=the-panel&repository-name=the-panel)

> **Not legal or security advice.** Pre-build readiness brief only. Engage qualified counsel and security professionals before deploying any agent in a regulated context.

---

## What it is

The four prompts in `lib/personas.ts` are the product. The rest of the code is plumbing.

- **Privacy Officer** — reads through GDPR, CCPA, US state-privacy lenses. Names specific regulations and articles (e.g., "GDPR Article 17"). Flags PII flow, consent, retention, deletion, geographic data residency.
- **Compliance Auditor** — pattern-matches the agent's industry to specific regulatory frameworks (HIPAA, SOX, PCI-DSS, FERPA, FINRA). Names the exact framework, not generalizations.
- **Security Engineer** — application security, software supply chain, prompt injection vectors, SBOM-readiness, secrets management.
- **Editor (synthesis)** — produces a structured markdown brief with an overall letter grade, regulations triggered, critical design decisions, questions for legal & security, and a non-negotiable disclaimer.

## What it isn't

Not legal advice. Not a security audit. Not a compliance certification. Not a substitute for counsel. It is a *pre-build readiness brief* — the questions to answer before writing code.

## Stack

- Next.js 15 (App Router, TypeScript)
- Tailwind CSS, Instrument Serif + Inter + JetBrains Mono via `next/font`
- Vercel AI SDK (`ai` + `@ai-sdk/google` + `@ai-sdk/anthropic`) — provider auto-detected from env
- Streaming via App Router `ReadableStream` route handlers
- No auth, no database, no persistence — state lives in React only

## Run it locally

```bash
git clone https://github.com/AbdarrahmanAyyaz/CoPanel
cd CoPanel
npm install
cp .env.local.example .env.local
# edit .env.local — set GOOGLE_GENERATIVE_AI_API_KEY (free tier at https://aistudio.google.com)
#                or ANTHROPIC_API_KEY (paid)
npm run dev
```

Open `http://localhost:3000` and paste an agent description. The textarea is pre-filled with a healthcare patient-intake example.

## Deploy your own

Click the **Deploy with Vercel** button above. It clones the repo, asks for your provider keys, and gives you your own production URL in ~60 seconds. Free Vercel plan + Gemini free tier = $0 to host indefinitely (within the free-tier ceilings).

## Connect a public GitHub repo

Below the textarea there's a "read from a public GitHub repo" input. Paste a public repo URL and the server fetches the README, manifest (`package.json` / `pyproject.toml` / etc.), any agent configs (`mcp.json`, `langgraph.json`, `agent.json`, `.well-known/ai-plugin.json`), and the largest 3 source files from `src/`, `app/`, `agents/`, `lib/`, etc. The provider summarizes them into an 80–130 word agent description that fills the textarea — review or edit, then convene the panel.

Set `GITHUB_TOKEN` in `.env.local` to raise the GitHub API rate limit from 60/hr to 5000/hr (no scopes needed for public repos).

## Environment variables

| Var | Required? | Default |
|---|---|---|
| `GOOGLE_GENERATIVE_AI_API_KEY` *or* `GEMINI_API_KEY` | one provider key required | — |
| `ANTHROPIC_API_KEY` | one provider key required | — |
| `GEMINI_MODEL_ID` | optional | `gemini-3-flash` |
| `ANTHROPIC_MODEL_ID` | optional | `claude-sonnet-4-5` |
| `GITHUB_TOKEN` | optional, but useful for `/api/from-repo` | — |
| `PANEL_DISABLED` | optional kill switch (`"1"` = all routes return 503) | — |

## Customizing

- **Swap a persona's voice** — edit `lib/personas.ts`. Keep the `SCORE: NN` first-line contract.
- **Add a fourth reviewer** — extend the `PersonaId` union, add an entry to `PERSONAS`, add the ID to `PERSONA_ORDER`. The UI grid is `repeat(3, 1fr)` on desktop; you'll want to adjust to 4 columns or wrap.
- **Tighten the brief format** — edit `SYNTHESIS_SYSTEM_PROMPT` and `buildSynthesisUserMessage` in `lib/personas.ts`.
- **Switch model** — set `GEMINI_MODEL_ID` or `ANTHROPIC_MODEL_ID` in `.env.local`. Smarter models give sharper reactions; smaller ones reduce cost.

## Architecture

```
User → app/page.tsx
         │
         ├─ POST /api/from-repo   (optional: GitHub URL → agent description)
         │     fetches README + manifest + agent configs + top sources
         │     → generateText (provider) → 80–130 word description
         │
         ├─ POST /api/persona     × 3 in parallel
         │     each persona's system prompt + the agent description
         │     → streamText (provider) → SCORE: NN + reaction body
         │
         └─ POST /api/synthesize  (after all three columns finish)
               description + reactions + scores
               → streamText (provider) → markdown brief with letter grade
```

The streaming UI uses a 3–5 word phrase chunker (`lib/chunkText.ts`) with per-persona cadence so the columns don't read robotically. The score on each column is parsed from the first line and rendered as a color-coded numeric badge. The synthesis section displays an aggregate letter grade computed from the lowest persona score, then the four markdown sections.

## Rate limiting

The hosted demo runs in-memory per-IP rate limits in each Vercel function instance. Limits:

- `/api/persona` — 15/min, 90/hour, 300/day per IP
- `/api/synthesize` — 10/min, 60/hour, 200/day per IP
- `/api/from-repo` — 10/hour, 30/day per IP
- Description hard cap: 2000 characters
- Repo URL hard cap: 200 characters

These are best-effort. Vercel may spawn parallel instances under load; in-memory counters don't share state across them. The actual ceiling is the provider's own free-tier quota — when Gemini's daily token budget is exhausted, the panel fails gracefully until reset. To run with real per-IP rate limiting, swap in [Upstash Redis](https://upstash.com) — a few lines in `lib/rateLimit.ts`.

For unlimited use, fork the repo and run it with your own provider key.

## License

MIT — see `LICENSE`.

## Credits

Built for the Claude for Technical Founders demo. The persona prompts are tuned for live demos in front of technical audiences; iterate them on real agent descriptions to find your own voice.
