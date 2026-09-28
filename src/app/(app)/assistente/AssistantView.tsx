"use client";

import Link from "next/link";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { Blueprint, Icon, itemIcon } from "@/components/ui";
import { ActionCard } from "@/components/CommandBar";
import { CommandHelpButton } from "@/components/CommandHelp";
import { VoiceSheet } from "@/components/VoiceStage";
import { useRecorder } from "@/components/useRecorder";
import { addFact, deleteChat, listChats, loadChat, runCommand, saveAnswer, saveChat, transcribeAudio } from "@/lib/actions";
import { shortDate } from "@/lib/format";
import type { ChatTurn } from "@/lib/ai";
import { answerText, type AskEvent, type Card, type ChatAnswer, type ChatMsg, type ChatSummary, type FactCard, type LegacyAnswer, type Reply } from "@/lib/chat";

type Scopes = { projects: { id: string; name: string }[]; people: { id: string; name: string }[] };

const CURRENT = "sb_chat_id";
/** Conversazione salvata nel browser prima delle conversazioni sul server: si importa una volta. */
const OLD_STORE = "sb_chat";
const SUGGESTIONS = ["Cosa devo fare questa settimana?", "Riassumi le decisioni recenti", "Ci sono informazioni in conflitto?", "Ricordami di chiamare Marco venerdì"];

const replyText = (m: Reply) => {
  const lines = m.answer ? [answerText(m.answer)] : [];
  if (m.cards.length) lines.push(`Azioni proposte (${m.cmd === "done" ? "eseguite" : m.cmd === "discarded" ? "annullate" : "in attesa"}): ${m.cards.map((c) => c.label).join("; ")}`);
  return lines.filter(Boolean).join("\n");
};

/** Messaggi del vecchio formato locale (res.answer / res.command) nel formato attuale. */
function migrate(old: unknown[]): ChatMsg[] {
  return old.flatMap((m): ChatMsg[] => {
    const x = m as { role: string; res?: { answer: LegacyAnswer | null; command: { names: Record<string, string> } | null; scope: string }; cards?: Card[]; cmd?: Reply["cmd"]; doneCount?: number };
    if (x.role !== "assistant") return [m as ChatMsg];
    if (!x.res) return [];
    return [{ role: "assistant", answer: x.res.answer, cards: x.cards ?? [], names: x.res.command?.names ?? {}, cmd: x.cmd === "saving" ? "discarded" : x.cmd ?? "review", doneCount: x.doneCount ?? 0, scope: x.res.scope }];
  });
}

const relTime = (ms: number) => {
  const d = Math.round((Date.now() - ms) / 60000);
  if (d < 1) return "ora";
  if (d < 60) return `${d} min fa`;
  if (d < 60 * 24) return `${Math.round(d / 60)} h fa`;
  return shortDate(new Date(ms));
};

