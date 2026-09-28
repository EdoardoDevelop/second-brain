"use client";

import { useEffect, useState, useTransition } from "react";
import { pushPublicKey, saveNotifyPrefs, subscribePush, testPush, unsubscribePush } from "@/lib/actions";
import type { NotifyPrefs } from "@/lib/push";

type State = "loading" | "unsupported" | "denied" | "off" | "on";

const toKey = (b64: string) => {
  const s = atob(b64.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

/** Nome leggibile del dispositivo, per riconoscerlo nell'elenco. */
const deviceName = () => {
  const ua = navigator.userAgent;
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iPhone/iPad" : /Windows/.test(ua) ? "Windows" : /Mac/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "Dispositivo";
  const br = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${os} · ${br}`;
};

export function NotifySettings({ prefs: initial, devices }: { prefs: NotifyPrefs; devices: { endpoint: string; device: string; since: string }[] }) {
  const [state, setState] = useState<State>("loading");
  const [mine, setMine] = useState<string | null>(null);
  const [prefs, setPrefs] = useState(initial);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return setState("unsupported");
      if (Notification.permission === "denied") return setState("denied");
      const reg = await navigator.serviceWorker.register("/sw.js");
      const sub = await reg.pushManager.getSubscription();
      setMine(sub?.endpoint ?? null);
      setState(sub ? "on" : "off");
    })().catch(() => setState("unsupported"));
  }, []);

  const enable = () => start(async () => {
    setMsg(null);
    try {
      if ((await Notification.requestPermission()) !== "granted") { setState("denied"); return; }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(await pushPublicKey()) });
      await subscribePush(sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } }, deviceName());
      setMine(sub.endpoint);
      setState("on");
      setMsg("Notifiche attive su questo dispositivo.");
    } catch (e) {
      setMsg("Attivazione non riuscita: " + (e instanceof Error ? e.message : String(e)));
    }
  });

  const disable = () => start(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) { await unsubscribePush(sub.endpoint); await sub.unsubscribe(); }
    setMine(null);
    setState("off");
    setMsg(null);
  });

  const test = () => start(async () => {
    const n = await testPush();
    setMsg(n ? `Notifica di prova inviata a ${n} ${n === 1 ? "dispositivo" : "dispositivi"}.` : "Nessun dispositivo ha ricevuto la notifica.");
  });

  const update = (patch: Partial<NotifyPrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    start(() => saveNotifyPrefs(next));
  };

  const removeDevice = (endpoint: string) => start(async () => {
    await unsubscribePush(endpoint);
    if (endpoint === mine) { setMine(null); setState("off"); }
  });

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <SRow title="Questo dispositivo" desc={
        state === "unsupported" ? "Questo browser non supporta le notifiche. Su iPhone installa prima l'app sulla schermata Home."
        : state === "denied" ? "Le notifiche sono bloccate: riattivale dalle impostazioni del browser per questo sito."
        : state === "on" ? "Riceve le notifiche."
        : state === "off" ? "Non riceve notifiche." : "…"
      }>
        <div style={{ display: "flex", gap: 8 }}>
          {state === "on" && <button className="btn btn-secondary" onClick={test} disabled={pending}>Invia una prova</button>}
          {state === "on" && <button className="btn btn-ghost" onClick={disable} disabled={pending}>Disattiva</button>}
          {state === "off" && <button className="btn btn-primary" onClick={enable} disabled={pending}>Attiva le notifiche</button>}
        </div>
      </SRow>
      {msg && <div className="muted" style={{ fontSize: 13, padding: "0 0 12px" }}>{msg}</div>}

      <SRow title="Riepilogo del mattino" desc="Attività in scadenza oggi e scadute. Solo se ce ne sono.">
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input type="time" className="input" value={prefs.dailyTime} onChange={(e) => e.target.value && update({ dailyTime: e.target.value })} disabled={!prefs.daily} style={{ height: 36, width: 120 }} />
          <Toggle on={prefs.daily} onChange={(daily) => update({ daily })} label="Riepilogo del mattino" />
        </div>
      </SRow>
      <SRow title="Proposta pronta" desc="Quando una cosa condivisa dal telefono è stata letta e classificata.">
        <Toggle on={prefs.ready} onChange={(ready) => update({ ready })} label="Proposta pronta" />
      </SRow>

      {devices.length > 0 && (
        <SRow title="Dispositivi iscritti" desc="Ricevono tutti le stesse notifiche.">
          <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
            {devices.map((d) => (
              <div key={d.endpoint} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}>
                <span>{d.device || "Dispositivo"}{d.endpoint === mine && <span className="muted"> (questo)</span>}</span>
                <span className="muted" style={{ fontSize: 12 }}>dal {d.since}</span>
                <button className="btn btn-ghost" style={{ height: 28, padding: "0 8px" }} onClick={() => removeDevice(d.endpoint)} disabled={pending}>Rimuovi</button>
              </div>
            ))}
          </div>
        </SRow>
      )}
    </div>
  );
}

function SRow({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "14px 0", borderTop: "1px solid var(--color-divider)", flexWrap: "wrap" }}>
      <div style={{ minWidth: 0, flex: "1 1 240px" }}><div style={{ fontSize: 15 }}>{title}</div><div className="muted" style={{ fontSize: 13 }}>{desc}</div></div>
      {children}
    </div>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      style={{ width: 44, height: 26, borderRadius: 13, border: "1px solid var(--color-divider)", background: on ? "var(--color-accent)" : "var(--skel)", position: "relative", cursor: "pointer", flex: "none", padding: 0 }}>
      <span style={{ position: "absolute", top: 2, left: on ? 20 : 2, width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: "left .15s", boxShadow: "0 1px 2px rgba(0,0,0,.3)" }} />
    </button>
  );
}
