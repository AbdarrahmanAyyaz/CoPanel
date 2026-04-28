"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PERSONAS, PERSONA_ORDER, type PersonaId } from "@/lib/personas";
import { takeChunk } from "@/lib/chunkText";

type Phase = "idle" | "running" | "synthesizing" | "complete";
type ColumnState = "idle" | "pending" | "streaming" | "done";

interface ColumnData {
  state: ColumnState;
  chunks: string[];
  error: boolean;
}

interface SynthesisData {
  state: "idle" | "streaming" | "done";
  chunks: string[];
  error: boolean;
}

const CADENCE = {
  engineer: { base: 75, jitter: 60 },
  investor: { base: 105, jitter: 60 },
  customer: { base: 95, jitter: 60 },
  synthesis: { base: 140, jitter: 60 },
} as const;

const idleColumn = (): ColumnData => ({ state: "idle", chunks: [], error: false });
const idleSynthesis = (): SynthesisData => ({ state: "idle", chunks: [], error: false });

function cadenceFor(id: PersonaId | "synthesis") {
  const c = CADENCE[id];
  return c.base + Math.random() * c.jitter;
}

export default function Page() {
  const [pitch, setPitch] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [columns, setColumns] = useState<Record<PersonaId, ColumnData>>({
    engineer: idleColumn(),
    investor: idleColumn(),
    customer: idleColumn(),
  });
  const [synthesis, setSynthesis] = useState<SynthesisData>(idleSynthesis());

  // Refs that consumers read — avoid stale closures.
  const personaBuffers = useRef<Record<PersonaId, string>>({
    engineer: "",
    investor: "",
    customer: "",
  });
  const personaStreamDone = useRef<Record<PersonaId, boolean>>({
    engineer: false,
    investor: false,
    customer: false,
  });
  const personaFinalText = useRef<Record<PersonaId, string>>({
    engineer: "",
    investor: "",
    customer: "",
  });
  const columnErrorRef = useRef<Record<PersonaId, boolean>>({
    engineer: false,
    investor: false,
    customer: false,
  });
  const synthesisBuffer = useRef("");
  const synthesisStreamDone = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const consumerTimers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const cancelledRef = useRef(false);

  const clearTimers = useCallback(() => {
    for (const t of consumerTimers.current) clearTimeout(t);
    consumerTimers.current.clear();
  }, []);

  const reset = useCallback(() => {
    cancelledRef.current = true;
    abortRef.current?.abort();
    clearTimers();
    personaBuffers.current = { engineer: "", investor: "", customer: "" };
    personaStreamDone.current = { engineer: false, investor: false, customer: false };
    personaFinalText.current = { engineer: "", investor: "", customer: "" };
    columnErrorRef.current = { engineer: false, investor: false, customer: false };
    synthesisBuffer.current = "";
    synthesisStreamDone.current = false;
    abortRef.current = null;
    setColumns({
      engineer: idleColumn(),
      investor: idleColumn(),
      customer: idleColumn(),
    });
    setSynthesis(idleSynthesis());
    setPhase("idle");
  }, [clearTimers]);

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      abortRef.current?.abort();
      clearTimers();
    };
  }, [clearTimers]);

  const startColumnConsumer = useCallback(
    (id: PersonaId, onAllChunksFlushed: () => void) => {
      const tick = () => {
        if (cancelledRef.current) return;
        const buf = personaBuffers.current[id];
        const done = personaStreamDone.current[id];
        const result = takeChunk(buf, { streamDone: done });
        if (result.chunk) {
          personaBuffers.current[id] = result.rest;
          setColumns((prev) => ({
            ...prev,
            [id]: { ...prev[id], chunks: [...prev[id].chunks, result.chunk as string] },
          }));
        }
        const stillWorking =
          !done || personaBuffers.current[id].trim().length > 0 || result.chunk !== null;
        if (stillWorking) {
          const t = setTimeout(tick, cadenceFor(id));
          consumerTimers.current.add(t);
        } else {
          setColumns((prev) => ({ ...prev, [id]: { ...prev[id], state: "done" } }));
          onAllChunksFlushed();
        }
      };
      const t = setTimeout(tick, cadenceFor(id));
      consumerTimers.current.add(t);
    },
    [],
  );

  const startSynthesisConsumer = useCallback((onComplete: () => void) => {
    const tick = () => {
      if (cancelledRef.current) return;
      const buf = synthesisBuffer.current;
      const done = synthesisStreamDone.current;
      const result = takeChunk(buf, { streamDone: done, minWords: 3, maxWords: 5 });
      if (result.chunk) {
        synthesisBuffer.current = result.rest;
        setSynthesis((prev) => ({ ...prev, chunks: [...prev.chunks, result.chunk as string] }));
      }
      const stillWorking =
        !done || synthesisBuffer.current.trim().length > 0 || result.chunk !== null;
      if (stillWorking) {
        const t = setTimeout(tick, cadenceFor("synthesis"));
        consumerTimers.current.add(t);
      } else {
        setSynthesis((prev) => ({ ...prev, state: "done" }));
        onComplete();
      }
    };
    const t = setTimeout(tick, cadenceFor("synthesis"));
    consumerTimers.current.add(t);
  }, []);

  const fetchPersonaStream = useCallback(
    async (id: PersonaId, signal: AbortSignal) => {
      try {
        const res = await fetch("/api/persona", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pitch, persona: id }),
          signal,
        });
        if (!res.ok || !res.body) {
          throw new Error(`persona ${id} ${res.status}`);
        }
        let firstByte = true;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (cancelledRef.current) return;
          const text = decoder.decode(value, { stream: true });
          if (text.length === 0) continue;
          if (firstByte) {
            firstByte = false;
            if (cancelledRef.current) return;
            setColumns((prev) => ({ ...prev, [id]: { ...prev[id], state: "streaming" } }));
          }
          personaBuffers.current[id] += text;
          personaFinalText.current[id] += text;
        }
        const tail = decoder.decode();
        if (tail) {
          personaBuffers.current[id] += tail;
          personaFinalText.current[id] += tail;
        }
        if (cancelledRef.current) return;
        // No bytes at all → treat as a soft error.
        if (personaFinalText.current[id].trim().length === 0) {
          columnErrorRef.current[id] = true;
          setColumns((prev) => ({ ...prev, [id]: { ...prev[id], error: true } }));
        }
        personaStreamDone.current[id] = true;
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") return;
        if (cancelledRef.current) return;
        personaStreamDone.current[id] = true;
        columnErrorRef.current[id] = true;
        setColumns((prev) => ({ ...prev, [id]: { ...prev[id], error: true, state: "done" } }));
      }
    },
    [pitch],
  );

  const fetchSynthesisStream = useCallback(
    async (signal: AbortSignal) => {
      const reactions: Partial<Record<PersonaId, string>> = {};
      for (const id of PERSONA_ORDER) {
        const txt = personaFinalText.current[id].trim();
        if (txt && !columnErrorRef.current[id]) reactions[id] = txt;
      }
      if (Object.keys(reactions).length === 0) {
        synthesisStreamDone.current = true;
        if (cancelledRef.current) return;
        setSynthesis((prev) => ({ ...prev, state: "done", error: true }));
        return;
      }
      try {
        const res = await fetch("/api/synthesize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pitch, reactions }),
          signal,
        });
        if (!res.ok || !res.body) throw new Error(`synthesize ${res.status}`);
        let firstByte = true;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (cancelledRef.current) return;
          const text = decoder.decode(value, { stream: true });
          if (text.length === 0) continue;
          if (firstByte) {
            firstByte = false;
            if (cancelledRef.current) return;
            setSynthesis((prev) => ({ ...prev, state: "streaming" }));
          }
          synthesisBuffer.current += text;
        }
        const tail = decoder.decode();
        if (tail) synthesisBuffer.current += tail;
        synthesisStreamDone.current = true;
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") return;
        if (cancelledRef.current) return;
        synthesisStreamDone.current = true;
        setSynthesis((prev) => ({ ...prev, error: true }));
      }
    },
    [pitch],
  );

  const convene = useCallback(async () => {
    if (!pitch.trim()) return;
    cancelledRef.current = false;
    clearTimers();
    personaBuffers.current = { engineer: "", investor: "", customer: "" };
    personaStreamDone.current = { engineer: false, investor: false, customer: false };
    personaFinalText.current = { engineer: "", investor: "", customer: "" };
    columnErrorRef.current = { engineer: false, investor: false, customer: false };
    synthesisBuffer.current = "";
    synthesisStreamDone.current = false;
    setSynthesis(idleSynthesis());
    setColumns({
      engineer: { ...idleColumn(), state: "pending" },
      investor: { ...idleColumn(), state: "pending" },
      customer: { ...idleColumn(), state: "pending" },
    });
    setPhase("running");

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    // 30s watchdog: any persona that hasn't produced bytes by then is force-errored
    // so the synthesis trigger isn't held hostage by a wedged stream.
    const watchdog = setTimeout(() => {
      if (cancelledRef.current) return;
      for (const id of PERSONA_ORDER) {
        if (!personaStreamDone.current[id]) {
          personaStreamDone.current[id] = true;
          columnErrorRef.current[id] = true;
          setColumns((prev) => ({
            ...prev,
            [id]: { ...prev[id], error: true, state: "done" },
          }));
        }
      }
    }, 30000);
    consumerTimers.current.add(watchdog);

    // Track when each column has finished revealing chunks.
    let finishedColumns = 0;
    const onColumnFlushed = () => {
      finishedColumns += 1;
      if (finishedColumns === PERSONA_ORDER.length && !cancelledRef.current) {
        // 900ms beat of silence, then synthesis.
        const t = setTimeout(() => {
          if (cancelledRef.current) return;
          setPhase("synthesizing");
          startSynthesisConsumer(() => setPhase("complete"));
          void fetchSynthesisStream(ctrl.signal);
        }, 900);
        consumerTimers.current.add(t);
      }
    };

    for (const id of PERSONA_ORDER) {
      startColumnConsumer(id, onColumnFlushed);
      void fetchPersonaStream(id, ctrl.signal);
    }
  }, [
    pitch,
    clearTimers,
    fetchPersonaStream,
    fetchSynthesisStream,
    startColumnConsumer,
    startSynthesisConsumer,
  ]);

  const canConvene = pitch.trim().length > 0 && phase === "idle";
  const submissionDimmed = phase !== "idle";
  const benchDimmed = phase === "synthesizing" || phase === "complete";

  return (
    <main className="mx-auto w-full max-w-panel px-6 pb-24 pt-14 md:px-16 md:pb-40 md:pt-24">
      <Masthead />

      <Hero />

      <SubmissionCard
        pitch={pitch}
        onChange={setPitch}
        onConvene={convene}
        canConvene={canConvene}
        phase={phase}
        dimmed={submissionDimmed}
      />

      <Bench columns={columns} dimmed={benchDimmed} phase={phase} />

      <Synthesis
        synthesis={synthesis}
        phase={phase}
        onReset={reset}
      />

      <Colophon />
    </main>
  );
}

