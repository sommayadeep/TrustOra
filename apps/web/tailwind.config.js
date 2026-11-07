/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Ground and surfaces
        paper: { DEFAULT: "#f5f5f0", deep: "#ecece5" },
        surface: { DEFAULT: "#ffffff", 2: "#eaece8", 3: "#dde1dd" },
        // Ink
        ink: { DEFAULT: "#17243a", 2: "#4a5566", 3: "#78818c", inverse: "#f7f8f5" },
        // Accents
        royal: { DEFAULT: "#4969d6", deep: "#3450b4", wash: "#eef1fc" },
        sage: { DEFAULT: "#a8b9aa", deep: "#6e8572", wash: "#eef2ee" },
        // Semantic
        ok: { DEFAULT: "#3f7d58", wash: "#e9f1ec" },
        warn: { DEFAULT: "#9a6b1f", wash: "#f6efe1" },
        risk: { DEFAULT: "#a4414b", wash: "#f8ebec" },
        idle: { DEFAULT: "#78818c", wash: "#ecedea" },
        rule: { DEFAULT: "#e2e3dd", strong: "#cfd2ca" },
        // Ecosystem marks, kept muted to match the palette
        arc: { blue: "#4969d6", light: "#3450b4" },
        hedera: { purple: "#6b5bb5" },
        zerog: { emerald: "#3f7d58", cyan: "#4f8c7a" },
      },
      fontFamily: {
        display: ["var(--font-display)", "ui-sans-serif", "system-ui", "sans-serif"],
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      // Scale chosen so existing rounded-lg buttons and rounded-xl cards stay correct.
      borderRadius: { sm: "8px", md: "12px", lg: "16px", xl: "20px", "2xl": "26px", "3xl": "30px" },
      boxShadow: {
        hair: "0 1px 2px rgba(23,36,58,.04)",
        soft: "0 2px 8px rgba(23,36,58,.05)",
        float: "0 12px 32px -12px rgba(23,36,58,.18), 0 2px 8px rgba(23,36,58,.04)",
        lift: "0 24px 56px -20px rgba(23,36,58,.22), 0 4px 12px rgba(23,36,58,.05)",
      },
      maxWidth: { content: "1180px", prose: "68ch" },
      transitionTimingFunction: { ease: "cubic-bezier(.22,.61,.36,1)" },
    },
  },
  plugins: [],
};
