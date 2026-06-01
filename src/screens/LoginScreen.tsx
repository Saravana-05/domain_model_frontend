import { useState } from "react";
import { useAuthStore } from "../store/authStore";
import { apiLogin } from "../core/api/authApi";

export function LoginScreen({ sessionExpired }: { sessionExpired?: boolean } = {}) {
  const login = useAuthStore((s) => s.login);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await apiLogin(email, password);
      if (res.status !== "success") {
        setError(res.message ?? "Login failed");
        return;
      }
      const d = res.data;
      login(d.access, {
        userId: d.user_id,
        userName: d.user_name ?? d.mail_id,
        email: d.mail_id,
        role: d.role,
        orgId: d.organization_id ?? null,
        permissions: d.permissions ?? [],
      });
    } catch (err: any) {
      setError(err.message ?? "Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.overlay}>
      <form style={styles.card} onSubmit={handleSubmit}>
        <h2 style={styles.title}>Sign In</h2>

        {sessionExpired && !error && (
          <div style={{ ...styles.errorBox, background: "#fef9c3", color: "#854d0e" }}>
            Your session expired — please sign in again.
          </div>
        )}
        {error && <div style={styles.errorBox}>{error}</div>}

        <label style={styles.label}>Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          required
          style={styles.input}
        />

        <label style={styles.label}>Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          required
          style={styles.input}
        />

        <button type="submit" disabled={loading} style={styles.button}>
          {loading ? "Signing in…" : "Sign In"}
        </button>
      </form>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#f0f2f5",
  },
  card: {
    background: "#fff",
    borderRadius: 12,
    padding: "40px 36px",
    width: 360,
    boxShadow: "0 4px 24px rgba(0,0,0,0.12)",
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  title: {
    margin: "0 0 8px",
    fontSize: 24,
    fontWeight: 700,
    color: "#1a1a2e",
    textAlign: "center",
  },
  label: { fontSize: 13, fontWeight: 600, color: "#444", marginBottom: 2 },
  input: {
    padding: "10px 14px",
    borderRadius: 8,
    border: "1.5px solid #d0d5dd",
    fontSize: 14,
    outline: "none",
    transition: "border-color 0.2s",
  },
  button: {
    marginTop: 8,
    padding: "12px",
    borderRadius: 8,
    border: "none",
    background: "#4f46e5",
    color: "#fff",
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
  },
  errorBox: {
    background: "#fee2e2",
    color: "#b91c1c",
    borderRadius: 6,
    padding: "10px 14px",
    fontSize: 13,
  },
};
