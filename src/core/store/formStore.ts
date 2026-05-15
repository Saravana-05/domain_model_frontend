import { create } from "zustand";
import type { ResolvedField } from "../schema/types";
import { initNestedData, setFieldValue as setNested } from "../../utils/nested";

export interface FormState {
  // Nested by domain: { user: { email: "" }, order: { quantity: 1 } }
  data: Record<string, any>;

  ui: {
    visibility: Record<string, boolean>;  // keyed by full "domain.field" path
    disabled:   Record<string, boolean>;
    errors:     Record<string, string | null>;
    loading:    Record<string, boolean>;
  };

  meta: {
    touched: Record<string, boolean>;
    dirty:   Record<string, boolean>;
  };

  datasourceOptions: Record<string, Array<{ label: string; value: any }>>;

  initStore:            (fields: Record<string, ResolvedField>) => void;
  setFieldValue:        (path: string, value: any) => void;
  setError:             (path: string, error: string | null) => void;
  setVisible:           (path: string, value: boolean) => void;
  setDisabled:          (path: string, value: boolean) => void;
  setLoading:           (key: string, value: boolean) => void;
  setDatasourceOptions: (name: string, options: Array<{ label: string; value: any }>) => void;
  setTouched:           (path: string) => void;
}

export const useFormStore = create<FormState>()((set) => ({
  data: {},
  ui:   { visibility: {}, disabled: {}, errors: {}, loading: {} },
  meta: { touched: {}, dirty: {} },
  datasourceOptions: {},

  initStore(fields) {
    const visibility: Record<string, boolean>       = {};
    const disabled:   Record<string, boolean>       = {};
    const errors:     Record<string, string | null> = {};
    const touched:    Record<string, boolean>       = {};
    const dirty:      Record<string, boolean>       = {};

    for (const path of Object.keys(fields)) {
      visibility[path] = true;
      disabled[path]   = false;
      errors[path]     = null;
      touched[path]    = false;
      dirty[path]      = false;
    }

    set({
      data: initNestedData(fields),
      ui:   { visibility, disabled, errors, loading: {} },
      meta: { touched, dirty },
    });
  },

  setFieldValue(path, value) {
    set((s) => ({
      data: setNested(s.data, path, value),
      meta: { ...s.meta, dirty: { ...s.meta.dirty, [path]: true } },
    }));
  },

  setError(path, error) {
    set((s) => ({ ui: { ...s.ui, errors: { ...s.ui.errors, [path]: error } } }));
  },

  setVisible(path, value) {
    set((s) => ({ ui: { ...s.ui, visibility: { ...s.ui.visibility, [path]: value } } }));
  },

  setDisabled(path, value) {
    set((s) => ({ ui: { ...s.ui, disabled: { ...s.ui.disabled, [path]: value } } }));
  },

  setLoading(key, value) {
    set((s) => ({ ui: { ...s.ui, loading: { ...s.ui.loading, [key]: value } } }));
  },

  setDatasourceOptions(name, options) {
    set((s) => ({ datasourceOptions: { ...s.datasourceOptions, [name]: options } }));
  },

  setTouched(path) {
    set((s) => ({ meta: { ...s.meta, touched: { ...s.meta.touched, [path]: true } } }));
  },
}));