export function AssistantView({ scopes, initialScope, initialQuestion, initialChat, enabled, name, focus }: {
  scopes: Scopes; initialScope: string; initialQuestion: string; initialChat: string | null; enabled: boolean; name: string;
  /** Pagina da cui arriva la domanda (item:<id>, project:<id>, person:<id>). */
  focus?: string;
}) {
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [scope, setScope] = useState(initialScope);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const msgsRef = useRef(msgs);
  msgsRef.current = msgs;
  const chatRef = useRef(chatId);
  chatRef.current = chatId;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const dirty = useRef(false);

  const mic = useRecorder(
    (wav) => {
      setTranscribing(true);
      transcribeAudio(wav).then((res) => {
        setTranscribing(false);
        if ("error" in res) setMsgs((m) => [...m, { role: "error", text: res.error }]);
        else send(res.text, true);
      });
    },
    (text) => setMsgs((m) => [...m, { role: "error", text }]),
  );

  const remember = (id: string | null) => {
    try { if (id) localStorage.setItem(CURRENT, id); else localStorage.removeItem(CURRENT); } catch {}
    const url = new URL(location.href);
    url.searchParams.delete("q");
    url.searchParams.delete("ambito");
    if (id) url.searchParams.set("chat", id); else url.searchParams.delete("chat");
    window.history.replaceState(null, "", url.pathname + url.search);
  };

  const open = async (id: string) => {
    const c = await loadChat(id);
    if (!c) { remember(null); return; }
    setChatId(c.id);
    setMsgs(c.msgs);
    setScope(c.scope);
    remember(c.id);
    setShowHistory(false);
  };

  // Avvio: domanda dall'indirizzo, conversazione indicata o l'ultima aperta su questo dispositivo.
  useEffect(() => {
    listChats().then(setChats);
    (async () => {
      let old: { msgs?: unknown[]; scope?: string } | null = null;
      try { old = JSON.parse(localStorage.getItem(OLD_STORE) ?? "null"); } catch {}
      if (old?.msgs?.length) {
        const id = await saveChat(null, old.scope ?? "all", migrate(old.msgs));
        try { localStorage.removeItem(OLD_STORE); } catch {}
        listChats().then(setChats);
        if (!initialQuestion && !initialChat) { await open(id); return; }
      }
      if (initialQuestion) {
        if (!started.current) { started.current = true; send(initialQuestion); }
        return;
      }
      let last: string | null = null;
      try { last = localStorage.getItem(CURRENT); } catch {}
      const id = initialChat ?? last;
      if (id) await open(id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Salvataggio sul server quando la conversazione cambia (non durante lo streaming).
  useEffect(() => {
    if (!dirty.current || thinking || !msgs.length) return;
    const t = setTimeout(async () => {
      dirty.current = false;
      const id = await saveChat(chatRef.current, scopeRef.current, msgsRef.current);
      if (id !== chatRef.current) { setChatId(id); remember(id); }
      listChats().then(setChats);
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msgs, thinking]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: thinking ? "auto" : "smooth" });
  }, [msgs, transcribing, thinking]);

  const update = (fn: (all: ChatMsg[]) => ChatMsg[]) => { dirty.current = true; setMsgs(fn); };
  const patchAt = (i: number, patch: Partial<Reply> | ((m: Reply) => Partial<Reply>)) =>
    update((all) => all.map((m, j) => (j === i && m.role === "assistant" ? { ...m, ...(typeof patch === "function" ? patch(m) : patch) } : m)));

  async function send(text: string, voice = false, expert = false) {
    const q = text.trim();
    if (!q || thinking) return;
    setInput("");
    const turns = msgsRef.current.flatMap((x): ChatTurn[] => (x.role === "user" ? [{ role: "user", text: x.text }] : x.role === "assistant" ? [{ role: "assistant", text: replyText(x) }] : []));
    const at = msgsRef.current.length + 1;
    update((m) => [...m, { role: "user", text: q, voice, expert }, { role: "assistant", answer: null, streaming: true, step: 0, tools: [], cards: [], names: {}, cmd: "review", doneCount: 0, scope: "", question: q }]);
    setThinking(true);
    const ctrl = new AbortController();
    abort.current = ctrl;
    let failed = "";
    try {
      const res = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: q, turns, scope: scopeRef.current, focus, expert }), signal: ctrl.signal });
      if (!res.ok || !res.body) throw new Error(res.status === 401 ? "Sessione scaduta: ricarica la pagina e accedi di nuovo." : `Errore ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          const e = JSON.parse(line) as AskEvent;
          if (e.type === "step") patchAt(at, (m) => ({ step: e.step, answer: e.read != null ? { text: "", note: "", sources: [], read: e.read } : m.answer }));
          else if (e.type === "scope") patchAt(at, { scope: e.scope });
          else if (e.type === "delta") patchAt(at, (m) => {
            const a = (m.answer && "text" in m.answer ? m.answer : { text: "", note: "", sources: [], read: 0 }) as ChatAnswer;
            return { answer: { ...a, text: a.text + e.text } };
          });
          else if (e.type === "answer") patchAt(at, { answer: e.answer });
          else if (e.type === "command") patchAt(at, { cards: e.actions.map((a) => ({ ...a, on: true })), names: e.names });
          else if (e.type === "tool") patchAt(at, (m) => ({ tools: [...(m.tools ?? []), e.label], step: 1 }));
          else if (e.type === "reset") patchAt(at, (m) => ({ answer: m.answer && "text" in m.answer ? { ...m.answer, text: "" } : m.answer }));
          else if (e.type === "facts") patchAt(at, { facts: e.facts.map((text): FactCard => ({ text, state: "review" })) });
          else if (e.type === "error") failed = e.error;
        }
      }
    } catch (err) {
      failed = ctrl.signal.aborted ? "Risposta interrotta." : err instanceof Error ? err.message : "Errore di rete.";
    }
    abort.current = null;
    update((all) => {
      const r = all[at];
      if (r?.role !== "assistant") return all;
      const empty = !(r.answer && answerText(r.answer)) && !r.cards.length;
      const next = [...all];
      if (empty && failed) next.splice(at, 1, { role: "error", text: failed });
      else {
        next[at] = { ...r, streaming: false, step: undefined, tools: undefined };
        if (failed) next.splice(at + 1, 0, { role: "error", text: failed });
      }
      return next;
    });
    setThinking(false);
  }

  const confirm = (i: number) => {
    const m = msgs[i];
    if (m?.role !== "assistant") return;
    const chosen = m.cards.filter((c) => c.on).map(({ on: _on, ...a }) => a);
    patchAt(i, { cmd: "saving" });
    runCommand(chosen).then((n) => patchAt(i, { cmd: "done", doneCount: n }));
  };
  const patchCard = (i: number, k: number, patch: Partial<Card>) => patchAt(i, (m) => ({ cards: m.cards.map((c, h) => (h === k ? { ...c, ...patch } : c)) }));

  const reset = () => { mic.release(); abort.current?.abort(); setMsgs([]); setInput(""); setChatId(null); remember(null); setShowHistory(false); };
  const remove = async (id: string) => {
    if (!window.confirm("Eliminare questa conversazione?")) return;
    await deleteChat(id);
    setChats((c) => c.filter((x) => x.id !== id));
    if (id === chatId) reset();
  };

  const busy = thinking || transcribing || mic.recording;
  const last = [...msgs].reverse().find((m): m is Reply => m.role === "assistant" && !!m.answer?.sources.length);

  const scopeOptions: [string, string][] = [
    ["all", "Tutta la memoria"],
    ["recent", "Ultimi 30 giorni"],
    ...scopes.projects.map((p): [string, string] => ["project:" + p.id, "Progetto · " + p.name]),
    ...scopes.people.map((p): [string, string] => ["person:" + p.id, "Persona · " + p.name]),
  ];
  const quick = scopeOptions.filter(([v]) => v === "all" || v === "recent" || v === scope || v.startsWith("project:")).slice(0, 6);
  const changeScope = (v: string) => { setScope(v); if (msgs.length) dirty.current = true; };

  const historyList = (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div className="eyebrow muted" style={{ paddingBottom: 8 }}>Conversazioni</div>
      {chats.length ? chats.map((c) => (
        <div key={c.id} className="chat-item" data-active={c.id === chatId} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", alignItems: "center", gap: 4 }}>
          <button onClick={() => open(c.id)} disabled={busy} style={{ border: 0, background: "none", padding: "7px 0", textAlign: "left", font: "inherit", color: "inherit", cursor: "pointer", minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
            <span className="ellipsis" style={{ fontSize: 14, fontWeight: c.id === chatId ? 600 : 400 }}>{c.title}</span>
            <span className="muted" style={{ fontSize: 12 }}>{relTime(c.updatedAt)}</span>
          </button>
          <button className="btn btn-ghost btn-icon chat-del" onClick={() => remove(c.id)} title="Elimina" aria-label="Elimina conversazione" style={{ height: 28, width: 28 }}><Icon name="x" size={14} /></button>
        </div>
      )) : <span className="muted" style={{ fontSize: 13 }}>Le conversazioni restano salvate e si ritrovano da ogni dispositivo.</span>}
    </div>
  );

  return (
    <div className="stack-mobile" style={{ position: "absolute", inset: 0, display: "grid", gridTemplateColumns: "minmax(0,1fr) 300px" }}>
      <div style={{ display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
        <div ref={scroller} style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          <div className="chat-col" style={{ maxWidth: 760, margin: "0 auto", padding: "40px 32px 24px", display: "flex", flexDirection: "column", gap: 28 }}>
            {!msgs.length && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 48 }}>
                <h1 className="page-title" style={{ margin: 0, fontSize: 40 }}>{name ? `Ciao ${name}, cosa ti serve?` : "Chiedi alla tua memoria"}</h1>
                <p className="muted" style={{ margin: 0, fontSize: 16 }}>
                  Fai domande o chiedi di fare qualcosa, scrivendo o con il microfono. Le risposte citano sempre le fonti; ogni modifica aspetta la tua conferma.
                </p>
                {!enabled && <div className="alert" style={{ marginTop: 12 }}><Icon name="alert" style={{ color: "var(--danger)" }} /><span style={{ flex: 1 }}>IA non configurata.</span><Link href="/impostazioni" className="btn btn-secondary">Impostazioni</Link></div>}
              </div>
            )}

            {msgs.map((m, i) =>
              m.role === "user" ? (
                <div key={i} style={{ alignSelf: "flex-end", maxWidth: "80%", padding: "12px 16px", background: "var(--color-surface)", border: "1px solid var(--color-divider)", fontSize: 16, whiteSpace: "pre-wrap", display: "flex", gap: 8 }}>
                  {m.voice && <span className="muted" title="Dettato" style={{ paddingTop: 3 }}><Icon name="mic" size={14} /></span>}
                  {m.expert && <span className="expert-badge" title="Con il modello più potente">Pensa meglio</span>}
                  <span>{m.text}</span>
                </div>
              ) : m.role === "error" ? (
                <div key={i} className="alert"><Icon name="alert" style={{ color: "var(--danger)" }} /><span style={{ flex: 1 }}>{m.text}</span></div>
              ) : (
                <div key={i} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {m.streaming && !(m.answer && answerText(m.answer)) && <Steps tools={m.tools ?? []} />}
                  {m.answer && answerText(m.answer) && (
                    <AnswerBlock
                      a={m.answer} scope={m.scope} streaming={!!m.streaming}
                      onFollowUp={busy || !enabled ? undefined : (q) => send(q)}
                      onExpert={busy || !enabled || !m.question || ("expert" in m.answer && m.answer.expert) ? undefined : () => send(m.question!, false, true)}
                      question={m.question}
                    />
                  )}
                  {m.facts && m.facts.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {m.facts.map((f, k) => (
                        <div key={k} className="fact-card" data-state={f.state}>
                          <Icon name="ai" size={14} />
                          <span style={{ flex: 1 }}>{f.state === "saved" ? "Ricorderò: " : f.state === "discarded" ? "Non lo ricorderò: " : "Vuoi che ricordi che "}<b style={{ fontWeight: 500 }}>{f.text}</b>{f.state === "review" ? "?" : ""}</span>
                          {f.state === "review" && (
                            <>
                              <button className="btn btn-ghost" onClick={() => patchAt(i, (r) => ({ facts: r.facts!.map((x, h) => (h === k ? { ...x, state: "discarded" } : x)) }))}>No</button>
                              <button className="btn btn-primary" onClick={() => { addFact(f.text, "chat"); patchAt(i, (r) => ({ facts: r.facts!.map((x, h) => (h === k ? { ...x, state: "saved" } : x)) })); }}>Ricorda</button>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {m.cards.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: m.answer ? 8 : 0 }}>
                      <div className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--accent-text)" }}>
                        <Icon name="ai" size={14} />{m.cmd === "done" ? "Azioni eseguite" : m.cmd === "discarded" ? "Azioni annullate" : "Azioni proposte"}
                      </div>
                      {m.cmd === "review" || m.cmd === "saving" ? (
                        <>
                          {m.cards.map((c, k) => <ActionCard key={k} a={c} names={m.names} onChange={(p) => patchCard(i, k, p)} />)}
                          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                            <button className="btn btn-ghost" onClick={() => patchAt(i, { cmd: "discarded" })} disabled={m.cmd === "saving"}>Annulla</button>
                            <button className="btn btn-primary" onClick={() => confirm(i)} disabled={m.cmd === "saving" || !m.cards.some((c) => c.on)}>
                              {m.cmd === "saving" ? "Salvo…" : m.cards.filter((c) => c.on).length === 1 ? "Conferma" : `Conferma ${m.cards.filter((c) => c.on).length} azioni`}
                            </button>
                          </div>
                        </>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 14 }}>
                          {m.cards.filter((c) => m.cmd === "discarded" || c.on).map((c, k) => (
                            <div key={k} style={{ display: "flex", gap: 8, alignItems: "center", color: m.cmd === "done" ? undefined : "var(--muted)", textDecoration: m.cmd === "discarded" ? "line-through" : undefined }}>
                              <Icon name={m.cmd === "done" ? "check" : "x"} size={14} style={{ color: m.cmd === "done" ? "var(--accent-text)" : undefined }} />{c.label}
                            </div>
                          ))}
                          {m.cmd === "done" && m.cards.some((c) => c.on && c.kind === "capture") && (
                            <Link href="/inbox" className="muted" style={{ fontSize: 13 }}>Le catture sono in Inbox, da confermare →</Link>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  {!m.streaming && !(m.answer && answerText(m.answer)) && !m.cards.length && <p className="muted" style={{ margin: 0 }}>Non ho capito cosa fare. Prova a riformulare.</p>}
                </div>
              ),
            )}

            {transcribing && <div className="muted" style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 14 }}><span className="spin" />Trascrivo la registrazione…</div>}
          </div>
        </div>

        <div className="chat-input" style={{ flex: "none", borderTop: "1px solid var(--color-divider)", padding: "16px 32px 20px" }}>
          <div style={{ maxWidth: 760, margin: "0 auto", display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", gap: 8, overflowX: "auto" }}>
              <select className="input only-mobile" value={scope} onChange={(e) => changeScope(e.target.value)} style={{ height: 28, fontSize: 12, width: "auto", flex: "none" }}>
                {scopeOptions.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <button className="suggestion only-mobile" onClick={reset} disabled={busy}>Nuova</button>
              <button className="suggestion only-mobile" onClick={() => setShowHistory(true)}>Cronologia</button>
              {SUGGESTIONS.map((s) => (
                <button key={s} className="suggestion" onClick={() => send(s)} disabled={busy || !enabled}>{s}</button>
              ))}
            </div>
            <Blueprint style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 6px 6px 16px" }}>
              {mic.recording ? (
                <div className="muted" style={{ flex: 1, display: "flex", alignItems: "center", gap: 10, height: 38, fontSize: 15 }}>
                  <span className="rec-dot" />Registrazione in corso…
                </div>
              ) : (
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !busy) send(input); }}
                  placeholder={focus?.startsWith("item:") && !msgs.length ? "Chiedi qualcosa su questo elemento…" : "Chiedi o chiedi di fare qualcosa…"}
                  disabled={!enabled}
                  style={{ flex: 1, minWidth: 0, border: 0, background: "none", color: "var(--color-text)", font: "inherit", fontSize: 16, outline: "none", height: 38 }}
                />
              )}
              {mic.recording ? (
                <>
                  <button className="btn btn-ghost" onClick={mic.release} title="Annulla registrazione">Annulla</button>
                  <button className="btn btn-primary" onClick={mic.stop} style={{ gap: 6 }}><span style={{ width: 10, height: 10, background: "currentColor" }} />Fine</button>
                </>
              ) : thinking ? (
                <button className="btn btn-secondary" onClick={() => abort.current?.abort()} style={{ gap: 6 }}><span style={{ width: 10, height: 10, background: "currentColor" }} />Interrompi</button>
              ) : (
                <>
                  <CommandHelpButton onPick={setInput} />
                  <button className="btn btn-secondary btn-icon" onClick={mic.start} disabled={busy || !enabled} title="Detta" aria-label="Detta"><Icon name="mic" /></button>
                  <button className="btn btn-primary btn-icon" onClick={() => send(input)} disabled={!input.trim() || busy || !enabled} title="Invia" aria-label="Invia"><Icon name="arrowR" /></button>
                </>
              )}
            </Blueprint>
          </div>
        </div>
      </div>

      <aside className="hide-mobile" style={{ borderLeft: "1px solid var(--color-divider)", padding: "28px 24px", display: "flex", flexDirection: "column", gap: 24, overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h4 style={{ margin: 0, fontSize: 19 }}>Contesto</h4>
          <button className="btn btn-ghost" onClick={reset} style={{ gap: 4 }} disabled={busy}><Icon name="plus" />Nuova</button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="eyebrow muted">Ambito delle domande</div>
          {quick.map(([v, l]) => (
            <button key={v} onClick={() => changeScope(v)} className="scope-btn">
              <span style={{ width: 10, height: 10, border: "1px solid var(--color-accent)", background: scope === v ? "var(--color-accent)" : "transparent", flex: "none" }} />
              <span className="ellipsis">{l}</span>
            </button>
          ))}
          <select className="input" value={scopeOptions.some(([v]) => v === scope) ? scope : "all"} onChange={(e) => changeScope(e.target.value)} style={{ height: 32, fontSize: 13 }}>
            {scopeOptions.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        {last?.answer && (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div className="eyebrow muted" style={{ paddingBottom: 8 }}>Fonti dell&apos;ultima risposta</div>
            {last.answer.sources.map((s) => (
              <Link key={s.id} href={`/conoscenza/${s.id}`} className="list-btn" style={{ gridTemplateColumns: "16px minmax(0,1fr)", alignItems: "start", fontSize: 14 }}>
                <span className="muted" style={{ paddingTop: 2 }}><Icon name={itemIcon(s.type as never, s.kind)} /></span>
                <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.35 }}>
                  <span>{s.title}</span>
                  <span className="muted" style={{ fontSize: 12 }}>{s.type ?? "Nota"} · {shortDate(new Date(s.date))}</span>
                </span>
              </Link>
            ))}
          </div>
        )}
        {historyList}
        <div className="muted" style={{ display: "flex", gap: 10, fontSize: 13, lineHeight: 1.5, paddingTop: 16, borderTop: "1px solid var(--color-divider)" }}>
          <span style={{ flex: "none", paddingTop: 2 }}><Icon name="shield" /></span>
          Le domande leggono la memoria entro l&apos;ambito scelto. Le richieste di modifica diventano azioni che esegui solo tu, con Conferma.
        </div>
      </aside>

      {(mic.recording || transcribing) && (
        <VoiceSheet
          analyser={mic.analyser}
          listening={mic.recording}
          seconds={mic.seconds}
          thinkingTitle="Ho capito…"
          thinkingText="Trascrivo la domanda"
          hints={["«Cosa devo fare questa settimana?»", "«Cosa abbiamo deciso sul progetto Alpha?»", "«Ricordami di chiamare Marco venerdì alle 15»", "«Ci sono informazioni in conflitto?»"]}
          onCancel={mic.release}
          onStop={mic.stop}
        />
      )}

      {showHistory && (
        <div className="sb-scrim" onClick={() => setShowHistory(false)} style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "flex-end" }}>
          <div className="sb-bottom-sheet" onClick={(e) => e.stopPropagation()} style={{ borderRadius: "18px 18px 0 0", width: "100%", maxHeight: "75vh", overflowY: "auto", background: "var(--raised)", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h4 style={{ margin: 0, fontSize: 18 }}>Cronologia</h4>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowHistory(false)} aria-label="Chiudi"><Icon name="x" /></button>
            </div>
            {historyList}
          </div>
        </div>
      )}
    </div>
  );
}

/** Passi dell'Assistente mentre lavora: cosa cerca e cosa legge, dal vivo. */
function Steps({ tools }: { tools: string[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--accent-text)" }}><Icon name="ai" size={14} />Sto lavorando</div>
      {tools.map((t, j) => (
        <div key={j} className="agent-step" style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14 }}>
          <Icon name="check" size={14} style={{ color: "var(--accent-text)" }} />{t}
        </div>
      ))}
      <div className="agent-step" style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: "var(--muted)" }}>
        <span className="spin" />{tools.length ? "Continuo…" : "Penso a cosa cercare…"}
      </div>
    </div>
  );
}

/** **grassetto** e citazioni ⟦id⟧ (numeri che portano alla fonte). */
function inline(s: string, cite: (id: string) => ReactNode): ReactNode[] {
  return s.split(/(\*\*[^*]+\*\*|⟦[^⟧]*⟧?)/g).map((part, k) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) return <strong key={k}>{inline(part.slice(2, -2), cite)}</strong>;
    if (part.startsWith("⟦")) return part.endsWith("⟧") ? <Fragment key={k}>{cite(part.slice(1, -1).trim())}</Fragment> : null;
    return <Fragment key={k}>{part}</Fragment>;
  });
}

/** Testo della risposta: paragrafi separati da una riga vuota, elenchi con "- ". */
function Rich({ text, streaming, cite }: { text: string; streaming: boolean; cite: (id: string) => ReactNode }) {
  const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  return (
    <>
      {blocks.map((b, j) => {
        const lines = b.split("\n").map((l) => l.trim()).filter(Boolean);
        const tail = streaming && j === blocks.length - 1 ? <span className="stream-caret" /> : null;
        if (lines.every((l) => /^[-•*]\s+/.test(l))) {
          return (
            <div key={j} style={{ display: "flex", flexDirection: "column", borderLeft: "1px solid var(--color-accent)", paddingLeft: 16, gap: 8 }}>
              {lines.map((l, k) => <div key={k} style={{ fontSize: 16 }}>{inline(l.replace(/^[-•*]\s+/, ""), cite)}{k === lines.length - 1 && tail}</div>)}
            </div>
          );
        }
        return <p key={j} style={{ margin: 0, fontSize: 17, lineHeight: 1.6, textWrap: "pretty" }}>{lines.map((l, k) => <Fragment key={k}>{k > 0 && <br />}{inline(l, cite)}</Fragment>)}{tail}</p>;
      })}
    </>
  );
}

const shortModel = (m?: string) => (m ? m.split("/").pop()!.replace(/-\d{4}$/, "") : "");

function AnswerBlock({ a, scope, streaming, onFollowUp, onExpert, question }: {
  a: ChatAnswer | LegacyAnswer; scope: string; streaming: boolean;
  onFollowUp?: (q: string) => void; onExpert?: () => void; question?: string;
}) {
  const [saved, setSaved] = useState<"no" | "saving" | "yes">("no");
  const [showSteps, setShowSteps] = useState(false);
  const order = a.sources.map((x) => x.id);
  const cite = (id: string) => {
    const n = order.indexOf(id);
    if (n < 0) return streaming ? <sup className="cite cite-pending">·</sup> : null;
    const src = a.sources[n];
    return <Link href={`/conoscenza/${id}`} className="cite" title={src.title}>{n + 1}</Link>;
  };
  const rich = "text" in a;
  const save = () => {
    if (!rich || !question) return;
    setSaved("saving");
    saveAnswer(question, a.text, a.sources).then(() => setSaved("yes"), () => setSaved("no"));
  };
  return (
    <>
      <div className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--accent-text)" }}>
        <Icon name="ai" size={14} />{rich && a.expert ? "Risposta ragionata" : "Risposta"}
      </div>
      {rich ? <Rich text={a.text} streaming={streaming} cite={cite} /> : (
        <>
          {a.paragraphs.map((p, j) => <p key={j} style={{ margin: 0, fontSize: 17, lineHeight: 1.6, textWrap: "pretty" }}>{p}</p>)}
          {a.list.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", borderLeft: "1px solid var(--color-accent)", paddingLeft: 16, gap: 8 }}>
              {a.list.map((l, j) => <div key={j} style={{ fontSize: 16 }}>{l}</div>)}
            </div>
          )}
          {a.after && <p className="muted" style={{ margin: 0, fontSize: 16, lineHeight: 1.6 }}>{a.after}</p>}
        </>
      )}
      {a.note && <div style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, color: "var(--danger)" }}><Icon name="alert" size={14} style={{ marginTop: 3 }} />{a.note}</div>}
      {a.sources.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, paddingTop: 4 }}>
          {a.sources.map((s, n) => (
            <Link key={s.id} href={`/conoscenza/${s.id}`} className="source-chip">
              <span className="cite" style={{ position: "static" }}>{n + 1}</span>
              <Icon name={itemIcon(s.type as never, s.kind)} size={14} />
              <span className="ellipsis" style={{ maxWidth: 260 }}>{s.title}</span>
            </Link>
          ))}
        </div>
      )}
      {!streaming && rich && a.followUps && a.followUps.length > 0 && onFollowUp && (
        <div className="followups">
          {a.followUps.map((q) => <button key={q} className="suggestion" onClick={() => onFollowUp(q)}><Icon name="arrowR" size={12} />{q}</button>)}
        </div>
      )}
      {!streaming && (
        <div className="answer-tools">
          <span className="faint" style={{ fontSize: 12 }}>
            {a.sources.length ? `${a.sources.length} ${a.sources.length === 1 ? "fonte" : "fonti"}` : "Nessuna fonte citata"}
            {rich && a.steps?.length ? <> · <button className="link-btn" onClick={() => setShowSteps((v) => !v)}>{a.steps.length} {a.steps.length === 1 ? "passo" : "passi"}</button></> : ` · ${a.read} elementi letti`}
            {scope && ` · ${scope}`}
            {rich && a.model && ` · ${shortModel(a.model)}`}
            {rich && a.cost != null && a.cost > 0 && ` · ${a.cost < 0.01 ? "<1 cent" : `${(a.cost * 100).toFixed(1)} cent`}`}
          </span>
          <span style={{ flex: 1 }} />
          {onExpert && <button className="btn btn-ghost" onClick={onExpert} title="Rifà la domanda con il modello più potente" style={{ height: 28, gap: 5, fontSize: 12 }}><Icon name="ai" size={13} />Pensa meglio</button>}
          {rich && question && (
            saved === "yes"
              ? <Link href="/inbox" className="btn btn-ghost" style={{ height: 28, gap: 5, fontSize: 12, color: "var(--accent-text)" }}><Icon name="check" size={13} />In Inbox</Link>
              : <button className="btn btn-ghost" onClick={save} disabled={saved === "saving"} title="Salva la risposta in Inbox, da confermare" style={{ height: 28, gap: 5, fontSize: 12 }}><Icon name="inbox" size={13} />{saved === "saving" ? "Salvo…" : "Salva in memoria"}</button>
          )}
        </div>
      )}
      {showSteps && rich && a.steps && (
        <div className="steps-done">
          {a.steps.map((t, j) => <div key={j}><Icon name="check" size={12} />{t}</div>)}
        </div>
      )}
    </>
  );
}
