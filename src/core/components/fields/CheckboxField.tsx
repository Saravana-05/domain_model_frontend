import { useFieldValue, useFieldUI } from "../../store/selectors";
import { useEngine } from "../../renderer/EngineContext";

interface CheckboxFieldProps {
  path: string;
  label?: string;
}

export function CheckboxField({ path, label }: CheckboxFieldProps) {
  const value = useFieldValue(path) ?? false;
  const { visible, disabled, error, touched } = useFieldUI(path);
  const { engine } = useEngine();

  if (!visible) return null;

  return (
    <div className="field-wrapper field-wrapper--checkbox">
      <label className="field-checkbox-label">
        <input
          type="checkbox"
          className="field-checkbox"
          checked={Boolean(value)}
          disabled={disabled}
          onChange={(e) => engine.onFieldChange(path, e.target.checked)}
          onBlur={() => engine.onFieldBlur(path)}
        />
        {label && <span>{label}</span>}
      </label>
      {touched && error && <span className="field-error">{error}</span>}
    </div>
  );
}
