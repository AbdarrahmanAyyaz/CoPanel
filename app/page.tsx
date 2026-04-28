"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  PERSONAS,
  PERSONA_ORDER,
  parseScore,
  type PersonaId,
} from "@/lib/personas";
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

const PREFILL = `A patient intake agent for a telehealth platform that takes symptom descriptions and routes patients to appropriate specialists. The agent stores conversation history for follow-up visits and flags urgent cases for immediate review.`;

const CADENCE = {
  privacy: { base: 75, jitter: 60 },
  compliance: { base: 105, jitter: 60 },
  security: { base: 95, jitter: 60 },
  synthesis: { base: 140, jitter: 60 },
} as const;

const idleColumn = (): ColumnData => ({ state: "idle", chunks: [], error: false });
const idleSynthesis = (): SynthesisData => ({ state: "idle", chunks: [], error: false });

function cadenceFor(id: PersonaId | "synthesis") {
  const c = CADENCE[id];
  return c.base + Math.random() * c.jitter;
}

function scoreColor(score: number | null): string {
  if (score === null) return "var(--fg-faint)";
  if (score >= 90) return "var(--privacy)";
  if (score >= 70) return "#facc15";
  if (score >= 50) return "#fb923c";
  return "#f87171";
}

function scoreToGrade(score: number | null): string {
  if (score === null) return "—";
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

function aggregateGrade(scores: Record<PersonaId, number | null>): {
  grade: string;
  color: string;
} {
  const numeric = Object.values(scores).filter(
    (s): s is number => typeof s === "number",
  );
  if (numeric.length === 0) return { grade: "—", color: "var(--fg-faint)" };
  const min = Math.min(...numeric);
  return { grade: scoreToGrade(min), color: scoreColor(min) };
}

export default function Page() {
  const [description, setDescription] = useState(PREFILL);
  const [phase, setPhase] = useState<Phase>("idle");
  const [columns, setColumns] = useState<Record<PersonaId, ColumnData>>({
    privacy: idleColumn(),
    compliance: idleColumn(),
    security: idleColumn(),
  });
  const [scores, setScores] = useState<Record<PersonaId, number | null>>({
    privacy: null,
    compliance: null,
    security: null,
  });
  const [synthesis, setSynthesis] = useState<SynthesisData>(idleSynthesis());

  // Refs (audit-fixed cancellation pattern)
  const personaBuffers = useRef<Record<PersonaId, string>>({
    privacy: "",
    compliance: "",
    security: "",
  });
  const personaStreamDone = useRef<Record<PersonaId, boolean>>({
    privacy: false,
    compliance: false,
    security: false,
  });
  const personaFinalText = useRef<Record<PersonaId, string>>({
    privacy: "",
    compliance: "",
    security: "",
  });
  const columnErrorRef = useRef<Record<PersonaId, boolean>>({
    privacy: false,
    compliance: false,
    security: false,
  });
  const scoreParsedRef = useRef<Record<PersonaId, boolean>>({
    privacy: false,
    compliance: false,
    security: false,
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
    personaBuffers.current = { privacy: "", compliance: "", security: "" };
    personaStreamDone.current = { privacy: false, compliance: false, security: false };
    personaFinalText.current = { privacy: "", compliance: "", security: "" };
    columnErrorRef.current = { privacy: false, compliance: false, security: false };
    scoreParsedRef.current = { privacy: false, compliance: false, security: false };
    synthesisBuffer.current = "";
    synthesisStreamDone.current = false;
    abortRef.current = null;
    setColumns({
      privacy: idleColumn(),
      compliance: idleColumn(),
      security: idleColumn(),
    });
    setScores({ privacy: null, compliance: null, security: null });
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

  const tryParseScoreFromAccumulated = useCallback((id: PersonaId) => {
    if (scoreParsedRef.current[id]) return;
    const fullText = personaFinalText.current[id];
    // Wait for either a newline (to be sure SCORE: line ended) or 80+ chars (to give up).
    if (fullText.indexOf("\n") < 0 && fullText.length < 80) return;
    const { score, body } = parseScore(fullText);
    scoreParsedRef.current[id] = true;
    if (!cancelledRef.current) {
      setScores((prev) => ({ ...prev, [id]: score }));
    }
    personaBuffers.current[id] = body;
  }, []);

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
          body: JSON.stringify({ description, persona: id }),
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
          personaFinalText.current[id] += text;
          if (!scoreParsedRef.current[id]) {
            tryParseScoreFromAccumulated(id);
          } else {
            personaBuffers.current[id] += text;
          }
        }
        const tail = decoder.decode();
        if (tail) {
          personaFinalText.current[id] += tail;
        }
        if (cancelledRef.current) return;
        // Force a final score-parse attempt at end-of-stream.
        if (!scoreParsedRef.current[id]) {
          const { score, body } = parseScore(personaFinalText.current[id]);
          scoreParsedRef.current[id] = true;
          setScores((prev) => ({ ...prev, [id]: score }));
          personaBuffers.current[id] = body;
        }
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
    [description, tryParseScoreFromAccumulated],
  );

  const fetchSynthesisStream = useCallback(
    async (signal: AbortSignal) => {
      const reactions: Partial<Record<PersonaId, string>> = {};
      const finalScores: Partial<Record<PersonaId, number>> = {};
      for (const id of PERSONA_ORDER) {
        const txt = personaFinalText.current[id].trim();
        if (txt && !columnErrorRef.current[id]) {
          // Strip the SCORE: line before sending to synthesis.
          const { body } = parseScore(txt);
          reactions[id] = body || txt;
        }
        const s = scores[id];
        if (typeof s === "number") finalScores[id] = s;
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
          body: JSON.stringify({ description, reactions, scores: finalScores }),
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
    [description, scores],
  );

  const convene = useCallback(async () => {
    if (!description.trim()) return;
    cancelledRef.current = false;
    clearTimers();
    personaBuffers.current = { privacy: "", compliance: "", security: "" };
    personaStreamDone.current = { privacy: false, compliance: false, security: false };
    personaFinalText.current = { privacy: "", compliance: "", security: "" };
    columnErrorRef.current = { privacy: false, compliance: false, security: false };
    scoreParsedRef.current = { privacy: false, compliance: false, security: false };
    synthesisBuffer.current = "";
    synthesisStreamDone.current = false;
    setSynthesis(idleSynthesis());
    setScores({ privacy: null, compliance: null, security: null });
    setColumns({
      privacy: { ...idleColumn(), state: "pending" },
      compliance: { ...idleColumn(), state: "pending" },
      security: { ...idleColumn(), state: "pending" },
    });
    setPhase("running");

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    // 30s watchdog: any persona that hasn't produced bytes by then is force-errored.
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

    let finishedColumns = 0;
    const onColumnFlushed = () => {
      finishedColumns += 1;
      if (finishedColumns === PERSONA_ORDER.length && !cancelledRef.current) {
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
    description,
    clearTimers,
    fetchPersonaStream,
    fetchSynthesisStream,
    startColumnConsumer,
    startSynthesisConsumer,
  ]);

  const canConvene = description.trim().length > 0 && phase === "idle";
  const submissionDimmed = phase !== "idle";
  const benchDimmed = phase === "synthesizing" || phase === "complete";

  return (
    <main className="mx-auto w-full max-w-panel px-6 pb-24 pt-14 md:px-16 md:pb-40 md:pt-24">
      <Masthead />
      <Hero />
      <SubmissionCard
        description={description}
        onChange={setDescription}
        onConvene={convene}
        canConvene={canConvene}
        phase={phase}
        dimmed={submissionDimmed}
      />
      <Bench
        columns={columns}
        scores={scores}
        dimmed={benchDimmed}
        phase={phase}
      />
      <Synthesis
        synthesis={synthesis}
        scores={scores}
        phase={phase}
        onReset={reset}
      />
      <Disclaimer />
    </main>
  );
}

function Masthead() {
  return (
    <header className="flex items-baseline justify-between border-b border-rule pb-6">
      <div className="font-serif text-[30px] leading-none tracking-[-0.01em]">
        The Panel
      </div>
      <div className="hidden font-mono text-[11px] uppercase tracking-[0.18em] text-fg-faint md:block">
        Pre-build readiness · not legal or security advice
      </div>
      <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-fg-faint md:hidden">
        Pre-build readiness
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
        One agent.
      </h1>
      <p className="mt-12 max-w-[46ch] font-serif text-[22px] leading-[1.5] text-fg-dim md:mt-16">
        A privacy officer, a compliance auditor, and a security engineer review
        your AI agent design before you build it. Each scores it 0–100. The
        editor synthesizes a Pre-Build Readiness Brief.
      </p>
    </section>
  );
}

interface SubmissionProps {
  description: string;
  onChange: (v: string) => void;
  onConvene: () => void;
  canConvene: boolean;
  phase: Phase;
  dimmed: boolean;
}

function SubmissionCard(props: SubmissionProps) {
  const { description, onChange, onConvene, canConvene, phase, dimmed } = props;
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
          Agent Description
        </span>
        <span className="h-px flex-1 bg-rule" />
      </div>
      <div className="mt-5 border-y border-rule py-7">
        <textarea
          value={description}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Describe the AI agent you want to build."
          rows={5}
          aria-label="Agent description"
          className="font-serif text-[22px] leading-[1.5] tracking-[-0.005em] md:text-[26px]"
          disabled={phase !== "idle"}
        />
      </div>
      <div className="mt-7 flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-fg-faint">
          {description.trim().length === 0
            ? "—"
            : `${description.trim().split(/\s+/).filter(Boolean).length} words`}
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
  scores: Record<PersonaId, number | null>;
  dimmed: boolean;
  phase: Phase;
}

function Bench({ columns, scores, dimmed, phase }: BenchProps) {
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
            score={scores[id]}
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
    return "The panel is reviewing…";
  }
  if (phase === "synthesizing") return "The editor is preparing your brief…";
  return "The panel has spoken.";
}

interface ColumnProps {
  id: PersonaId;
  data: ColumnData;
  score: number | null;
  isLast: boolean;
}

function Column({ id, data, score, isLast }: ColumnProps) {
  const persona = PERSONAS[id];
  const accent = persona.accentVar;
  const showAccent = data.state === "streaming" || data.state === "done";
  const showScore = data.state === "streaming" || data.state === "done";

  return (
    <article
      className={`relative px-0 md:px-8 border-t md:border-l md:border-t-0 border-rule pt-12 md:pt-0 md:min-h-[320px] ${
        isLast ? "md:border-r" : ""
      }`}
    >
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

      <ScoreBadge show={showScore} score={score} error={data.error} />

      <div className="mt-6 font-sans text-[16px] leading-[1.6]">
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

function ScoreBadge({
  show,
  score,
  error,
}: {
  show: boolean;
  score: number | null;
  error: boolean;
}) {
  if (!show) {
    return <div className="mt-8 h-[88px]" aria-hidden />;
  }
  if (error) {
    return (
      <div className="mt-8 flex items-baseline gap-2">
        <span
          className="font-serif text-[72px] leading-[0.85] tabular-nums"
          style={{ color: "var(--fg-faint)" }}
        >
          —
        </span>
      </div>
    );
  }
  return (
    <div className="mt-8 flex items-baseline gap-2">
      <span
        className="font-serif text-[80px] leading-[0.85] tabular-nums transition-colors duration-300 md:text-[88px]"
        style={{ color: scoreColor(score) }}
      >
        {score === null ? "?" : score}
      </span>
      <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-fg-faint">
        / 100
      </span>
    </div>
  );
}

interface SynthesisProps {
  synthesis: SynthesisData;
  scores: Record<PersonaId, number | null>;
  phase: Phase;
  onReset: () => void;
}

function Synthesis({ synthesis, scores, phase, onReset }: SynthesisProps) {
  if (phase === "idle" || phase === "running") return null;
  const { grade, color: gradeColor } = aggregateGrade(scores);
  const synthesisText = synthesis.chunks.join("");
  return (
    <section
      className="mt-[140px] opacity-0 animate-sectionRise"
      style={{ animationFillMode: "forwards" }}
    >
      <div className="flex items-baseline gap-4">
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-fg-faint">
          Pre-Build Readiness Brief
        </span>
        <span
          aria-hidden
          className="h-px flex-1 origin-left scale-x-0 animate-ruleDraw bg-rule"
          style={{ animationFillMode: "forwards" }}
        />
      </div>
      <div className="mx-auto mt-12 max-w-[70ch]">
        <div className="flex items-baseline gap-6 md:gap-12">
          <span
            className="font-serif leading-[0.85] tracking-[-0.02em]"
            style={{
              color: gradeColor,
              fontSize: "clamp(112px, 14vw, 168px)",
            }}
          >
            {grade}
          </span>
          <div className="flex-1">
            <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.18em] text-fg-faint">
              Overall Readiness
            </div>
            <p className="font-serif italic text-[20px] leading-[1.3] text-fg-dim md:text-[22px]">
              Based on the lowest reviewer score.
            </p>
          </div>
        </div>

        <div className="mt-16">
          {synthesis.state === "idle" && (
            <p className="font-serif italic text-[20px] text-fg-dim">
              The editor is preparing your brief…
            </p>
          )}
          {synthesis.error && synthesis.chunks.length === 0 && (
            <p className="text-fg-faint">
              — the editor stepped out. Try another agent.
            </p>
          )}
          {synthesis.chunks.length > 0 && <MarkdownBrief text={synthesisText} />}
          {synthesis.state === "streaming" && (
            <span
              aria-hidden
              className="ml-1 inline-block h-[1em] w-[2px] translate-y-[2px] animate-caretBlink bg-fg"
            />
          )}
        </div>

        {phase === "complete" && (
          <div
            className="mt-16 flex items-center gap-6 opacity-0 animate-chunkInSlow"
            style={{ animationDelay: "1200ms", animationFillMode: "forwards" }}
          >
            <button
              onClick={onReset}
              className="border border-rule px-5 py-3 font-sans text-[13px] font-medium uppercase tracking-[0.06em] hover:border-fg"
            >
              Try another agent
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

type Block =
  | { kind: "h2"; content: string }
  | { kind: "p"; content: string }
  | { kind: "ul"; items: string[] };

function parseMarkdown(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.split("\n");
  let currentP: string[] | null = null;
  let currentList: string[] | null = null;
  let skippedFirstReadinessHeading = false;

  const flushP = () => {
    if (currentP && currentP.length > 0) {
      blocks.push({ kind: "p", content: currentP.join(" ") });
    }
    currentP = null;
  };
  const flushList = () => {
    if (currentList && currentList.length > 0) {
      blocks.push({ kind: "ul", items: [...currentList] });
    }
    currentList = null;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("## ")) {
      flushP();
      flushList();
      const heading = trimmed.slice(3).trim();
      if (
        !skippedFirstReadinessHeading &&
        /^overall readiness/i.test(heading)
      ) {
        skippedFirstReadinessHeading = true;
        continue;
      }
      blocks.push({ kind: "h2", content: heading });
    } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      flushP();
      if (!currentList) currentList = [];
      currentList.push(trimmed.slice(2));
    } else if (trimmed === "") {
      flushP();
      flushList();
    } else {
      flushList();
      if (!currentP) currentP = [];
      currentP.push(trimmed);
    }
  }
  flushP();
  flushList();
  return blocks;
}

function MarkdownBrief({ text }: { text: string }) {
  const blocks = parseMarkdown(text);
  return (
    <div>
      {blocks.map((b, i) => {
        if (b.kind === "h2") {
          return (
            <h2
              key={i}
              className="mb-4 mt-12 font-mono text-[11px] uppercase tracking-[0.18em] text-fg-dim first:mt-0"
            >
              {b.content}
            </h2>
          );
        }
        if (b.kind === "p") {
          return (
            <p
              key={i}
              className="font-serif text-[20px] leading-[1.5] tracking-[-0.005em] text-fg md:text-[22px]"
            >
              {renderInline(b.content)}
            </p>
          );
        }
        return (
          <ul key={i} className="space-y-3">
            {b.items.map((item, j) => (
              <li
                key={j}
                className="flex gap-4 font-serif text-[18px] leading-[1.5] tracking-[-0.005em] text-fg md:text-[20px]"
              >
                <span className="select-none text-fg-faint">—</span>
                <span>{renderInline(item)}</span>
              </li>
            ))}
          </ul>
        );
      })}
    </div>
  );
}

// Minimal inline markdown: **bold** and *italic*. Plain text otherwise.
function renderInline(text: string): React.ReactNode {
  const out: React.ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      out.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith("**")) {
      out.push(
        <strong key={key++} className="font-medium">
          {token.slice(2, -2)}
        </strong>,
      );
    } else {
      out.push(
        <em key={key++} className="italic">
          {token.slice(1, -1)}
        </em>,
      );
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) out.push(text.slice(lastIndex));
  return out.length === 0 ? text : out;
}

function Disclaimer() {
  return (
    <footer className="mt-32 border-t border-rule pt-8">
      <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-fg-faint">
        <span className="text-fg-dim">Not legal or security advice.</span>{" "}
        Pre-build readiness brief only. The Panel pattern-matches considerations
        across privacy, compliance, and security; it does not replace counsel,
        a real audit, or a real threat model.
      </div>
    </footer>
  );
}
