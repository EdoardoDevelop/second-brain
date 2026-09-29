import "server-only";
import crypto from "node:crypto";
import { and, eq, inArray, isNotNull, lt, lte } from "drizzle-orm";
import { db, ready } from "./db";
import { items, projects, pushSubs, tasks } from "./db/schema";
import { getProfile, getSetting, setSetting } from "./settings";
import { isoDay } from "./format";

// Web Push senza dipendenze: firma VAPID (RFC 8292) e cifratura aes128gcm (RFC 8291) con node:crypto.

const b64u = (b: Buffer) => b.toString("base64url");
const fromB64u = (s: string) => Buffer.from(s, "base64url");

type Vapid = { publicKey: string; privateJwk: import("node:crypto").JsonWebKeyInput["key"] };

/** Chiavi VAPID: create al primo uso e salvate in `settings`. */
async function vapid(): Promise<Vapid> {
  const saved = await getSetting("vapid");
  if (saved) return JSON.parse(saved);
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = publicKey.export({ format: "jwk" });
  const raw = Buffer.concat([Buffer.from([4]), fromB64u(jwk.x!), fromB64u(jwk.y!)]);
  const v: Vapid = { publicKey: b64u(raw), privateJwk: privateKey.export({ format: "jwk" }) };
  await setSetting("vapid", JSON.stringify(v));
  return v;
}

export async function vapidPublicKey() {
  return (await vapid()).publicKey;
}

function jwt(aud: string, v: Vapid) {
  const enc = (o: object) => b64u(Buffer.from(JSON.stringify(o)));
  const data = `${enc({ typ: "JWT", alg: "ES256" })}.${enc({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: process.env.PUSH_CONTACT || "mailto:second-brain@localhost" })}`;
  const key = crypto.createPrivateKey({ key: v.privateJwk, format: "jwk" });
  const sig = crypto.sign("sha256", Buffer.from(data), { key, dsaEncoding: "ieee-p1363" });
  return `${data}.${b64u(sig)}`;
}

const hmac = (key: Buffer, data: Buffer) => crypto.createHmac("sha256", key).update(data).digest();

function encrypt(payload: Buffer, p256dh: string, auth: string) {
  const uaPublic = fromB64u(p256dh);
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const ikm = hmac(hmac(fromB64u(auth), shared), Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic, Buffer.from([1])]));
  const salt = crypto.randomBytes(16);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01")).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01")).subarray(0, 12);
  const cipher = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([payload, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

export type PushMessage = {
  title: string; body: string; url?: string; tag?: string;
  /** Pulsanti della notifica; il service worker li gestisce per le attività (taskId). */
  actions?: { action: string; title: string }[];
  taskId?: string;
  /** La notifica resta visibile finché non la si tocca. */
  sticky?: boolean;
};

/** Invia a tutti i dispositivi iscritti; rimuove le iscrizioni scadute. Restituisce quanti invii sono riusciti. */
export async function sendPush(msg: PushMessage): Promise<number> {
  await ready();
  const subs = await db.select().from(pushSubs);
  if (!subs.length) return 0;
  const v = await vapid();
  const payload = Buffer.from(JSON.stringify(msg));
  let ok = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      const res = await fetch(s.endpoint, {
        method: "POST",
        headers: {
          Authorization: `vapid t=${jwt(new URL(s.endpoint).origin, v)}, k=${v.publicKey}`,
          "Content-Encoding": "aes128gcm",
          "Content-Type": "application/octet-stream",
          TTL: "86400",
          Urgency: "normal",
        },
        body: encrypt(payload, s.p256dh, s.auth),
      });
      if (res.status === 404 || res.status === 410) await db.delete(pushSubs).where(eq(pushSubs.endpoint, s.endpoint));
      else if (res.ok) ok++;
      else console.error(`[push] ${res.status} ${await res.text().catch(() => "")}`);
    } catch (e) {
      console.error("[push]", e);
    }
  }));
  return ok;
}

// ——— Preferenze e notifiche automatiche ———

export type NotifyPrefs = { daily: boolean; dailyTime: string; ready: boolean };
export const DEFAULT_PREFS: NotifyPrefs = { daily: true, dailyTime: "08:00", ready: true };

