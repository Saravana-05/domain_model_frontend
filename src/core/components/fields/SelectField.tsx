import { useFieldValue, useFieldUI, useDatasourceOptions, useIsLoading } from "../../store/selectors";
import { useEngine } from "../../renderer/EngineContext";

interface SelectFieldProps {
  path: string;
  label?: string;
  datasource?: string;
}

export function SelectField({ path, label, datasource }: SelectFieldProps) {
  const value = useFieldValue(path) ?? "";
  const { visible, disabled, error, touched } = useFieldUI(path);
  const options = useDatasourceOptions(datasource);
  const loading = useIsLoading(datasource ?? "");
  const { engine } = useEngine();

  if (!visible) return null;

  return (
    <div className="field-wrapper">
      {label && <label className="field-label" htmlFor={path}>{label}</label>}
      <select
        id={path}
        className={`field-input field-select ${error && touched ? "field-input--error" : ""}`}
        value={value}
        disabled={disabled || loading}
        onChange={(e) => engine.onFieldChange(path, e.target.value)}
        onBlur={() => engine.onFieldBlur(path)}
      >
        <option value="">{loading ? "Loading…" : "Select…"}</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {touched && error && <span className="field-error">{error}</span>}
    </div>
  );
}
