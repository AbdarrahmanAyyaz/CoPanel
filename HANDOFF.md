# The Panel — Engineering Handoff

A reference packet for Claude Code. The prototype lives in `The Panel.html` — open it to see streaming behavior, dimming transitions, and synthesis reveal. This file captures the design tokens, layout rules, and animation timings to lift directly into the Next.js / Tailwind build.

---

## 1. Stack the design assumes

- **Framework:** Next.js 14 / app router (`app/page.tsx`, `app/layout.tsx`)
- **Styling:** Tailwind only — no separate stylesheet
- **Fonts:** loaded via `next/font/google` in `app/layout.tsx`
- **Streaming:** real `fetch` to your Anthropic-backed route, three parallel calls, plus a fourth synthesis call that fires when all three resolve
- **No component library.** Build the textarea, button, and column primitives inline — total < 100 lines

---

## 2. Type system

Two families. Serif does the editorial heavy lifting; sans is for chrome and reactions.

| Family | Source | Variable |
|---|---|---|
| **Instrument Serif** | Google Fonts — weights 400 regular + italic | `--font-serif` |
| **Inter** | Google Fonts — 300 / 400 / 500 / 600 | `--font-sans` |
| **JetBrains Mono** | Google Fonts — 400 / 500 (used for kicker / labels / counts) | `--font-mono` |

```tsx
// app/layout.tsx
import { Instrument_Serif, Inter, JetBrains_Mono } from 'next/font/google'

const serif = Instrument_Serif({ weight: ['400'], style: ['normal','italic'], variable: '--font-serif', subsets: ['latin'] })
const sans  = Inter({ weight: ['300','400','500','600'], variable: '--font-sans', subsets: ['latin'] })
const mono  = JetBrains_Mono({ weight: ['400','500'], variable: '--font-mono', subsets: ['latin'] })
```

### Type scale

| Role | Family | Size | Line | Letter | Weight |
|---|---|---|---|---|---|
| Wordmark | serif | 30px | 1.0 | -0.01em | 400 |
| Hero headline (`h1`) | serif | clamp(64px, 8vw, 112px) | 1.05 | -0.025em | 400 |
| Standfirst | serif | 22px | 1.5 | 0 | 400 |
| Section rule label | mono | 11px | 1 | 0.18em | 400 (uppercase) |
| Field label | mono | 11px | 1 | 0.16em | 400 (uppercase) |
| Textarea | serif | 26px | 1.5 | -0.005em | 400 |
| Persona role badge | sans | 11px | 1 | 0.18em | 500 (uppercase) |
| Persona name | serif italic | 22px | 1.1 | 0 | 400 |
| Persona tagline | sans | 12px | — | 0.04em | 400 |
| Persona reaction | sans | 16px | 1.6 | 0 | 400 |
| Convene button | sans | 13px | 1 | 0.06em | 500 (uppercase) |
| Status text ("reading…") | serif italic | 22px | — | 0 | 400 |
| Verdict label ("The Verdict") | serif italic | 28px | — | -0.01em | 400 |
| Synthesis body | serif | 26px | 1.5 | -0.005em | 400 |
| Synthesis drop cap | serif | 96px | 0.85 | 0 | 400 |

**Stand-back test (the brief asks for it):** at 1440px viewport, every body text is ≥16px and every reaction stream is set 16px / 1.6. The synthesis is set 26px so it reads first from across the room.

---

## 3. Color tokens

Black-first, off-white foreground. **No saturated whites** — the foreground is a hair warm to feel paper-like under projector light.

```css
--bg:        #0a0a0a;   /* page */
--bg-tint:   #0f0f0f;   /* (reserved, unused in v1) */
--fg:        #f5f3ee;   /* headlines, body */
--fg-dim:    rgba(245,243,238,0.62);  /* standfirst, secondary */
--fg-faint:  rgba(245,243,238,0.34);  /* mono labels, hints */
--rule:      rgba(245,243,238,0.10);  /* dividers, column borders */
--rule-soft: rgba(245,243,238,0.05);  /* disabled-button border */

/* Persona accents — used for the 1px column rule, the letter badge, the streaming dot */
--engineer:  #34d399;   /* cool green */
--vc:        #a78bfa;   /* deep violet */
--customer:  #fbbf24;   /* warm amber */
```

**Accent usage rules:**
- 1px left border on the column (animated in on stream-start)
- Letter badge: 1px circle stroke + the letter, both in accent
- Streaming dot pulses in accent; when done, becomes a hollow circle + checkmark in accent
- Streaming caret on the last word also picks up accent
- **Nowhere else.** No accent fills, no accent text, no accent backgrounds.

---

## 4. Layout & spacing

Single column, no nav, no sidebar. The whole page is one editorial spread.

```css
--max-width: 1280px;
--page-pad-x: 64px;     /* mobile: 24px */
--page-pad-top: 96px;   /* mobile: 56px */
--page-pad-bot: 160px;  /* mobile: 96px */
```

### Vertical rhythm (top to bottom)