function Masthead() {
  return (
    <header className="flex items-baseline justify-between border-b border-rule pb-6">
      <div className="font-serif text-[30px] leading-none tracking-[-0.01em]">The Panel</div>
      <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-fg-faint">
        Vol. I · Live Edition
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="mt-20 md:mt-24">
      <h1 className="font-serif text-[clamp(64px,8vw,112px)] leading-[1.05] tracking-[-0.025em]">
        Three reviewers.
        <br />
        One pitch.
      </h1>
      <p className="mt-12 max-w-[42ch] font-serif text-[22px] leading-[1.5] text-fg-dim md:mt-16">
        An engineer, an investor, and a customer read your pitch in parallel. A fourth
        editor reads them and writes the verdict.
      </p>
    </section>
  );
}

interface SubmissionProps {
  pitch: string;
  onChange: (v: string) => void;
  onConvene: () => void;
  canConvene: boolean;
  phase: Phase;
  dimmed: boolean;
}

function SubmissionCard(props: SubmissionProps) {
  const { pitch, onChange, onConvene, canConvene, phase, dimmed } = props;
  return (
    <section
      className="mt-[72px] transition-[opacity,filter] duration-[600ms] ease"
      style={{
        opacity: dimmed ? 0.28 : 1,
        filter: dimmed ? "blur(1px)" : "blur(0)",
      }}
    >
      <div className="flex items-center gap-4">
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-fg-faint">
          Submission
        </span>
        <span className="h-px flex-1 bg-rule" />
      </div>
      <div className="border-y border-rule py-7 mt-5">
        <textarea
          value={pitch}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Paste your pitch."
          rows={4}
          aria-label="Pitch"
          className="font-serif text-[22px] leading-[1.5] tracking-[-0.005em] md:text-[26px]"
          disabled={phase !== "idle"}
        />
      </div>
      <div className="mt-7 flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-fg-faint">
          {pitch.trim().length === 0
            ? "—"
            : `${pitch.trim().split(/\s+/).filter(Boolean).length} words`}
        </span>
        <button
          onClick={onConvene}
          disabled={!canConvene}
          className="border border-rule px-5 py-3 font-sans text-[13px] font-medium uppercase tracking-[0.06em] transition-colors hover:border-fg disabled:border-rule-soft disabled:text-fg-faint disabled:hover:border-rule-soft"
        >
          Convene the panel
        </button>
      </div>
    </section>
  );
}

