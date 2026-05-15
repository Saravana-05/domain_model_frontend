import type { ReactNode } from "react";

interface SectionProps {
  label?: string;
  children?: ReactNode;
}

export function Section({ label, children }: SectionProps) {
  return (
    <div className="section">
      {label && <h3 className="section-title">{label}</h3>}
      <div className="section-body">{children}</div>
    </div>
  );
}
