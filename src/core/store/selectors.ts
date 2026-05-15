import { useShallow } from "zustand/shallow";
import { useFormStore } from "./formStore";
import { splitPath } from "../../utils/nested";

const EMPTY_OPTIONS: Array<{ label: string; value: any }> = [];

// Returns primitive — stable reference, no useShallow needed
export function useFieldValue(path: string) {
  const [domain, name] = splitPath(path);
  return useFormStore((s) => s.data[domain]?.[name]);
}

// Returns object — useShallow prevents infinite loop
export function useFieldUI(path: string) {
  return useFormStore(
    useShallow((s) => ({
      visible:  s.ui.visibility[path] ?? true,
      disabled: s.ui.disabled[path]   ?? false,
      error:    s.ui.errors[path]     ?? null,
      touched:  s.meta.touched[path]  ?? false,
      dirty:    s.meta.dirty[path]    ?? false,
    }))
  );
}

export function useDatasourceOptions(name: string | undefined) {
  return useFormStore((s) => (name ? (s.datasourceOptions[name] ?? EMPTY_OPTIONS) : EMPTY_OPTIONS));
}

export function useIsLoading(key: string) {
  return useFormStore((s) => s.ui.loading[key] ?? false);
}

// Returns nested data object — same reference unless data changed
export function useFormData() {
  return useFormStore((s) => s.data);
}

export function useFormErrors() {
  return useFormStore((s) => s.ui.errors);
}