interface BenchProps {
  columns: Record<PersonaId, ColumnData>;
  dimmed: boolean;
  phase: Phase;
}

function Bench({ columns, dimmed, phase }: BenchProps) {
  return (
    <section
      className="mt-[120px] transition-[opacity,filter] duration-[700ms] ease"
      style={{
        opacity: dimmed ? 0.32 : 1,
        filter: dimmed ? "saturate(0.6)" : "saturate(1)",
      }}
    >
      <div className="flex items-center gap-4">
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-fg-faint">
          The Bench
        </span>
        <span className="h-px flex-1 bg-rule" />
        <span className="font-serif italic text-[18px] text-fg-dim md:text-[22px]">
          {benchStatus(columns, phase)}
        </span>
      </div>
      <div className="mt-10 grid grid-cols-1 gap-y-12 md:grid-cols-3 md:gap-y-0">
        {PERSONA_ORDER.map((id, idx) => (
          <Column
            key={id}
            id={id}
            data={columns[id]}
            isFirst={idx === 0}
            isLast={idx === PERSONA_ORDER.length - 1}
          />
        ))}
      </div>
    </section>
  );
}

function benchStatus(columns: Record<PersonaId, ColumnData>, phase: Phase) {
  if (phase === "idle") return "";
  if (phase === "running") {
    const anyStreaming = PERSONA_ORDER.some((id) => columns[id].state === "streaming");
    const anyPending = PERSONA_ORDER.some((id) => columns[id].state === "pending");
    if (anyPending && !anyStreaming) return "The panel is reading…";
    return "The panel is reacting…";
  }
  if (phase === "synthesizing") return "The editor is writing the verdict…";
  return "The panel has spoken.";
}