| Block | Margin-top |
|---|---|
| Masthead | — |
| Hero | 80px (h1 → standfirst gap: 64px — Instrument Serif italic descenders need the air) |
| Submission card | 72px |
| Bench section | 120px |
| Synthesis section | 140px |
| Colophon | 160px |

Inside the submission card: textarea wrap is `border-top + border-bottom 1px rule`, padded `28px 0`. Submit row: `28px` margin-top.

### Bench grid

```
desktop: grid-template-columns: repeat(3, 1fr); gap: 0;
column padding: 0 32px;
column borders: border-left 1px rule; last column also border-right
column min-height: 320px (so empty/idle state holds the layout)
mobile (<900px): single column, columns get border-top instead of border-left
```

### Synthesis body

`max-width: 70ch; margin: 0 auto;` — narrower than the bench above so the verdict feels like print.

---

## 5. Animation timings

The animation system is the demo's signature. Three rules:

1. **Three columns stream simultaneously**, never sequentially.
2. **Phrase-chunk fade-in**, never typewriter. Group 3–5 words, fade as a unit (~520ms ease, slight blur + 2px translateY).
3. **Synthesis reveals dramatically** — the bench dims, then the verdict label and rule animate in, then serif body streams.

### Token table

| Animation | Duration | Easing | Notes |
|---|---|---|---|
| Chunk fade-in (column reactions) | 520ms | ease | from `opacity:0; blur(2px); translateY(2px)` to identity |
| Chunk fade-in (synthesis body) | 700ms | ease | slower — feels weightier |
| Submission card dim (when convened) | 600ms | ease | `opacity: 1 → 0.28; blur(0) → blur(1px)` |
| Bench dim (when synthesizing) | 700ms | ease | `opacity: 1 → 0.32; saturate(1) → saturate(0.6)` |
| Synthesis section reveal | 1100ms | ease, 200ms delay | `opacity 0→1; translateY(24px → 0)` |
| Verdict rule line draw | 900ms | `cubic-bezier(0.2, 0.6, 0.2, 1)`, 300ms delay | `transform-origin: left; scaleX 0 → 1` |
| "Try another version" button | 700ms | ease, 1200ms delay (after synthesis complete) | fade-in |
| Streaming dot pulse | 1.4s | ease-in-out infinite | opacity 0.25 ↔ 1 |
| Caret blink | 0.9s | steps(2) infinite | binary opacity |
| Column accent rule grow-in | 600ms | ease | `height: 0 → 100%`, triggered on `streaming`/`done` |

### Per-persona stream pacing

Each persona reveals chunks at a slightly different cadence — gives the bench texture instead of robotic uniformity.

| Persona | ms-per-chunk | + jitter |
|---|---|---|
| Engineer | 75ms | + random 0–60ms |
| VC / Investor | 105ms | + random 0–60ms |
| Customer | 95ms | + random 0–60ms |
| Synthesis | 140ms | + random 0–60ms |

### Sequencing

```
t=0          user clicks "Convene the panel"
t=0+         all three columns enter "pending" (italic "Reading…")
             submission card dims (600ms)
t≈400ms      first reaction arrives → that column flips to "streaming",
             accent rule animates in, dot pulses, chunks begin
…            other two columns flip to streaming as their fetches resolve
t=last+~0    last column finishes → 900ms beat of silence
t=last+900   bench dims (700ms saturate↓ + opacity↓)
             synthesis section fades+slides in (1100ms, 200ms delay)
             verdict rule scaleX in (900ms, 300ms delay)
             synthesis chunks begin streaming
t=synth_end  "Try another version" button fades in (700ms, 1200ms delay)
```

---

## 6. State model

The prototype uses one phase machine + per-column state:

```ts
type Phase = 'idle' | 'running' | 'synthesizing' | 'complete'
type ColumnState = 'idle' | 'pending' | 'streaming' | 'done'
```

| Phase | What's visible |
|---|---|
| `idle` | textarea active, "Convene" button (disabled until text exists) |
| `running` | textarea dims; status "The panel is reading…"; columns stream |
| `synthesizing` | bench dims; synthesis fades in and streams |
| `complete` | "The panel has spoken." status; "Try another version" button visible |

**Error case:** if a single fetch rejects, that column's state goes to `done` with `error: true` and renders an em-dash + "couldn't reach this reviewer" in `--fg-faint`. The other two carry on. Synthesis still fires, omitting the failed reviewer.

---

## 7. Streaming implementation

The brief asks for real streaming. Wire it to your Anthropic route with `stream: true` and parse SSE on the client. **Do not** drive the chunk-fade animation directly off raw token arrival — it's too jittery. Instead:

1. Buffer incoming tokens in `useRef` strings, one per persona.
2. Run a `requestAnimationFrame` (or `setTimeout`-loop) consumer that pulls 3–5-word phrase chunks off each buffer at the per-persona cadence above.
3. Render each chunk as `<span class="chunk">` so CSS handles the fade.

