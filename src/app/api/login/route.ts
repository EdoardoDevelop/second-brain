import { NextResponse, type NextRequest } from "next/server";
import { checkPassword, startSession } from "@/lib/auth";

// Form HTML classico: funziona anche senza JavaScript e dietro qualsiasi proxy.
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const ok = checkPassword(String(form.get("password") ?? ""));
  if (ok) await startSession();
  // Redirect relativo: resta sull'host pubblico anche dietro nginx.
  return new NextResponse(null, { status: 303, headers: { Location: ok ? "/" : "/login?errore=1" } });
}
