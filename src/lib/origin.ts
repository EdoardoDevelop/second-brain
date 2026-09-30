/**
 * Indirizzo pubblico dell'app, per gli URL da copiare (MCP, API, skill).
 * Il proxy di aaPanel non inoltra X-Forwarded-Proto e Next.js lo riempie con "http"
 * (la connessione interna da nginx): fuori da localhost l'app è sempre in HTTPS.
 */
export function publicOrigin(h: Headers): string {
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  const local = /^(localhost|127\.|\[::1\])/.test(host);
  return `${local ? (h.get("x-forwarded-proto") ?? "http") : "https"}://${host}`;
}