interface ColumnProps {
  id: PersonaId;
  data: ColumnData;
  isFirst: boolean;
  isLast: boolean;
}

function Column({ id, data, isLast }: ColumnProps) {
  const persona = PERSONAS[id];
  const accent = persona.accentVar;
  const showAccent = data.state === "streaming" || data.state === "done";

  return (
    <article
      className={`relative px-0 md:px-8 border-t md:border-l md:border-t-0 border-rule pt-12 md:pt-0 md:min-h-[320px] ${
        isLast ? "md:border-r" : ""
      }`}
    >
      {/* Left accent rule (desktop only) */}
      <div
        aria-hidden
        className="absolute left-0 top-0 hidden w-px md:block"
        style={{
          background: accent,
          opacity: showAccent ? 1 : 0,
          height: showAccent ? "100%" : "0%",
          transition: "height 600ms ease, opacity 200ms ease",
        }}
      />
      <header className="flex items-start gap-4">
        <LetterBadge letter={persona.letter} accent={accent} active={showAccent} />
        <div className="flex-1">
          <div className="font-sans text-[11px] font-medium uppercase tracking-[0.18em] text-fg-faint">
            {persona.role}
          </div>
          <div className="mt-2 font-serif italic text-[22px] leading-[1.1]">
            {persona.name}
          </div>
          <div className="mt-1 font-sans text-[12px] tracking-[0.04em] text-fg-dim">
            {persona.tagline}
          </div>
        </div>
        <ColumnStatus state={data.state} accent={accent} />
      </header>

      <div className="mt-8 font-sans text-[16px] leading-[1.6]">
        {data.state === "idle" && (
          <span className="font-serif italic text-fg-faint text-[20px]">Idle.</span>
        )}
        {data.state === "pending" && (
          <span className="font-serif italic text-fg-dim text-[20px]">Reading…</span>
        )}
        {(data.state === "streaming" || data.state === "done") && data.error && (
          <span className="text-fg-faint">— couldn&rsquo;t reach this reviewer.</span>
        )}
        {(data.state === "streaming" || data.state === "done") && !data.error && (
          <p className="whitespace-pre-wrap">
            {data.chunks.map((chunk, i) => (
              <span
                key={i}
                className="inline animate-chunkIn opacity-0"
                style={{ animationFillMode: "forwards" }}
              >
                {chunk}
              </span>
            ))}
            {data.state === "streaming" && (
              <span
                aria-hidden
                className="ml-[1px] inline-block h-[1em] w-[2px] translate-y-[2px] animate-caretBlink"
                style={{ background: accent }}
              />
            )}
          </p>
        )}
      </div>
    </article>
  );
}

