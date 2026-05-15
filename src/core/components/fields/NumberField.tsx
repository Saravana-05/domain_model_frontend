import { useFieldValue, useFieldUI } from "../../store/selectors";
import { useEngine } from "../../renderer/EngineContext";

interface NumberFieldProps {
  path: string;
  label?: string;
  placeholder?: string;
}

export function NumberField({ path, label, placeholder }: NumberFieldProps) {
  const value = useFieldValue(path) ?? "";
  const { visible, disabled, error, touched } = useFieldUI(path);
  const { engine } = useEngine();

  if (!visible) return null;

  return (
    <div className="field-wrapper">
      {label && <label className="field-label" htmlFor={path}>{label}</label>}
      <input
        id={path}
        type="number"
        className={`field-input ${error && touched ? "field-input--error" : ""}`}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => {
          const parsed = parseFloat(e.target.value);
          engine.onFieldChange(path, isNaN(parsed) ? "" : parsed);
        }}
        onBlur={() => engine.onFieldBlur(path)}
      />
      {touched && error && <span className="field-error">{error}</span>}
    </div>
  );
}
