/** Thrown by the API layers when the backend answers 403 (RBAC denied). */
export class PermissionError extends Error {
  status = 403;
  constructor(message: string) {
    super(message);
    this.name = "PermissionError";
  }
}

/** Pull the human-readable `detail` out of a FastAPI error body. */
export function extractDetail(body: string): string {
  try {
    const j = JSON.parse(body);
    if (typeof j?.detail === "string") return j.detail;
  } catch { /* not JSON */ }
  return body;
}

export const isPermissionError = (e: unknown): e is PermissionError =>
  e instanceof PermissionError;