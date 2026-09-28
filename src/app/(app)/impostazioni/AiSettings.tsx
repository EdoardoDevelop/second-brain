"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import { Icon } from "@/components/ui";
import { SetCard } from "./SettingsShell";
import {
  aiOverview, compareRun, listEmbeddingModels, listModels, reindexNow, saveAiSettings, testAiKey,
  type AiOverview, type CompareResult, type KeyStatus, type ModelInfo,
} from "@/lib/actions";

type Tier = "fast" | "files" | "smart" | "expert" | "embed";
type Models = Record<Tier, string>;
type Privacy = "zdr" | "deny" | "allow";

const usd = (v: number) => (Math.abs(v) < 0.01 && v !== 0 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`);

/** Saldo del conto OpenRouter, consumo della chiave e limiti, letti all'apertura delle Impostazioni. */
function CreditBox({ status, loading, onRefresh }: { status: KeyStatus | null; loading: boolean; onRefresh: () => void }) {
  if (status && !status.ok) {
    return <div className="alert" style={{ marginBottom: 14 }}><Icon name="alert" style={{ color: "var(--danger)" }} /><span style={{ flex: 1 }}>Chiave non valida: {status.error}</span><button className="btn btn-ghost" onClick={onRefresh}>Riprova</button></div>;
  }
  const s = status?.ok ? status : null;
  // Saldo: quello del conto; se non disponibile, il residuo del limite della chiave.
  const balance = s?.credits?.balance ?? s?.remaining ?? null;
  const total = s?.credits?.total ?? s?.limit ?? null;
  const low = balance != null && balance < 1;
  const pct = balance != null && total ? Math.max(0, Math.min(100, (balance / total) * 100)) : null;
  return (
    <div className="credit-box" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10, background: "var(--raised)", border: "1px solid var(--color-divider)" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 180 }}>
          <span className="eyebrow muted">Credito residuo OpenRouter</span>
          <span style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 34, lineHeight: 1.1, color: low ? "var(--danger)" : undefined }}>
            {s ? (balance != null ? usd(balance) : "Senza limite") : "…"}
          </span>
          {s && (
            <span className="muted" style={{ fontSize: 12 }}>
              {s.credits ? `Acquistati ${usd(s.credits.total)} · spesi ${usd(s.credits.used)}` : s.limit != null ? `Limite della chiave ${usd(s.limit)}` : "Nessun limite di spesa sulla chiave"}
              {s.freeTier ? " · account gratuito" : ""}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <a className="btn btn-secondary" href="https://openrouter.ai/settings/credits" target="_blank" rel="noreferrer" style={{ gap: 6 }}>Ricarica<Icon name="arrowUR" size={14} /></a>
          <button className="btn btn-ghost btn-icon" onClick={onRefresh} disabled={loading} title="Aggiorna" aria-label="Aggiorna il credito"><Icon name="refresh" size={16} /></button>
        </div>
      </div>
      {pct != null && (
        <div style={{ height: 6, background: "var(--skel)", borderRadius: 3, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${pct}%`, background: low ? "var(--danger)" : "var(--color-accent)", transition: "width .5s var(--ease-emph)" }} />
        </div>
      )}
      {s && (
        <div className="muted" style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12 }}>
          <span>Speso da questa chiave: <b style={{ color: "var(--color-text)", fontWeight: 500 }}>{usd(s.usage)}</b></span>
          {s.daily != null && <span>Oggi {usd(s.daily)}</span>}
          {s.weekly != null && <span>Settimana {usd(s.weekly)}</span>}
          {s.monthly != null && <span>Mese {usd(s.monthly)}</span>}
          {s.label && <span>Chiave «{s.label}»</span>}
        </div>
      )}
      {low && <div style={{ fontSize: 13, color: "var(--danger)" }}>Il credito sta finendo: quando si esaurisce, classificazione, Assistente e comandi smettono di funzionare.</div>}
    </div>
  );
}

function Row({ title, desc, children }: { title: ReactNode; desc: ReactNode; children?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "14px 0", borderTop: "1px solid var(--color-divider)", flexWrap: "wrap" }}>
      <div style={{ minWidth: 0, flex: "1 1 260px" }}><div style={{ fontSize: 15 }}>{title}</div><div className="muted" style={{ fontSize: 13 }}>{desc}</div></div>
      {children}
    </div>
  );
}

