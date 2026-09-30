"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Icon } from "@/components/ui";
import { captureNews, hideNews, refreshNews, saveNewsConfig } from "@/lib/actions";
import { relTime } from "@/lib/format";
import { isExcluded, type Article, type CapturedMap, type NewsConfig, type NewsFeed } from "@/lib/news";

const FOR_YOU = "__per_te";
const ALL = "__tutte";

/** "3 h fa" per le ultime 24 ore, poi la data. */
function ago(ms: number) {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 60) return `${Math.max(1, m)} min fa`;
  if (m < 24 * 60) return `${Math.round(m / 60)} h fa`;
  return relTime(new Date(ms));
}

/**
 * Riquadro Notizie della Home: schede "Per te" (scelte dall'IA in base alla memoria), "Tutte" e una per argomento.
 * Ogni notizia si apre, si cattura in Inbox (poi si conferma come ogni cattura) o si nasconde.
 */
export function NewsWidget({ config, feed, hidden, captured, aiOn }: { config: NewsConfig; feed: NewsFeed | null; hidden: string[]; captured: CapturedMap; aiOn: boolean }) {
  const [cfg, setCfg] = useState(config);
  const [editing, setEditing] = useState(!config.topics.length && !(config.auto && aiOn));
  const [refreshing, startRefresh] = useTransition();
  const [gone, setGone] = useState<Set<string>>(new Set());
  useEffect(() => setCfg(config), [config]);

  const forYouOn = cfg.auto && aiOn && !!feed?.forYou.length;
  const tabs = useMemo(() => {
    const t: { id: string; label: string; auto?: boolean }[] = [];
    if (forYouOn) t.push({ id: FOR_YOU, label: "Per te" });
    t.push({ id: ALL, label: "Tutte" });
    for (const x of cfg.topics) t.push({ id: x, label: x });
    for (const a of feed?.autoTopics ?? []) if (!cfg.topics.some((x) => x.toLowerCase() === a.label.toLowerCase()) && !isExcluded(`${a.label} ${a.query}`, cfg.excluded)) t.push({ id: a.label, label: a.label, auto: true });
    return t;
  }, [forYouOn, cfg.topics, cfg.excluded, feed?.autoTopics]);
  const [tab, setTab] = useState(tabs[0]?.id ?? ALL);
  const current = tabs.some((t) => t.id === tab) ? tab : tabs[0]?.id ?? ALL;

  const hiddenSet = new Set([...hidden, ...gone]);
  const byId = new Map(feed?.articles.map((a) => [a.id, a]) ?? []);
  const list = (current === FOR_YOU
    ? feed!.forYou.map((id) => byId.get(id)).filter((a): a is Article => !!a)
    : (feed?.articles ?? []).filter((a) => current === ALL || a.topic === current)
  ).filter((a) => !hiddenSet.has(a.id) && !isExcluded(a.title, cfg.excluded)).slice(0, cfg.count);

  const refresh = (newTopics = false) => startRefresh(() => refreshNews(newTopics));
  const updated = feed ? new Intl.DateTimeFormat("it-IT", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" }).format(new Date(feed.at)) : null;

  return (
    <div className="nw" data-busy={refreshing || undefined}>
      <div className="nw-top">
        {!editing && (
          <div className="nw-tabs" role="tablist">
            {tabs.map((t) => (
              <button key={t.id} role="tab" aria-selected={current === t.id} className="nw-tab" onClick={() => setTab(t.id)} title={t.auto ? "Argomento scelto dall'IA in base alla tua memoria" : undefined}>
                {(t.id === FOR_YOU || t.auto) && <Icon name="ai" size={12} />}{t.label}
              </button>
            ))}
          </div>
        )}
        <span style={{ flex: 1 }} />
        {!editing && (
          <button className="btn btn-ghost btn-icon" onClick={() => refresh()} disabled={refreshing} aria-label="Aggiorna le notizie" title="Aggiorna" style={{ height: 30, width: 30, color: "var(--muted)" }}>
            <span className="nw-spin" style={{ display: "flex" }}><Icon name="refresh" size={15} /></span>
          </button>
        )}
        <button className="btn btn-ghost btn-icon" onClick={() => setEditing((e) => !e)} aria-label="Impostazioni delle notizie" aria-expanded={editing} title="Impostazioni" style={{ height: 30, width: 30, color: editing ? "var(--accent-text)" : "var(--muted)" }}>
          <Icon name={editing ? "x" : "settings"} size={15} />
        </button>
      </div>

      {editing ? (
        <Settings cfg={cfg} setCfg={setCfg} feed={feed} aiOn={aiOn} refreshing={refreshing} regenerate={() => refresh(true)} onDone={() => setEditing(false)} />
      ) : !feed ? (
        <div className="muted" style={{ fontSize: 14, padding: "12px 0" }}>Notizie non disponibili in questo momento.</div>
      ) : !list.length ? (
        <div className="muted" style={{ fontSize: 14, padding: "12px 0" }}>
          {feed.articles.length ? "Nessuna notizia in questa scheda." : "Nessuna notizia trovata negli ultimi 7 giorni. Prova ad aggiungere altri argomenti."}
        </div>
      ) : (
        <div className="nw-list" key={current}>
          {list.map((a, k) => (
            <Row key={a.id} a={a} k={k} showTopic={current === FOR_YOU || current === ALL} reason={current === FOR_YOU || !!a.reason} capturedId={captured[a.id]} onHide={() => { setGone((g) => new Set(g).add(a.id)); hideNews(a.id); }} />
          ))}
        </div>
      )}

      {!editing && feed && (
        <div className="faint nw-foot">
          <span>Aggiornate alle {updated} · Google News</span>
          {feed.aiError && cfg.auto && aiOn && <span title={feed.aiError} style={{ color: "var(--danger)" }}>· scelta con l&apos;IA non riuscita</span>}
        </div>
      )}
    </div>
  );
}

function Row({ a, k, showTopic, reason, capturedId, onHide }: { a: Article; k: number; showTopic: boolean; reason: boolean; capturedId?: string; onHide: () => void }) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState(!!capturedId);
  const [leaving, setLeaving] = useState(false);
  const capture = () => start(async () => { await captureNews({ id: a.id, title: a.title, source: a.source, url: a.url, published: a.published, topic: a.topic, reason: a.reason }); setDone(true); });
  return (
    <article className="nw-row" data-leaving={leaving || undefined} style={{ animationDelay: `${k * 45}ms` }} onAnimationEnd={(e) => { if (leaving && e.animationName === "nwOut") onHide(); }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
        <a href={a.url} target="_blank" rel="noreferrer" className="nw-title">{a.title}</a>
        <div className="muted nw-meta">
          {a.source && <span className="ellipsis" style={{ maxWidth: 180 }}>{a.source}</span>}
          <span>{ago(a.published)}</span>
          {showTopic && <span className="nw-topic">{a.auto && <Icon name="ai" size={10} />}{a.topic}</span>}
        </div>
        {reason && a.reason && <div className="nw-reason"><Icon name="ai" size={12} /><span>{a.reason}</span></div>}
      </div>
      <div className="nw-actions">
        {done ? (
          <Link href="/inbox" className="nw-done" title="Catturata: la trovi in Inbox per la conferma"><Icon name="check" size={14} />In Inbox</Link>
        ) : (
          <button className="btn btn-secondary nw-capture" onClick={capture} disabled={pending} title="Cattura in Inbox">
            <Icon name={pending ? "refresh" : "inbox"} size={14} />{pending ? "…" : "Cattura"}
          </button>
        )}
        <button className="btn btn-ghost btn-icon nw-hide" onClick={() => (matchMedia("(prefers-reduced-motion: reduce)").matches ? onHide() : setLeaving(true))} aria-label="Non mi interessa" title="Non mi interessa"><Icon name="eyeOff" size={14} /></button>
      </div>
    </article>
  );
}

function Settings({ cfg, setCfg, feed, aiOn, refreshing, regenerate, onDone }: {
  cfg: NewsConfig; setCfg: (c: NewsConfig) => void; feed: NewsFeed | null; aiOn: boolean; refreshing: boolean; regenerate: () => void; onDone: () => void;
}) {
  const [text, setText] = useState("");
  const [noText, setNoText] = useState("");
  const [pending, start] = useTransition();
  const save = (next: NewsConfig) => { setCfg(next); start(() => saveNewsConfig(next)); };
  const exclude = (raw: string) => {
    const v = raw.replace(/s+/g, " ").trim();
    setNoText("");
    if (!v || cfg.excluded.some((t) => t.toLowerCase() === v.toLowerCase()) || cfg.excluded.length >= 20) return;
    // Un argomento escluso non resta tra quelli seguiti.
    save({ ...cfg, excluded: [...cfg.excluded, v], topics: cfg.topics.filter((t) => t.toLowerCase() !== v.toLowerCase()) });
  };
  const add = () => {
    const v = text.replace(/\s+/g, " ").trim();
    if (!v || cfg.topics.some((t) => t.toLowerCase() === v.toLowerCase()) || cfg.topics.length >= 12) return setText("");
    setText("");
    save({ ...cfg, topics: [...cfg.topics, v] });
  };
  const seg = <T extends number>(value: T, options: T[], set: (v: T) => void) => (
    <div className="seg-sb">{options.map((v) => <button key={v} aria-pressed={value === v} onClick={() => set(v)} style={{ height: 30, padding: "0 12px", fontSize: 12 }}>{v}</button>)}</div>
  );

  return (
    <div className="nw-settings">
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span className="muted" style={{ fontSize: 12 }}>I tuoi argomenti</span>
        {cfg.topics.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {cfg.topics.map((t) => (
              <span key={t} className="nw-chip">
                {t}
                <button onClick={() => save({ ...cfg, topics: cfg.topics.filter((x) => x !== t) })} aria-label={`Togli ${t}`}><Icon name="x" size={12} /></button>
              </span>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <input className="input" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} placeholder="es. intelligenza artificiale, edilizia sostenibile…" aria-label="Nuovo argomento" style={{ flex: 1, minWidth: 0 }} />
          <button className="btn btn-secondary" onClick={add} disabled={!text.trim()} style={{ gap: 6 }}><Icon name="plus" size={14} />Aggiungi</button>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span className="muted" style={{ fontSize: 12 }}>Argomenti da escludere</span>
        {cfg.excluded.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {cfg.excluded.map((t) => (
              <span key={t} className="nw-chip nw-chip-no">
                <Icon name="eyeOff" size={11} />{t}
                <button onClick={() => save({ ...cfg, excluded: cfg.excluded.filter((x) => x !== t) })} aria-label={`Non escludere più ${t}`}><Icon name="x" size={12} /></button>
              </span>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <input className="input" value={noText} onChange={(e) => setNoText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") exclude(noText); }} placeholder="es. calcio, gossip, oroscopo…" aria-label="Argomento da escludere" style={{ flex: 1, minWidth: 0 }} />
          <button className="btn btn-secondary" onClick={() => exclude(noText)} disabled={!noText.trim()} style={{ gap: 6 }}><Icon name="eyeOff" size={14} />Escludi</button>
        </div>
        <span className="faint" style={{ fontSize: 12 }}>Spariscono le notizie che lo nominano nel titolo; l&apos;IA non lo propone e scarta anche quelle che ne parlano con altre parole.</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 14, cursor: aiOn ? "pointer" : "default", opacity: aiOn ? 1 : 0.6 }}>
          <input type="checkbox" checked={cfg.auto && aiOn} disabled={!aiOn} onChange={(e) => save({ ...cfg, auto: e.target.checked })} style={{ marginTop: 3 }} />
          <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span>Argomenti automatici dalla memoria</span>
            <span className="muted" style={{ fontSize: 12 }}>
              {aiOn ? "L'IA sceglie gli argomenti dai tuoi progetti e dalle tue note (una volta al giorno) e seleziona le notizie «Per te»." : "Serve la chiave OpenRouter (Impostazioni → IA)."}
            </span>
          </span>
        </label>
        {cfg.auto && aiOn && (
          <div className="nw-auto">
            {feed?.autoTopics.some((t) => !isExcluded(`${t.label} ${t.query}`, cfg.excluded)) ? feed.autoTopics.filter((t) => !isExcluded(`${t.label} ${t.query}`, cfg.excluded)).map((t) => (
              <div key={t.label} style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 13 }}>
                <span style={{ color: "var(--accent-text)", display: "flex" }}><Icon name="ai" size={12} /></span>
                <span style={{ flex: 1 }}><b style={{ fontWeight: 500 }}>{t.label}</b> <span className="muted">— {t.why}</span></span>
                <button className="btn btn-ghost" onClick={() => exclude(t.label)} title={`Non mostrarmi più notizie su «${t.label}»`} style={{ height: 24, padding: "0 6px", gap: 4, fontSize: 12, color: "var(--muted)", flex: "none" }}><Icon name="eyeOff" size={12} />Escludi</button>
              </div>
            )) : <span className="muted" style={{ fontSize: 13 }}>Ancora nessun argomento: premi Rigenera.</span>}
            <button className="btn btn-ghost" onClick={regenerate} disabled={refreshing} style={{ alignSelf: "flex-start", gap: 6, height: 30, color: "var(--accent-text)" }}>
              <span className="nw-spin" style={{ display: "flex" }}><Icon name="refresh" size={14} /></span>{refreshing ? "L'IA sta scegliendo…" : "Rigenera gli argomenti"}
            </button>
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="muted" style={{ fontSize: 12 }}>Notizie per scheda</span>
          {seg(cfg.count, [5, 8, 12] as (5 | 8 | 12)[], (count) => save({ ...cfg, count }))}
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer", paddingBottom: 6 }}>
          <input type="checkbox" checked={cfg.intl} onChange={(e) => save({ ...cfg, intl: e.target.checked })} />Anche fonti internazionali (in inglese)
        </label>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10 }}>
        {(pending || refreshing) && <span className="faint" style={{ fontSize: 12 }}>Aggiorno le notizie…</span>}
        <button className="btn btn-primary" onClick={onDone} style={{ height: 32 }}>Fatto</button>
      </div>
    </div>
  );
}
