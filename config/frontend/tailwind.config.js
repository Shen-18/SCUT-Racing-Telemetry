export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: { extend: { colors: {
    app: "var(--bg-app)", panel: "var(--bg-panel)", text: "var(--text-primary)", muted: "var(--text-muted)", accent: "var(--accent)",
  } } },
  plugins: [],
};