const price = (n: number) => (n === 0 ? "gratis" : n < 0.1 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`);
const eur = (v: number) => (v < 0.01 && v > 0 ? "< €0,01" : `€${v.toFixed(2).replace(".", ",")}`);

const TIERS: { id: Tier; title: string; desc: string; need?: "audio" | "tools" }[] = [
  { id: "smart", title: "Ragionamento", desc: "Assistente, comandi, sintesi, riepilogo del mattino, suggerimenti. È il modello che fa la differenza.", need: "tools" },
  { id: "fast", title: "Veloce", desc: "Lavori di routine: classificazione delle catture, notizie. Economico." },
  { id: "files", title: "File e audio", desc: "Lettura di foto, PDF e registrazioni, trascrizioni. Deve accettare l'audio.", need: "audio" },
  { id: "expert", title: "Pensa meglio", desc: "Solo quando lo chiedi, sulla singola domanda difficile. Il più potente.", need: "tools" },
  { id: "embed", title: "Ricerca per significato", desc: "Impronte dei testi per trovare anche con parole diverse. Costa pochissimo." },
];

const PRIVACY: [Privacy, string, string][] = [
  ["zdr", "Massima", "Solo fornitori a conservazione zero (ZDR): nulla resta sui loro server. Alcuni modelli potrebbero non essere disponibili."],
  ["deny", "Privata", "Esclusi i fornitori che conservano i dati per addestrare i modelli o li usano per altro."],
  ["allow", "Tutti", "Ammessi anche i fornitori che possono conservare o usare i dati (serve per molti modelli gratuiti)."],
];

const TASK_LABEL: Record<string, string> = {
  assistente: "Assistente", comando: "Comandi", proposta: "Classificazione", lettura_file: "Lettura file", trascrizione: "Trascrizioni",
  sintesi: "Sintesi progetti e persone", azione: "Azioni sugli elementi", riepilogo_mattino: "Riepilogo del mattino", suggerimenti: "Suggerimenti",
  argomenti_notizie: "Notizie · argomenti", notizie_per_te: "Notizie · scelta", indicizzazione: "Indice per significato", ricerca: "Ricerca per significato",
  confronto: "Confronto modelli", risposta: "Risposte",
};

export function AiSettings(props: { keyMasked: string | null; keySource: "app" | "env" | null; models: Models; defaults: Models; privacy: Privacy; budgetEur: number }) {
  const [newKey, setNewKey] = useState("");
  const [keyFocus, setKeyFocus] = useState(false);
  const [models, setModels] = useState<Models>(props.models);
  const [privacy, setPrivacy] = useState<Privacy>(props.privacy);
  const [budget, setBudget] = useState(String(props.budgetEur).replace(".", ","));
  const [status, setStatus] = useState<KeyStatus | null>(null);
  const [over, setOver] = useState<AiOverview | null>(null);
  const [list, setList] = useState<ModelInfo[] | null>(null);
  const [embList, setEmbList] = useState<ModelInfo[] | null>(null);
  const [picking, setPicking] = useState<Tier | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  useEffect(() => {
    listModels().then((r) => setList("error" in r ? [] : r));
    listEmbeddingModels().then((r) => setEmbList("error" in r ? [] : r));
    aiOverview().then(setOver);
    if (props.keyMasked) testAiKey().then(setStatus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const budgetNum = Math.max(0, Number(budget.replace(",", ".")) || 0);
  const dirty = newKey.trim() !== "" || privacy !== props.privacy || budgetNum !== props.budgetEur || (Object.keys(models) as Tier[]).some((k) => models[k] !== props.models[k]);
  const info = (id: string, tier: Tier) => (tier === "embed" ? embList : list)?.find((m) => m.id === id);

  const save = (apiKey?: string) => start(async () => {
    await saveAiSettings({ apiKey, models, privacy, budgetEur: budgetNum });
    setNewKey("");
    setStatus(null);
    setSaved(true);
    aiOverview().then(setOver);
    setTimeout(() => setSaved(false), 2500);
  });

  return (
    <>
      <SetCard title="Account OpenRouter" icon="wallet" desc="La chiave con cui l'app usa i modelli, e il credito residuo del conto.">
        <Row
          title="Chiave API"
          desc={props.keyMasked
            ? <>In uso <code>{props.keyMasked}</code> · {props.keySource === "app" ? "salvata qui" : "dal file .env del server"}</>
            : "Nessuna chiave: le catture arrivano senza classificazione e l'Assistente è spento."}
        >
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn btn-secondary" disabled={!props.keyMasked || pending} onClick={() => start(async () => setStatus(await testAiKey()))}>Verifica</button>
            {props.keySource === "app" && <button className="btn btn-ghost" disabled={pending} onClick={() => { if (confirm("Rimuovere la chiave salvata? Si tornerà a quella del .env, se presente.")) save(""); }}>Rimuovi</button>}
          </div>
        </Row>
        {props.keyMasked && <CreditBox status={status} loading={pending || (!status && !!props.keyMasked)} onRefresh={() => start(async () => setStatus(await testAiKey()))} />}
        {/* Il browser ignora autoComplete="off" sui campi password e ci incolla la password dell'app, che risulterebbe
            una modifica non salvata: "new-password" e sola lettura fino al primo tocco impediscono l'autocompilazione. */}
        <input className="input" type="password" name="openrouter-key" autoComplete="new-password" data-1p-ignore data-lpignore="true" readOnly={!keyFocus} onFocus={() => setKeyFocus(true)} spellCheck={false} value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder={props.keyMasked ? "Sostituisci con una nuova chiave (sk-or-…)" : "Incolla la chiave OpenRouter (sk-or-…)"} />
      </SetCard>

      <SetCard title="Spesa del mese" icon="wallet" desc="Quanto costa l'IA questo mese e il tetto che non vuoi superare.">
        <SpendBox over={over} budget={budget} setBudget={setBudget} budgetNum={budgetNum} />
      </SetCard>

      <SetCard title="Privacy" icon="shield" desc={PRIVACY.find(([k]) => k === privacy)![2]}>
        <div className="seg-sb" style={{ alignSelf: "flex-start" }}>
          {PRIVACY.map(([k, label]) => <button key={k} aria-pressed={privacy === k} onClick={() => setPrivacy(k)} style={{ height: 34, padding: "0 16px" }}>{label}</button>)}
        </div>
      </SetCard>

      <SetCard title="Modelli per compito" icon="ai" desc="Ogni lavoro usa il modello adatto: economici per la routine, uno forte per ragionare. Prezzi in dollari per milione di token (ingresso / uscita).">
        {over?.warning && (
          <div className="alert">
            <Icon name="alert" style={{ color: "var(--danger)" }} />
            <span style={{ flex: 1, fontSize: 13 }}>
              Il modello <code>{over.warning.model}</code> non è disponibile con queste impostazioni ({over.warning.message.replace(/^OpenRouter: /, "")}): per ora uso il modello veloce. Scegline un altro o usa «Confronta modelli».
            </span>
          </div>
        )}
        <div className="tier-list">
          {TIERS.map((t) => {
            const m = info(models[t.id], t.id);
            const warn = m && t.need === "audio" && !m.audio ? "non accetta audio" : m && t.need === "tools" && !m.tools ? "non usa strumenti: l'Assistente non potrà cercare" : "";
            return (
              <div key={t.id} className="tier-row" data-open={picking === t.id || undefined}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 14, fontWeight: 500 }}>{t.title}</span>
                    <code className="ellipsis" style={{ fontSize: 12, maxWidth: "100%" }}>{models[t.id]}</code>
                    {m && <span className="muted" style={{ fontSize: 12 }}>{t.id === "embed" ? price(m.input) : `${price(m.input)} / ${price(m.output)}`}</span>}
                    {warn && <span style={{ fontSize: 12, color: "var(--danger)" }}>· {warn}</span>}
                  </div>
                  <div className="muted" style={{ fontSize: 12.5 }}>{t.desc}</div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  {models[t.id] !== props.defaults[t.id] && <button className="btn btn-ghost" onClick={() => setModels({ ...models, [t.id]: props.defaults[t.id] })} style={{ height: 30, fontSize: 12 }}>Predefinito</button>}
                  <button className="btn btn-secondary" onClick={() => setPicking(picking === t.id ? null : t.id)} style={{ height: 30 }}>{picking === t.id ? "Chiudi" : "Cambia"}</button>
                </div>
                {picking === t.id && (
                  <ModelPicker
                    list={t.id === "embed" ? embList : list}
                    value={models[t.id]}
                    need={t.need}
                    onPick={(id) => { setModels({ ...models, [t.id]: id }); setPicking(null); }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </SetCard>

      <SetCard title="Ricerca per significato" icon="search" desc="Trova i contenuti anche con parole diverse. L'indice si aggiorna da solo ogni 10 minuti.">
        <IndexBox over={over} onDone={() => aiOverview().then(setOver)} />
      </SetCard>

      <SetCard title="Confronta modelli" icon="graph" desc="Le stesse domande sulla tua memoria a più modelli: risposte, tempi e costi affiancati. Solo lettura: le azioni proposte non si eseguono. Costo tipico: pochi centesimi.">
        <ModelCompare list={list} current={props.models.smart} onUse={(id) => setModels((m) => ({ ...m, smart: id }))} />
      </SetCard>

      {(dirty || saved) && (
        <div className="save-bar" role="status">
          <span style={{ flex: 1, fontSize: 14 }}>{saved ? "Impostazioni IA salvate." : "Hai modifiche non salvate nelle impostazioni dell'IA."}</span>
          {!saved && <button className="btn btn-ghost" disabled={pending} onClick={() => { setModels(props.models); setPrivacy(props.privacy); setBudget(String(props.budgetEur).replace(".", ",")); setNewKey(""); }}>Annulla</button>}
          {!saved && <button className="btn btn-primary" disabled={pending} onClick={() => save(newKey.trim() || undefined)}>{pending ? "Salvo…" : "Salva"}</button>}
        </div>
      )}
    </>
  );
}

function SpendBox({ over, budget, setBudget, budgetNum }: { over: AiOverview | null; budget: string; setBudget: (v: string) => void; budgetNum: number }) {
  const [details, setDetails] = useState(false);
  const spent = over?.spentEur ?? 0;
  const ratio = budgetNum > 0 ? Math.min(1, spent / budgetNum) : 0;
  const tone = ratio >= 1 ? "var(--danger)" : ratio >= 0.8 ? "#d98a1c" : "var(--color-accent)";
  return (
    <div className="spend" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 180 }}>
          <span className="eyebrow muted">Speso questo mese</span>
          <span style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 30, lineHeight: 1.1 }}>
            {over ? eur(spent) : "…"} <span className="muted" style={{ fontSize: 16, fontWeight: 400 }}>{budgetNum > 0 ? `su ${eur(budgetNum)}` : "· nessun tetto"}</span>
          </span>
          {over && <span className="muted" style={{ fontSize: 12 }}>{over.calls} chiamate · cambio indicativo $→€</span>}
        </div>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
          <span className="muted">Tetto mensile (€, 0 = nessuno)</span>
          <input className="input" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value.replace(/[^\d,.]/g, ""))} style={{ width: 110 }} />
        </label>
      </div>
      {budgetNum > 0 && (
        <div style={{ height: 6, background: "var(--skel)", borderRadius: 3, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${ratio * 100}%`, background: tone, transition: "width .6s var(--ease-emph)" }} />
        </div>
      )}
      <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
        Vicino al tetto (80%) l&apos;IA smette di proporre suggerimenti; oltre il tetto il ragionamento passa al modello veloce e «Pensa meglio» si ferma fino al mese dopo. Per un blocco sicuro puoi mettere un limite anche sulla chiave in OpenRouter.
      </div>
      {over && over.byTask.length > 0 && (
        <>
          <button className="link-btn muted" onClick={() => setDetails((d) => !d)} style={{ alignSelf: "flex-start", fontSize: 12.5 }}>{details ? "Nascondi il dettaglio" : "Dettaglio per compito e modello"}</button>
          {details && (
            <div className="spend-grid">
              <div>
                {over.byTask.map((t) => <div key={t.task} className="spend-line"><span>{TASK_LABEL[t.task] ?? t.task}</span><span className="muted">{t.calls}×</span><span>{eur(t.eur)}</span></div>)}
              </div>
              <div>
                {over.byModel.map((t) => <div key={t.model} className="spend-line"><code className="ellipsis">{t.model}</code><span className="muted">{t.calls}×</span><span>{eur(t.eur)}</span></div>)}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ModelPicker({ list, value, need, onPick }: { list: ModelInfo[] | null; value: string; need?: "audio" | "tools"; onPick: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [custom, setCustom] = useState("");
  const needle = q.trim().toLowerCase();
  const visible = (list ?? []).filter((m) => !needle || m.id.toLowerCase().includes(needle) || m.name.toLowerCase().includes(needle)).slice(0, 200);
  return (
    <div className="picker">
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <div style={{ position: "relative", display: "flex", alignItems: "center", flex: "1 1 220px" }}>
          <span className="muted" style={{ position: "absolute", left: 10 }}><Icon name="search" /></span>
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca (claude, deepseek, kimi, gemini…)" style={{ paddingLeft: 34 }} autoFocus />
        </div>
        <input className="input" value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && custom.trim()) onPick(custom.trim()); }} placeholder="…o scrivi l'id" style={{ flex: "0 1 200px" }} />
      </div>
      <div style={{ maxHeight: 280, overflowY: "auto", border: "1px solid var(--color-divider)" }}>
        {!list ? <div className="muted" style={{ padding: 14, fontSize: 14, display: "flex", gap: 10, alignItems: "center" }}><span className="spin" />Carico i modelli…</div>
          : !visible.length ? <div className="muted" style={{ padding: 14, fontSize: 14 }}>Nessun modello.</div>
          : visible.map((m) => {
            const off = (need === "audio" && !m.audio) || (need === "tools" && !m.tools);
            return (
              <button key={m.id} onClick={() => onPick(m.id)} className="row-hover" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 12, width: "100%", padding: "8px 12px", border: 0, borderTop: "1px solid var(--color-divider)", background: m.id === value ? "var(--sel)" : "none", color: "inherit", font: "inherit", textAlign: "left", cursor: "pointer", opacity: off ? 0.5 : 1 }}>
                <span style={{ display: "flex", flexDirection: "column", minWidth: 0, lineHeight: 1.35 }}>
                  <span className="ellipsis" style={{ fontSize: 14 }}>{m.name}</span>
                  <span className="muted ellipsis" style={{ fontSize: 12 }}>{m.id}</span>
                </span>
                <span className="muted" style={{ fontSize: 12, textAlign: "right", whiteSpace: "nowrap" }}>
                  {m.free ? <span style={{ color: "var(--accent-text)" }}>gratis</span> : m.output ? `${price(m.input)} / ${price(m.output)}` : price(m.input)}
                  <br />{[m.tools && "strumenti", m.audio && "audio", `${Math.round(m.context / 1000)}k`].filter(Boolean).join(" · ")}
                </span>
              </button>
            );
          })}
      </div>
    </div>
  );
}

