import { useFieldValue, useFieldUI } from "../../store/selectors";
import { useEngine } from "../../renderer/EngineContext";

interface TextFieldProps {
  path: string;
  label?: string;
  placeholder?: string;
  multiline?: boolean;
}

export function TextField({ path, label, placeholder, multiline }: TextFieldProps) {
  const value = useFieldValue(path) ?? "";
  const { visible, disabled, error, touched } = useFieldUI(path);
  const { engine } = useEngine();

  if (!visible) return null;

  return (
    <div className="field-wrapper">
      {label && <label className="field-label" htmlFor={path}>{label}</label>}
      {multiline ? (
        <textarea
          id={path}
          className={`field-input ${error && touched ? "field-input--error" : ""}`}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          rows={3}
          onChange={(e) => engine.onFieldChange(path, e.target.value)}
          onBlur={() => engine.onFieldBlur(path)}
        />
      ) : (
        <input
          id={path}
          type="text"
          className={`field-input ${error && touched ? "field-input--error" : ""}`}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => engine.onFieldChange(path, e.target.value)}
          onBlur={() => engine.onFieldBlur(path)}
        />
      )}
      {touched && error && <span className="field-error">{error}</span>}
    </div>
  );
}
