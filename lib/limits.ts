export const LIMITS = {
  // Hard input caps (server-enforced; client UI mirrors these).
  descriptionMaxChars: 2000,
  reactionMaxChars: 4000,
  repoUrlMaxChars: 200,

  // Per-IP rate limits. In-memory, per-Vercel-instance — best-effort, not
  // bulletproof. Tuned so a normal user can convene the panel ~5 times/minute.
  // Each panel run hits /api/persona 3 times + /api/synthesize once.
  personaPerMinute: 15,
  personaPerHour: 90,
  personaPerDay: 300,
  synthesizePerMinute: 10,
  synthesizePerHour: 60,
  synthesizePerDay: 200,
  fromRepoPerHour: 10,
  fromRepoPerDay: 30,
} as const;

export const PROVIDER_DEFAULTS = {
  geminiModel: process.env.GEMINI_MODEL_ID || "gemini-2.5-flash",
  anthropicModel: process.env.ANTHROPIC_MODEL_ID || "claude-sonnet-4-5",
} as const;
