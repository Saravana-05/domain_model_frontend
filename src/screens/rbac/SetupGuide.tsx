/** Guided banner shown at the top of every RBAC screen explaining the 4-step flow. */
export function SetupGuide({ currentStep }: { currentStep: 1 | 2 | 3 | 4 }) {
  const steps = [
    { n: 1, label: "Roles",                   desc: "Create named roles like Admin, Manager, Viewer" },
    { n: 2, label: "Resources & Permissions", desc: "Sync your domain models and define what actions are allowed" },
    { n: 3, label: "Role → Permissions",      desc: "Grant each role its allowed actions on each resource" },
    { n: 4, label: "Users & Roles",           desc: "Create users and assign them roles" },
  ];

  return (
    <div style={s.wrap}>
      {steps.map((step, i) => {
        const active = step.n === currentStep;
        const done   = step.n < currentStep;
        return (
          <div key={step.n} style={{ display: "flex", alignItems: "center" }}>
            <div style={{ ...s.step, ...(active ? s.stepActive : done ? s.stepDone : {}) }}>
              <div style={{ ...s.circle, ...(active ? s.circleActive : done ? s.circleDone : {}) }}>
                {done ? "✓" : step.n}
              </div>
              <div>
                <div style={{ ...s.stepLabel, ...(active ? { color: "#4f46e5" } : done ? { color: "#059669" } : {}) }}>
                  Step {step.n}: {step.label}
                </div>
                <div style={s.stepDesc}>{step.desc}</div>
              </div>
            </div>
            {i < steps.length - 1 && <div style={s.arrow}>→</div>}
          </div>
        );
      })}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  wrap:        { display: "flex", alignItems: "flex-start", gap: 4, padding: "16px 20px", background: "#f8f9fc", borderRadius: 10, marginBottom: 24, flexWrap: "wrap", border: "1px solid #e5e7eb" },
  step:        { display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 12px", borderRadius: 8, flex: 1, minWidth: 160 },
  stepActive:  { background: "#ede9fe" },
  stepDone:    { background: "#dcfce7" },
  circle:      { width: 28, height: 28, borderRadius: "50%", background: "#e5e7eb", color: "#6b7280", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13, flexShrink: 0 },
  circleActive:{ background: "#4f46e5", color: "#fff" },
  circleDone:  { background: "#059669", color: "#fff" },
  stepLabel:   { fontSize: 13, fontWeight: 600, color: "#374151" },
  stepDesc:    { fontSize: 12, color: "#9ca3af", marginTop: 2 },
  arrow:       { fontSize: 18, color: "#d1d5db", padding: "0 4px", marginTop: 10 },
};
