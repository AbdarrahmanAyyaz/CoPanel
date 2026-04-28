import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0a0a0a",
        "bg-tint": "#0f0f0f",
        fg: "#f5f3ee",
        "fg-dim": "rgba(245,243,238,0.62)",
        "fg-faint": "rgba(245,243,238,0.34)",
        rule: "rgba(245,243,238,0.10)",
        "rule-soft": "rgba(245,243,238,0.05)",
        engineer: "#34d399",
        vc: "#a78bfa",
        customer: "#fbbf24",
      },
      fontFamily: {
        serif: ["var(--font-serif)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      maxWidth: { panel: "1280px" },
      letterSpacing: {
        kicker: "0.18em",
        label: "0.16em",
        button: "0.06em",
      },
      keyframes: {
        chunkIn: {
          "0%": { opacity: "0", filter: "blur(2px)", transform: "translateY(2px)" },
          "100%": { opacity: "1", filter: "blur(0)", transform: "translateY(0)" },
        },
        chunkInSlow: {
          "0%": { opacity: "0", filter: "blur(2px)", transform: "translateY(2px)" },
          "100%": { opacity: "1", filter: "blur(0)", transform: "translateY(0)" },
        },
        pulseSoft: {
          "0%,100%": { opacity: "0.25" },
          "50%": { opacity: "1" },
        },
        caretBlink: {
          "0%,49%": { opacity: "1" },
          "50%,100%": { opacity: "0" },
        },
        ruleDraw: {
          "0%": { transform: "scaleX(0)" },
          "100%": { transform: "scaleX(1)" },
        },
        sectionRise: {
          "0%": { opacity: "0", transform: "translateY(24px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        accentGrow: {
          "0%": { height: "0%" },
          "100%": { height: "100%" },
        },
      },
      animation: {
        chunkIn: "chunkIn 520ms ease forwards",
        chunkInSlow: "chunkInSlow 700ms ease forwards",
        pulseSoft: "pulseSoft 1.4s ease-in-out infinite",
        caretBlink: "caretBlink 0.9s steps(2) infinite",
        ruleDraw: "ruleDraw 900ms cubic-bezier(0.2,0.6,0.2,1) 300ms forwards",
        sectionRise: "sectionRise 1100ms ease 200ms forwards",
        accentGrow: "accentGrow 600ms ease forwards",
      },
    },
  },
  plugins: [],
};

export default config;