This decouples animation pace from network jitter. The phrase-chunker logic is in the prototype (`chunkText()` and `useChunkReveal()`).

If you'd rather keep it simple for v1: do single-shot completions in parallel, then reveal each result chunk-by-chunk on the client at the cadence above. The audience cannot tell the difference, and the demo is bulletproof.

---

## 8. Persona system prompts

Lift these verbatim. Tone separation is the whole point.

### Engineer (terse, technical, dry)
> You are a senior staff engineer with 15+ years building distributed systems. You read pitches like architecture diagrams. You're not impressed by buzzwords; you ask where the load shifts, what fails first, what the unit economics of a single inference call actually are. Tone: terse, technically precise, dry. Occasionally cutting. Never hedge with "interesting." Get to the load-bearing question fast.
>
> Output: 90–120 words. Three short paragraphs max. No bullet points. No headers. No preamble. Plain prose only.

### Investor (measured, pattern-matching)
> You are a Series A partner at a top-tier fund. You've sat through 4,000 pitches. You're listening for one thing: why this team, why now, what's defensible in 36 months when the foundation models are ten times cheaper. Tone: measured, slightly skeptical, pattern-matching. You name the comparable companies you'd benchmark against.
>
> Output: 90–120 words. Two or three paragraphs. No bullets. Plain prose only.

### Customer (warm, first-person, specific)
> You are a head of growth at a mid-market B2B SaaS company. You'd be the buyer. You're warm, curious, but your time is money. You translate the pitch into "would I open this on a Tuesday morning?" You worry about onboarding, about brand voice control, about who gets blamed when the AI says something dumb on LinkedIn. Tone: friendly, conversational, real. Use first-person. Mention something concrete from your day.
>
> Output: 90–120 words. Two or three short paragraphs. Plain prose only.

### Synthesis editor
> You are the editor of a panel of three reviewers — an engineer, an investor, and a customer — who have just reacted to a pitch. Receive their three reactions and write the verdict: a single tight paragraph in the voice of a careful, slightly literary editor.
>
> Not a summary. A synthesis: the version of the pitch that survives all three perspectives. State what the pitch is actually claiming, where the three reviewers converge, where they diverge, and what the strongest version of this idea would have to prove next. Magazine voice — no bullets, no "the panel agrees that," no hedging. The first sentence should land.
>
> Output: 110–150 words. One paragraph.

---

## 9. Tailwind config additions

```ts
// tailwind.config.ts
export default {
  theme: {
    extend: {
      colors: {
        bg: '#0a0a0a',
        'bg-tint': '#0f0f0f',
        fg: '#f5f3ee',
        'fg-dim': 'rgba(245,243,238,0.62)',
        'fg-faint': 'rgba(245,243,238,0.34)',
        rule: 'rgba(245,243,238,0.10)',
        'rule-soft': 'rgba(245,243,238,0.05)',
        engineer: '#34d399',
        vc: '#a78bfa',
        customer: '#fbbf24',
      },
      fontFamily: {
        serif: ['var(--font-serif)', 'Georgia', 'serif'],
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      maxWidth: { panel: '1280px' },
      letterSpacing: {
        wider: '0.18em',
        widest: '0.18em',
      },
      keyframes: {
        chunkIn: {
          '0%': { opacity: '0', filter: 'blur(2px)', transform: 'translateY(2px)' },
          '100%': { opacity: '1', filter: 'blur(0)', transform: 'translateY(0)' },
        },
        pulseSoft: {
          '0%,100%': { opacity: '0.25' },
          '50%': { opacity: '1' },
        },
      },
      animation: {
        chunkIn: 'chunkIn 520ms ease forwards',
        pulseSoft: 'pulseSoft 1.4s ease-in-out infinite',
      },
    },
  },
}
```

---

## 10. Things to NOT do (from the brief, restated)

- No emojis, anywhere.
- No gradients beyond the body's barely-visible vignette.
- No box shadows. (None. Even subtle ones flag this as "AI app.")
- No icons except the three persona letter badges + streaming dot/checkmark.
- No "AI" branding, no "powered by" badges, no Anthropic logos.
- No skeleton loaders. The streaming itself is the loading state.
- No SaaS-y hover effects (no scale-up, no color shifts on the columns).
- No "Powered by Claude," no chatbot affordances, no message-bubble anything.

---

## 11. Stand-back checklist before shipping

1. Project at full brightness. Stand 10 feet back.
2. Can you read "Three reviewers. One pitch." from there? It's 96px+ — you should.
3. Is the bench legible? Reaction text is 16px on a 1440px screen — should hold.
4. Is the synthesis the visual climax? The bench should noticeably dim (`opacity: 0.32; saturate(0.6)`) when the verdict appears. If it doesn't, your transition isn't firing.
5. Are all three columns streaming at once on convene? If they go in sequence you've broken Promise.all somewhere.
6. Does the convene button disappear during run? It should be replaced by italic "The panel is reading…"

If any of those fail, the demo will read as a hackathon project. Fix before stage.

---

*Built for stage. Read from the back of the room.*
