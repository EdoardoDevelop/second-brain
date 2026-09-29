"use client";

import { useEffect, useState, useTransition } from "react";
import { Icon } from "@/components/ui";
import type { IconName } from "@/lib/icons";
import { addFact, interpret, runCommand } from "@/lib/actions";
import type { ProposedFact } from "@/lib/chat";
import type { CommandAction, CommandKind } from "@/lib/ai";
import { dueInfo } from "@/lib/format";
import { useRecorder } from "./useRecorder";
import { CommandHelpButton } from "./CommandHelp";
import { VoiceStage } from "./VoiceStage";

export const KIND: Record<CommandKind, [string, IconName]> = {
  capture: ["Cattura in Inbox", "inbox"],
  add_task: ["Nuova attività", "tasks"],
  complete_task: ["Completa attività", "check"],
  reopen_task: ["Riapri attività", "refresh"],
  set_task_due: ["Cambia scadenza", "calendar"],
  update_task: ["Modifica attività", "edit"],
  delete_task: ["Elimina attività", "trash"],
  create_project: ["Nuovo progetto", "folder"],
  update_project: ["Modifica progetto", "folder"],
  add_goal: ["Nuovo obiettivo", "target"],
  complete_goal: ["Obiettivo raggiunto", "check"],
  reopen_goal: ["Riapri obiettivo", "refresh"],
  delete_goal: ["Elimina obiettivo", "trash"],
  upsert_person: ["Persona", "user"],
  update_item: ["Modifica elemento", "edit"],
  append_item: ["Aggiungi all'elemento", "note"],
  archive_item: ["Archivia elemento", "archive"],
  favorite_item: ["Preferiti", "star"],
  link_items: ["Collega elementi", "link"],
  merge_items: ["Unisci doppioni", "archive"],
};

const PRIO = ["", "Alta", "Media", "Bassa"];

type Fact = ProposedFact & { state: "review" | "saved" | "discarded" };
type Proposal = { transcript: string; actions: (CommandAction & { on: boolean })[]; names: Record<string, string>; reply: string; facts: Fact[] };
type Phase = "idle" | "recording" | "thinking" | "review" | "saving" | "done";

