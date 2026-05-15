import { createContext, useContext } from "react";
import type { FormEngine } from "../../FormEngine";
import type { ResolvedScreen } from "../schema/types";

interface EngineContextValue {
  engine: FormEngine;
  screen: ResolvedScreen;
}

export const EngineContext = createContext<EngineContextValue | null>(null);

export function useEngine(): EngineContextValue {
  const ctx = useContext(EngineContext);
  if (!ctx) throw new Error("useEngine must be used inside <EngineContext.Provider>");
  return ctx;
}