function IndexBox({ over, onDone }: { over: AiOverview | null; onDone: () => void }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const e = over?.embed;
  return (
    <Row
      title="Indice per significato"
      desc={
        msg ?? (!e ? "Si costruisce da solo nei prossimi minuti (ogni 10 minuti aggiunge gli elementi nuovi)."
          : e.error ? <span style={{ color: "var(--danger)" }}>Non disponibile: {e.error}. La ricerca usa solo le parole.</span>
          : <>{e.done} di {e.total} elementi indicizzati con <code>{e.model}</code>.</>)
      }
    >
      <button className="btn btn-secondary" disabled={pending} onClick={() => start(async () => {
        const r = await reindexNow();
        setMsg("error" in r ? `Errore: ${r.error}` : r.done ? `Aggiornati ${r.done} elementi.` : "L'indice è già aggiornato.");
        onDone();
      })} style={{ gap: 6 }}>{pending ? <span className="spin" /> : <Icon name="refresh" size={14} />}Aggiorna indice</button>
    </Row>
  );
}

const QUESTIONS = [
  "Cosa devo fare questa settimana e cosa è più urgente?",
  "Riassumi le decisioni più recenti e perché sono state prese",
  "Quali progetti sono fermi e cosa servirebbe per sbloccarli?",
  "Con chi lavoro di più e su cosa?",
  "Ci sono informazioni in conflitto nella memoria?",
];
const CANDIDATES = ["deepseek/deepseek-v4-pro", "moonshotai/kimi-k2.6", "anthropic/claude-haiku-4.5"];