export async function getNotifyPrefs(): Promise<NotifyPrefs> {
  const raw = await getSetting("notify");
  try { return { ...DEFAULT_PREFS, ...(raw ? JSON.parse(raw) : {}) }; } catch { return DEFAULT_PREFS; }
}

/** Proposta pronta per una cattura elaborata in background (per esempio dal «Condividi»). */
export async function notifyReady(title: string) {
  if (!(await getNotifyPrefs()).ready) return;
  await sendPush({ title: "Proposta pronta", body: title, url: "/inbox", tag: "inbox" });
}

const romeNow = () => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  return `${parts.hour}:${parts.minute}`;
};

/** Promemoria delle attività: invia quelli arrivati all'ora (entro le ultime 24 ore, per non recuperare arretrati vecchi). */
export async function remindersTick() {
  const now = Date.now();
  const due = await db.select().from(tasks)
    .where(and(eq(tasks.done, false), eq(tasks.reminded, false), isNotNull(tasks.remindAt), lte(tasks.remindAt, now)));
  for (const t of due) {
    // Segnato prima dell'invio: se l'invio fallisce non si ripete a ogni minuto.
    await db.update(tasks).set({ reminded: true }).where(eq(tasks.id, t.id));
    if (now - t.remindAt! > 86400000) continue;
    const [p] = t.projectId ? await db.select({ name: projects.name }).from(projects).where(eq(projects.id, t.projectId)) : [];
    const when = t.time ? (t.due === isoDay() ? `Oggi alle ${t.time}` : `${t.due} alle ${t.time}`) : "";
    await sendPush({
      title: t.title,
      body: [when, p?.name].filter(Boolean).join(" · ") || "Promemoria",
      url: "/attivita",
      tag: "task-" + t.id,
      taskId: t.id,
      sticky: true,
      actions: [{ action: "done", title: "Fatto" }, { action: "snooze", title: "+1 ora" }],
    });
  }
}

/**
 * Il giro del mattino, dall'orario scelto, una volta al giorno. Con l'IA: riepilogo scritto e suggerimenti
 * (lib/proactive.ts), anche se le notifiche sono spente (si vedono nella Home). La notifica parte sempre,
 * anche nelle giornate senza scadenze; senza IA è il riepilogo con i conteggi.
 */
export async function dailyDigestTick() {
  const prefs = await getNotifyPrefs();
  const today = isoDay();
  if (romeNow() < prefs.dailyTime || (await getSetting("notify_last_daily")) === today) return;
  await setSetting("notify_last_daily", today);
  const { aiEnabled } = await import("./ai");
  const { morningRound } = await import("./proactive");
  const brief = (await aiEnabled()) ? await morningRound().catch(() => null) : null;
  if (!prefs.daily) return;
  if (brief) {
    await sendPush({ title: brief.title, body: brief.body, url: "/", tag: "daily" });
    return;
  }
  const [open, inbox] = await Promise.all([
    db.select().from(tasks).where(and(eq(tasks.done, false), lt(tasks.due, today + "~"))),
    db.select({ id: items.id }).from(items).where(inArray(items.status, ["ready", "error"])),
  ]);
  const overdue = open.filter((t) => t.due! < today);
  const dueToday = open.filter((t) => t.due === today);
  const head = [dueToday.length && `${dueToday.length} in scadenza oggi`, overdue.length && `${overdue.length} scadute`].filter(Boolean).join(", ") || "nessuna scadenza oggi";
  const list = [...dueToday, ...overdue].slice(0, 4).map((t) => "• " + t.title);
  if (inbox.length) list.push(`${inbox.length} ${inbox.length === 1 ? "cattura" : "catture"} da confermare in Inbox`);
  const { computeChanges, changesLine } = await import("./proactive");
  const news = await computeChanges().then(changesLine).catch(() => "");
  if (news) list.push(news);
  const { name } = await getProfile();
  await sendPush({ title: `Buongiorno${name ? `, ${name}` : ""}! ${head.charAt(0).toUpperCase() + head.slice(1)}`, body: list.join("\n") || "Giornata libera: buon lavoro!", url: "/", tag: "daily" });
}
