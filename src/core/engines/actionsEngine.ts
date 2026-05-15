import type { ActionDef } from "../schema/types";

export interface ActionResult {
  success: boolean;
  response?: any;
  error?: string;
}

export async function executeAction(
  action: ActionDef,
  data: Record<string, any>
): Promise<ActionResult> {
  switch (action.type) {
    case "api": {
      // payload: domain name → send only that domain's data
      //          "all" or undefined → send everything
      const payload =
        !action.payload || action.payload === "all"
          ? data
          : (data[action.payload] ?? {});

      try {
        const res = await fetch(action.url!, {
          method:  action.method ?? "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify(payload),
        });
        const response = res.headers.get("content-type")?.includes("application/json")
          ? await res.json()
          : await res.text();
        return { success: res.ok, response };
      } catch (e) {
        return { success: false, error: String(e) };
      }
    }

    case "reset":
      return { success: true };

    case "navigate":
      if (action.url) window.location.href = action.url;
      return { success: true };

    default:
      return { success: false, error: `Unknown action type` };
  }
}
