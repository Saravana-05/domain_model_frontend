const API_BASE = import.meta.env.VITE_API_URL || "https://ab2dgab6euwc4d2f3dkgddmxiu0mmuxx.lambda-url.ap-south-1.on.aws";

export async function apiLogin(email: string, password: string) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST", 
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mail_id: email, password }),
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status}`);
  return res.json();
}

/** Current roles + effective permissions, straight from the database.
 *  Used to keep the UI in step when an admin changes this user's roles
 *  after they logged in. Resolves to null on any failure (UI keeps what it has). */
export async function apiFetchMe(token: string): Promise<{
  roles: string[];
  permissions: { resource: string; action: string }[];
} | null> {
  try {
    const res = await fetch(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (json.status !== "success") return null;
    return {
      roles: json.data.roles ?? [],
      permissions: json.data.permissions ?? [],
    };
  } catch {
    return null;
  }
}