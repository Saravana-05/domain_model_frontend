import type { CSSProperties } from "react";

/**
 * Shared look for the RBAC admin screens. Values mirror the dark-purple
 * palette already used by ProjectsScreen / ModulesScreen / CreateEntityModal
 * so these pages sit naturally inside the rest of the app.
 */
export const c = {
  surface:     "#2a2438",
  card:        "#332c42",
  cardRaised:  "#3a3350",
  inputBg:     "#241f31",
  border:      "rgba(255,255,255,0.08)",
  borderInput: "rgba(255,255,255,0.15)",

  text:        "#f5f3fa",
  textSub:     "#b3abc7",
  textMuted:   "#8a8398",

  accent:      "#8b5cf6",
  accentSoft:  "rgba(167,139,250,0.12)",
  accentText:  "#a78bfa",
  accentBorder:"rgba(139,92,246,0.35)",

  green:  { bg: "#163828", text: "#4ade80", border: "#205a3c" },
  amber:  { bg: "#3d2f14", text: "#fbbf24", border: "#5c481c" },
  red:    { bg: "#40191f", text: "#f87171", border: "#602530" },
  blue:   { bg: "#1a2a4a", text: "#93c5fd", border: "#28396b" },
  neutral:{ bg: "rgba(255,255,255,0.06)", text: "#8a8398", border: "rgba(255,255,255,0.10)" },
};

const gradient = "linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)";

/** Style fragments reused across every RBAC screen. */
export const common: Record<string, CSSProperties> = {
  page:        { padding: "24px 32px 40px", color: c.text },
  header:      { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, gap: 16 },
  title:       { fontSize: 22, fontWeight: 700, margin: 0, color: c.text },
  subtitle:    { margin: "6px 0 0", color: c.textSub, fontSize: 14, maxWidth: 620, lineHeight: 1.5 },
  center:      { textAlign: "center", padding: 40, color: c.textSub, fontSize: 14 },

  error:       { background: c.red.bg,   color: c.red.text,   border: `1px solid ${c.red.border}`,   borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 13 },
  warn:        { background: c.amber.bg, color: c.amber.text, border: `1px solid ${c.amber.border}`, borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 13 },
  success:     { background: c.green.bg, color: c.green.text, border: `1px solid ${c.green.border}`, borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 13, fontWeight: 500 },
  nextStep:    { marginTop: 24, padding: "12px 16px", background: c.green.bg, border: `1px solid ${c.green.border}`, borderRadius: 10, fontSize: 14, color: c.green.text },
  empty:       { color: c.textSub, fontSize: 14, textAlign: "center", padding: 40, background: c.card, borderRadius: 12, border: "1px dashed rgba(255,255,255,0.15)" },

  card:        { background: c.card, border: `1px solid ${c.border}`, borderRadius: 12, overflow: "hidden" },
  icon:        { width: 38, height: 38, borderRadius: 10, background: c.accentSoft, color: c.accentText, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 16, flexShrink: 0 },
  cardTitle:   { fontSize: 15, fontWeight: 700, color: c.text },
  cardDesc:    { fontSize: 12, color: c.textSub, marginTop: 2 },
  sectionLabel:{ fontSize: 11, fontWeight: 700, color: c.accentText, textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 },

  label:       { display: "block", fontSize: 12, color: c.textSub, fontWeight: 600 },
  input:       { width: "100%", boxSizing: "border-box", fontSize: 14, padding: "10px 12px", borderRadius: 8, border: `1px solid ${c.borderInput}`, background: c.inputBg, color: c.text, outline: "none", fontFamily: "inherit" },

  // Buttons — primary matches .page-header-btn--import
  btnPrimary:  { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "9px 18px", borderRadius: 10, border: "none", background: gradient, color: "#fff", fontWeight: 700, fontSize: 13, letterSpacing: 0.2, cursor: "pointer", boxShadow: "0 2px 8px rgba(124,58,237,0.35)", fontFamily: "inherit", whiteSpace: "nowrap" },
  btnSuccess:  { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "9px 18px", borderRadius: 10, border: "none", background: "linear-gradient(135deg, #16a34a 0%, #15803d 100%)", color: "#fff", fontWeight: 700, fontSize: 13, letterSpacing: 0.2, cursor: "pointer", boxShadow: "0 2px 8px rgba(22,163,74,0.35)", fontFamily: "inherit", whiteSpace: "nowrap" },
  btnGhost:    { padding: "7px 14px", borderRadius: 8, border: `1px solid ${c.borderInput}`, background: "transparent", color: c.textSub, cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "inherit" },
  btnDanger:   { padding: "7px 14px", borderRadius: 8, border: `1px solid ${c.red.border}`, background: "transparent", color: c.red.text, cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "inherit" },
  btnDashed:   { padding: "9px 16px", borderRadius: 10, border: "1.5px dashed rgba(255,255,255,0.2)", background: "transparent", color: c.textSub, cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "inherit" },

  // Modal — matches CreateEntityModal
  backdrop:    { position: "fixed", inset: 0, zIndex: 1000, background: "rgba(10,8,18,0.62)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 },
  dialog:      { width: "100%", maxWidth: 460, background: "#2f2840", color: c.text, borderRadius: 14, border: "1px solid rgba(255,255,255,0.1)", padding: 24, boxShadow: "0 24px 60px rgba(0,0,0,0.5)", display: "flex", flexDirection: "column", gap: 10 },
};

export const checkboxAccent: CSSProperties = { accentColor: c.accent };