/** Barra dei comandi: voce o testo → azioni proposte dall'IA → conferma. */
export function CommandBar({ onClose, startRecording }: { onClose: () => void; startRecording?: boolean }) {
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [voice, setVoice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [doneCount, setDoneCount] = useState(0);
  const [, start] = useTransition();

  const send = (input: { text?: string; audio?: string }) => {
    setPhase("thinking");
    setVoice(!!input.audio);
    setError(null);
    start(async () => {
      const res = await interpret(input);
      if ("error" in res) { setError(res.error); setPhase("idle"); return; }
      setProposal({ ...res, actions: res.actions.map((a) => ({ ...a, on: true })), facts: res.facts.map((f): Fact => ({ ...f, state: "review" })) });
      if (input.audio) setText(res.transcript);
      setPhase("review");
    });
  };

  const mic = useRecorder(
    (audio) => send({ audio }),
    (msg) => { setError(msg); setPhase("idle"); },
  );
  const record = () => { setError(null); setPhase("recording"); mic.start(); };
  const stop = () => mic.stop();
  const release = () => mic.release();
  const cancel = () => { release(); onClose(); };
  const cancelRecording = () => { release(); setPhase("idle"); };

  useEffect(() => {
    if (startRecording) record();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") cancel(); };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); release(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const decideFact = (k: number, keep: boolean) => {
    const f = proposal?.facts[k];
    if (!f) return;
    if (keep) addFact(f.text, "comando", { replaces: f.replaces.map((r) => r.id), category: f.category });
    setProposal((p) => p && { ...p, facts: p.facts.map((x, h) => (h === k ? { ...x, state: keep ? "saved" : "discarded" } : x)) });
  };

  const update = (i: number, patch: Partial<CommandAction & { on: boolean }>) =>
    setProposal((p) => p && { ...p, actions: p.actions.map((a, j) => (j === i ? { ...a, ...patch } : a)) });

  const confirmAll = () => {
    if (!proposal) return;
    const chosen = proposal.actions.filter((a) => a.on).map(({ on: _on, ...a }) => a);
    setPhase("saving");
    start(async () => {
      setDoneCount(await runCommand(chosen));
      setPhase("done");
    });
  };

  const reset = () => { setProposal(null); setText(""); setPhase("idle"); setError(null); };
  const busy = phase === "thinking" || phase === "saving";
  const selected = proposal?.actions.filter((a) => a.on).length ?? 0;
  // Registrazione e attesa dopo la voce: pannello grande con l'animazione.
  const voiceStage = phase === "recording" || (phase === "thinking" && voice);

  return (
    <div onClick={cancel} className="cmd-overlay">
      <div onClick={(e) => e.stopPropagation()} className="blueprint cmd-sheet" role="dialog" aria-label="Comando all'IA">
        <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />

        {voiceStage ? (
          <VoiceStage analyser={mic.analyser} listening={phase === "recording"} seconds={mic.seconds} onCancel={cancelRecording} onStop={stop} />
        ) : (
          <>
            <div className="cmd-head">
              <span style={{ color: "var(--accent-text)", paddingTop: 9 }}><Icon name="ai" /></span>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && text.trim() && !busy) { e.preventDefault(); send({ text }); } }}
                placeholder="Scrivi o detta: «aggiungi un'attività per venerdì…», «metti Alpha al 60%»…"
                rows={2}
                autoFocus={!startRecording}
                disabled={busy || phase === "review" || phase === "done"}
                style={{ flex: 1, minWidth: 0, border: 0, background: "none", color: "var(--color-text)", font: "inherit", fontSize: 16, outline: "none", resize: "none", padding: "8px 0" }}
              />
              {phase === "idle" && (
                <div className="cmd-head-tools">
                  <CommandHelpButton onPick={setText} />
                  <button className="btn btn-secondary btn-icon" onClick={record} title="Detta" aria-label="Detta"><Icon name="mic" /></button>
                  <button className="btn btn-primary" onClick={() => send({ text })} disabled={!text.trim()}>Invia</button>
                </div>
              )}
            </div>

            <div className="cmd-body">
              {error && <div className="alert"><Icon name="alert" style={{ color: "var(--danger)" }} /><span style={{ flex: 1 }}>{error}</span></div>}
              {phase === "idle" && !error && (
                <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
                  Puoi catturare note, creare, modificare o completare attività, aggiornare progetti e persone, modificare, archiviare o collegare elementi della memoria. Nulla viene salvato senza la tua conferma.
                </p>
              )}
              {phase === "thinking" && <div className="muted" style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 14 }}><span className="spin" />Ci penso: cerco quello che serve…</div>}

              {(phase === "review" || phase === "saving") && proposal && (
                <>
                  {voice && proposal.transcript && <div className="muted" style={{ display: "flex", gap: 8, fontSize: 13 }}><Icon name="mic" size={14} style={{ flex: "none", marginTop: 2 }} /><span>«{proposal.transcript}»</span></div>}
                  {proposal.facts.map((f, k) => (
                    <div key={k} className="fact-card" data-state={f.state}>
                      <Icon name="ai" size={14} />
                      <span style={{ flex: 1 }}>{f.state === "saved" ? "Ricorderò: " : f.state === "discarded" ? "Non lo ricorderò: " : "Vuoi che ricordi che "}<b style={{ fontWeight: 500 }}>{f.text}</b>{f.state === "review" ? "?" : ""}{f.replaces.length ? <span className="muted" style={{ display: "block", fontSize: 12.5 }}>{f.state === "saved" ? "Non più vero: " : "Al posto di: "}{f.replaces.map((r) => `«${r.text}»`).join(", ")}</span> : null}</span>
                      {f.state === "review" && (
                        <>
                          <button className="btn btn-ghost" onClick={() => decideFact(k, false)}>No</button>
                          <button className="btn btn-primary" onClick={() => decideFact(k, true)}>Ricorda</button>
                        </>
                      )}
                    </div>
                  ))}
                  {proposal.actions.length === 0 ? (
                    proposal.facts.length ? null : proposal.reply
                      ? <div className="cmd-reply">{proposal.reply.split(/\n\s*\n/).map((p, i) => <p key={i}>{p.replace(/\*\*/g, "")}</p>)}</div>
                      : <p className="muted" style={{ margin: 0, fontSize: 14 }}>Non ho capito cosa fare. Riprova con parole diverse.</p>
                  ) : (
                    proposal.actions.map((a, i) => <ActionCard key={i} a={a} names={proposal.names} onChange={(p) => update(i, p)} />)
                  )}
                  <div className="cmd-footer">
                    <button className="btn btn-ghost" onClick={reset} disabled={busy}>Ricomincia</button>
                    {proposal.actions.length > 0 && (
                      <button className="btn btn-primary" onClick={confirmAll} disabled={busy || !selected}>
                        {phase === "saving" ? "Salvo…" : selected === 1 ? "Conferma" : `Conferma ${selected} azioni`}
                      </button>
                    )}
                  </div>
                </>
              )}

              {phase === "done" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 15 }}>
                    <span style={{ color: "var(--accent-text)" }}><Icon name="check" /></span>
                    <span style={{ flex: 1 }}>{doneCount === 1 ? "Azione eseguita." : `${doneCount} azioni eseguite.`} Le catture sono in Inbox per la conferma.</span>
                  </div>
                  <div className="cmd-footer">
                    <button className="btn btn-secondary" onClick={reset}>Nuovo comando</button>
                    <button className="btn btn-primary" onClick={onClose}>Chiudi</button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function ActionCard({ a, names, onChange }: { a: CommandAction & { on: boolean }; names: Record<string, string>; onChange: (p: Partial<CommandAction & { on: boolean }>) => void }) {
  const [label, icon] = KIND[a.kind];
  const input = { className: "input", style: { height: 32, fontSize: 14 } };
  const facts: string[] = [];
  if (a.taskId) facts.push(names[a.taskId] ?? a.taskId);
  if (a.goalId) facts.push(names[a.goalId] ?? a.goalId);
  if (a.itemId) facts.push(names[a.itemId] ?? a.itemId);
  if (a.targetId) facts.push((a.kind === "merge_items" ? "← unisce e archivia " : "↔ ") + (names[a.targetId] ?? a.targetId));
  if (a.reason) facts.push((a.conflict ? "In conflitto: " : "Motivo: ") + a.reason);
  if (a.kind === "favorite_item") facts.push(a.conflict === false ? "Togli dai preferiti" : "Aggiungi ai preferiti");
  if (a.kind === "update_task" && a.title) facts.push("Nuovo titolo: " + a.title);
  if (a.kind === "update_task" && a.due) facts.push("Scadenza: " + dueInfo(a.due).label);
  if (a.prio) facts.push("Priorità: " + PRIO[a.prio]);
  if (a.time && a.kind !== "add_task") facts.push("Orario: " + a.time);
  if (a.time && a.remind != null) facts.push("Promemoria: " + (a.remind === 0 ? "all'orario" : a.remind >= 60 && a.remind % 60 === 0 ? `${a.remind / 60} ${a.remind === 60 ? "ora" : "ore"} prima` : `${a.remind} minuti prima`));
  if (a.kind === "update_item" && a.title) facts.push("Nuovo titolo: " + a.title);
  if (a.summary) facts.push("Sintesi: " + a.summary);
  if (a.tags?.length) facts.push("Aggiungi tag: " + a.tags.map((t) => "#" + t).join(" "));
  if (a.removeTags?.length) facts.push("Togli tag: " + a.removeTags.map((t) => "#" + t).join(" "));
  if (a.addPeople?.length) facts.push("Collega: " + a.addPeople.map((id) => names[id] ?? id).join(", "));
  if (a.projectId && a.kind !== "update_project") facts.push("Progetto: " + (names[a.projectId] ?? a.projectId));
  if (a.status) facts.push("Stato: " + a.status);
  if (a.pct != null) facts.push(`Avanzamento: ${a.pct}%`);
  if (a.next) facts.push("Milestone: " + a.next);
  if (a.description) facts.push(a.description);
  for (const [k, v] of [["Ruolo", a.role], ["Organizzazione", a.org], ["Email", a.email], ["Nota", a.note]] as const) if (v) facts.push(`${k}: ${v}`);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "18px minmax(0,1fr)", gap: 12, padding: 12, border: "1px solid var(--color-divider)", opacity: a.on ? 1 : 0.5 }}>
      <input type="checkbox" checked={a.on} onChange={(e) => onChange({ on: e.target.checked })} aria-label="Includi" style={{ marginTop: 3 }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
        <div className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--accent-text)" }}>
          <Icon name={icon} size={14} />{label}
          {a.kind === "update_project" && a.projectId && <span style={{ color: "var(--color-text)", textTransform: "none", letterSpacing: 0 }}>· {names[a.projectId]}</span>}
          {a.kind === "upsert_person" && <span style={{ color: "var(--muted)", textTransform: "none", letterSpacing: 0 }}>· {a.personId ? "modifica " + names[a.personId] : "nuova"}</span>}
        </div>
        {(a.kind === "capture" || a.kind === "append_item") && <textarea className="input" value={a.text ?? ""} onChange={(e) => onChange({ text: e.target.value })} rows={3} style={{ fontSize: 14 }} />}
        {(a.kind === "add_task" || a.kind === "add_goal" || a.kind === "create_project") && <input {...input} value={a.title ?? ""} onChange={(e) => onChange({ title: e.target.value })} />}
        {a.kind === "upsert_person" && <input {...input} value={a.name ?? (a.personId ? names[a.personId] : "") ?? ""} onChange={(e) => onChange({ name: e.target.value })} placeholder="Nome" />}
        {(a.kind === "add_task" || a.kind === "set_task_due") && (
          <label className="muted" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            Scadenza
            <input {...input} type="date" value={a.due ?? ""} onChange={(e) => onChange({ due: e.target.value || null })} style={{ ...input.style, width: 160 }} />
            {a.kind === "add_task" && <input {...input} type="time" value={a.time ?? ""} onChange={(e) => onChange({ time: e.target.value || null, remind: e.target.value ? (a.remind ?? 0) : null })} style={{ ...input.style, width: 110 }} aria-label="Orario" />}
            {a.due && <span>{dueInfo(a.due).label}</span>}
          </label>
        )}
        {facts.length > 0 && <div className="muted" style={{ fontSize: 13, display: "flex", flexDirection: "column", gap: 2 }}>{facts.map((f) => <span key={f}>{f}</span>)}</div>}
      </div>
    </div>
  );
}
