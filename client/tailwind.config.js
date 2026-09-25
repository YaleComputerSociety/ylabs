/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html", 
    "./src/**/*.{js,jsx,ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "var(--yr-blue)",
          navy: "var(--yr-navy)",
          soft: "var(--yr-blue-soft)",
        },
        gold: {
          DEFAULT: "var(--yr-gold)",
          soft: "var(--yr-gold-soft)",
        },
        ink: "var(--yr-ink)",
        "ink-soft": "var(--yr-ink-soft)",
        muted: "var(--yr-muted)",
        canvas: "var(--yr-page)",
        parchment: "var(--yr-parchment)",
        panel: {
          DEFAULT: "var(--yr-panel)",
          muted: "var(--yr-panel-muted)",
        },
        line: {
          DEFAULT: "var(--yr-line)",
          strong: "var(--yr-line-strong)",
          warm: "var(--yr-border-warm)",
          brand: "var(--yr-blue-border)",
        },
        success: {
          DEFAULT: "var(--yr-green)",
          soft: "var(--yr-green-soft)",
        },
      },
      fontFamily: {
        sans: ["Inter", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
        serif: ["Source Serif 4", "Newsreader", "Georgia", "Times New Roman", "serif"],
      },
      boxShadow: {
        "yr-raised": "var(--yr-shadow-raised)",
        "yr-lifted": "var(--yr-shadow-lifted)",
        "yr-overlay": "var(--yr-shadow-overlay)",
        "yr-modal": "var(--yr-shadow-modal)",
      },
    },
  },
  plugins: [],
}

