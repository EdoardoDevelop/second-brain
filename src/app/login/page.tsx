import { Blueprint } from "@/components/ui";
import { Logo } from "@/components/Logo";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ errore?: string }> }) {
  const { errore } = await searchParams;
  return (
    <div style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 16, background: "var(--color-bg)", color: "var(--color-text)", fontFamily: "var(--font-body)" }}>
      <Blueprint style={{ width: "min(380px, 100%)", padding: "28px 28px 24px" }}>
        <form method="post" action="/api/login" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
            <Logo size={30} />
            <div style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 22 }}>Second Brain</div>
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" name="password" type="password" className="input" autoFocus required autoComplete="current-password" />
          </div>
          {errore && <div style={{ color: "var(--danger)", fontSize: 13 }}>Password non corretta.</div>}
          <button className="btn btn-primary" style={{ height: 36 }}>Entra</button>
        </form>
      </Blueprint>
    </div>
  );
}
