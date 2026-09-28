import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createHmac, timingSafeEqual } from "node:crypto";

// Singolo utente: una password, un cookie firmato valido 90 giorni su ogni dispositivo.
const COOKIE = "sb_session";
const MAX_AGE = 60 * 60 * 24 * 90;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("SESSION_SECRET mancante o troppo corto (minimo 16 caratteri).");
  return s;
}

function sign(payload: string) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function checkPassword(input: string) {
  const expected = process.env.APP_PASSWORD;
  if (!expected) throw new Error("APP_PASSWORD non impostata.");
  return safeEqual(sign("pw:" + input), sign("pw:" + expected));
}

export async function startSession() {
  const exp = Date.now() + MAX_AGE * 1000;
  const value = exp + "." + sign("session:" + exp);
  (await cookies()).set(COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function endSession() {
  (await cookies()).delete(COOKIE);
}

export async function isAuthenticated() {
  const value = (await cookies()).get(COOKIE)?.value;
  if (!value) return false;
  const [exp, sig] = value.split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return safeEqual(sig, sign("session:" + exp));
}

/** Da chiamare in ogni pagina e server action protetta. */
export async function requireAuth() {
  if (!(await isAuthenticated())) redirect("/login");
}