function LetterBadge({
  letter,
  accent,
  active,
}: {
  letter: string;
  accent: string;
  active: boolean;
}) {
  return (
    <span
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-serif italic text-[16px] transition-colors duration-300"
      style={{
        border: `1px solid ${active ? accent : "rgba(245,243,238,0.18)"}`,
        color: active ? accent : "var(--fg-faint)",
      }}
    >
      {letter}
    </span>
  );
}

function ColumnStatus({ state, accent }: { state: ColumnState; accent: string }) {
  if (state === "idle") return null;
  if (state === "pending") {
    return (
      <span
        className="mt-2 inline-block h-[6px] w-[6px] rounded-full"
        style={{ background: "var(--fg-faint)" }}
        aria-label="pending"
      />
    );
  }
  if (state === "streaming") {
    return (
      <span
        className="mt-2 inline-block h-[6px] w-[6px] animate-pulseSoft rounded-full"
        style={{ background: accent }}
        aria-label="streaming"
      />
    );
  }
  return (
    <span
      className="mt-2 inline-flex h-[12px] w-[12px] items-center justify-center rounded-full"
      style={{ border: `1px solid ${accent}` }}
      aria-label="done"
    >
      <svg viewBox="0 0 12 12" className="h-[8px] w-[8px]" fill="none">
        <path
          d="M2.5 6.5L5 9L9.5 3.5"
          stroke={accent}
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

interface SynthesisProps {
  synthesis: SynthesisData;
  phase: Phase;
  onReset: () => void;
}

function Synthesis({ synthesis, phase, onReset }: SynthesisProps) {
  if (phase === "idle" || phase === "running") return null;
  return (
    <section className="mt-[140px] opacity-0 animate-sectionRise" style={{ animationFillMode: "forwards" }}>
      <div className="mx-auto max-w-[70ch]">
        <div className="flex items-baseline gap-4">
          <span className="font-serif italic text-[28px] tracking-[-0.01em]">The Verdict</span>
          <span
            aria-hidden
            className="h-px flex-1 origin-left scale-x-0 animate-ruleDraw bg-rule"
            style={{ animationFillMode: "forwards" }}
          />
        </div>
        <div className="mt-8 font-serif text-[22px] leading-[1.5] tracking-[-0.005em] md:text-[26px]">
          {synthesis.state === "idle" && (
            <span className="font-serif italic text-fg-dim">The editor is writing…</span>
          )}
          {synthesis.error && synthesis.chunks.length === 0 && (
            <span className="text-fg-faint">— the editor stepped out. Try another version.</span>
          )}
          {synthesis.chunks.length > 0 && (
            <p className="whitespace-pre-wrap">
              <DropCapText chunks={synthesis.chunks} />
              {synthesis.state === "streaming" && (
                <span
                  aria-hidden
                  className="ml-[1px] inline-block h-[1em] w-[2px] translate-y-[2px] animate-caretBlink bg-fg"
                />
              )}
            </p>
          )}
        </div>
        {phase === "complete" && (
          <div className="mt-12 flex items-center gap-6 opacity-0 animate-chunkInSlow" style={{ animationDelay: "1200ms", animationFillMode: "forwards" }}>
            <button
              onClick={onReset}
              className="border border-rule px-5 py-3 font-sans text-[13px] font-medium uppercase tracking-[0.06em] hover:border-fg"
            >
              Try another version
            </button>
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-fg-faint">
              The panel has spoken.
            </span>
          </div>
        )}
      </div>
    </section>
  );
}

function DropCapText({ chunks }: { chunks: string[] }) {
  if (chunks.length === 0) return null;
  // Find the first letter (skip leading whitespace, punctuation, quotes) to use as the drop cap.
  const first = chunks[0];
  const capMatch = first.match(/[A-Za-z]/);
  if (!capMatch || capMatch.index === undefined) {
    return (
      <>
        {chunks.map((chunk, i) => (
          <span key={i} className="inline animate-chunkInSlow opacity-0" style={{ animationFillMode: "forwards" }}>
            {chunk}
          </span>
        ))}
      </>
    );
  }
  const cap = capMatch[0];
  const capIdx = capMatch.index;
  const firstWithoutCap = first.slice(0, capIdx) + first.slice(capIdx + 1);
  const restChunks = chunks.slice(1);
  return (
    <>
      <span
        className="float-left mr-3 mt-1 font-serif text-[96px] leading-[0.85] animate-chunkInSlow opacity-0"
        style={{ animationFillMode: "forwards" }}
      >
        {cap}
      </span>
      <span className="inline animate-chunkInSlow opacity-0" style={{ animationFillMode: "forwards" }}>
        {firstWithoutCap}
      </span>
      {restChunks.map((chunk, i) => (
        <span
          key={i + 1}
          className="inline animate-chunkInSlow opacity-0"
          style={{ animationFillMode: "forwards" }}
        >
          {chunk}
        </span>
      ))}
    </>
  );
}

function Colophon() {
  return (
    <footer className="mt-40 border-t border-rule pt-8 font-mono text-[11px] uppercase tracking-[0.18em] text-fg-faint">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <span>The Panel · Vol. I</span>
        <span>Built for stage. Read from the back of the room.</span>
      </div>
    </footer>
  );
}
