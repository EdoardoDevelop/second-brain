// Versione della build in esecuzione: il client la confronta con la propria per ricaricarsi dopo un aggiornamento.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ build: process.env.NEXT_PUBLIC_BUILD_ID ?? "" }, { headers: { "Cache-Control": "no-store" } });
}