/** Confronto modelli sulla memoria vera: stesse domande, risposte affiancate con tempi e costi. Solo lettura. */
function ModelCompare({ list, current, onUse }: { list: ModelInfo[] | null; current: string; onUse: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<string[]>(() => [current, ...CANDIDATES.filter((c) => c !== current)].slice(0, 3));
  const [questions, setQuestions] = useState(QUESTIONS.join("\n"));
  const [results, setResults] = useState<Record<string, CompareResult | "run">>({});
  const [running, setRunning] = useState(false);
  const qs = questions.split("\n").map((q) => q.trim()).filter(Boolean).slice(0, 10);
  const ms = models.map((m) => m.trim()).filter(Boolean);
  const key = (m: string, q: string) => `${m}\n${q}`;

  const run = async () => {
    setRunning(true);
    setResults({});
    // Un modello per colonna in parallelo; dentro la colonna, una domanda alla volta.
    await Promise.all(ms.map(async (m) => {
      for (const q of qs) {
        setResults((r) => ({ ...r, [key(m, q)]: "run" }));
        const res = await compareRun(m, q);
        setResults((r) => ({ ...r, [key(m, q)]: res }));
      }
    }));
    setRunning(false);
  };

  const total = (m: string) => {
    const rs = qs.map((q) => results[key(m, q)]).filter((x): x is CompareResult => !!x && x !== "run");
    return { cost: rs.reduce((t, r) => t + r.cost, 0), ms: rs.length ? rs.reduce((t, r) => t + r.ms, 0) / rs.length : 0, errors: rs.filter((r) => r.error).length, n: rs.length };
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <button className="btn btn-secondary" onClick={() => setOpen((o) => !o)} style={{ alignSelf: "flex-start", gap: 6 }}><Icon name="graph" size={14} />{open ? "Chiudi il confronto" : "Apri il confronto"}</button>
      {open && (
        <>
          <datalist id="sb-models">{(list ?? []).filter((m) => m.tools).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</datalist>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8 }}>
            {[0, 1, 2].map((i) => (
              <label key={i} style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                <span className="muted">Modello {i + 1}</span>
                <input className="input" list="sb-models" value={models[i] ?? ""} onChange={(e) => setModels((m) => { const n = [...m]; n[i] = e.target.value; return n; })} placeholder="id del modello" />
              </label>
            ))}
          </div>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
            <span className="muted">Domande (una per riga, massimo 10)</span>
            <textarea className="input" value={questions} onChange={(e) => setQuestions(e.target.value)} rows={5} style={{ fontSize: 14, lineHeight: 1.5 }} />
          </label>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button className="btn btn-primary" onClick={run} disabled={running || !ms.length || !qs.length} style={{ gap: 6 }}>
              {running ? <><span className="spin" />Confronto in corso…</> : <><Icon name="ai" size={14} />Avvia ({ms.length} × {qs.length})</>}
            </button>
          </div>
          {Object.keys(results).length > 0 && (
            <div className="compare" style={{ gridTemplateColumns: `repeat(${ms.length}, minmax(240px, 1fr))` }}>
              {ms.map((m) => {
                const t = total(m);
                return (
                  <div key={m} className="compare-head">
                    <code className="ellipsis">{m}</code>
                    <span className="muted" style={{ fontSize: 12 }}>{t.n ? `${eur(t.cost)} · ${(t.ms / 1000).toFixed(1)} s in media${t.errors ? ` · ${t.errors} errori` : ""}` : "…"}</span>
                    {!running && t.n > 0 && !t.errors && m !== current && <button className="btn btn-secondary" onClick={() => onUse(m)} style={{ height: 28, fontSize: 12, alignSelf: "flex-start" }}>Usa per il ragionamento</button>}
                    {m === current && <span style={{ fontSize: 12, color: "var(--accent-text)" }}>In uso</span>}
                  </div>
                );
              })}
              {qs.map((q) => (
                <div key={q} style={{ display: "contents" }}>
                  <div className="compare-q" style={{ gridColumn: `1 / span ${ms.length}` }}>{q}</div>
                  {ms.map((m) => {
                    const r = results[key(m, q)];
                    return (
                      <div key={m} className="compare-cell">
                        {!r ? <span className="faint">In coda</span>
                          : r === "run" ? <span className="muted" style={{ display: "flex", gap: 8, alignItems: "center" }}><span className="spin" />Sta lavorando…</span>
                          : r.error ? <span style={{ color: "var(--danger)", fontSize: 13 }}>{r.error}</span>
                          : (
                            <>
                              <div className="compare-text">{r.text || "—"}</div>
                              <div className="faint" style={{ fontSize: 11.5 }}>{(r.ms / 1000).toFixed(1)} s · {eur(r.cost)} · {r.steps.length} passi · {r.sources.length} fonti</div>
                            </>
                          )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
