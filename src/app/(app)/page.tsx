import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { Icon, itemIcon, KIND_ICON } from "@/components/ui";
import { TaskCheck } from "@/components/TaskCheck";
import { loadDemoData } from "@/lib/actions";
import { db } from "@/lib/db";
import { aims as aimsTable, chats, goals as goalsTable } from "@/lib/db/schema";
import { dueInfo, dueLabel, greeting, headerDate, initials, isoDay, relTime, shortDate } from "@/lib/format";
import { parseHome, type WidgetId } from "@/lib/home";
import { getInbox, getMemory, getPeople, getProjects, getTasks } from "@/lib/queries";
import { getProfile, getSetting } from "@/lib/settings";
import { HomeGrid } from "./HomeGrid";
import { Suspense } from "react";
import { parseWeatherConfig } from "@/lib/weather";
import { getWeather } from "@/lib/weather-api";
import { WeatherWidget } from "@/components/weather/WeatherWidget";
import { NewsWidget } from "@/components/news/NewsWidget";
import { InsightsWidget } from "@/components/InsightsWidget";
import { getDailyBrief, listInsights } from "@/lib/proactive";
import { todayFactQuestion } from "@/lib/fact-question";
import { todayCheckin } from "@/lib/checkin";
import { FactQuestion } from "@/components/FactQuestion";
import { parseNewsConfig } from "@/lib/news";
import { getNewsFeed } from "@/lib/news-api";
import { aiEnabled } from "@/lib/ai";

/** Le notizie arrivano in streaming: la raccolta (e la scelta con l'IA) può richiedere qualche secondo. */
async function NewsBox() {
  const [raw, aiOn, hiddenRaw, capturedRaw] = await Promise.all([getSetting("news"), aiEnabled(), getSetting("news_hidden"), getSetting("news_captured")]);
  const config = parseNewsConfig(raw);
  const feed = config.topics.length || (config.auto && aiOn) ? await getNewsFeed(config).catch(() => null) : null;
  const parse = <T,>(s: string | null, d: T): T => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
  return <NewsWidget config={config} feed={feed} aiOn={aiOn} hidden={parse<string[]>(hiddenRaw, [])} captured={parse<Record<string, string>>(capturedRaw, {})} />;
}

/** Il meteo arriva in streaming: la Home non aspetta Open-Meteo. */
async function WeatherBox() {
  const config = parseWeatherConfig(await getSetting("weather"));
  const weather = await getWeather(config);
  return <WeatherWidget config={config} weather={weather} />;
}

const DUE_ORDER = { overdue: 0, today: 1, week: 2, later: 3, none: 4 };

function Empty({ text }: { text: string }) {
  return <div className="muted" style={{ padding: "22px 0", fontSize: 14, textAlign: "center" }}>{text}</div>;
}

export default async function Home() {
  const [inbox, memory, tasks, projects, people, layoutRaw, profile] = await Promise.all([getInbox(), getMemory(), getTasks(), getProjects(), getPeople(), getSetting("home"), getProfile()]);
  const projName = new Map(projects.map((p) => [p.id, p.name]));
  const today = isoDay();

  if (!inbox.length && !memory.length) {
    return (
      <div className="page" style={{ maxWidth: 980, gap: 28 }}>
        <div className="eyebrow">{headerDate()}</div>
        <h1 className="page-title" style={{ margin: 0, fontSize: 48, letterSpacing: "-.02em" }}>{greeting() + (profile.name ? `, ${profile.name}` : "")}</h1>
        <div className="empty" style={{ padding: "64px 24px" }}>
          <span className="faint"><Icon name="book" size={20} /></span>
          <div className="empty-title" style={{ fontSize: 22 }}>La memoria è vuota</div>
          <p className="muted" style={{ margin: 0, fontSize: 14, maxWidth: 420 }}>Cattura note, idee o link dall&apos;Inbox. Dopo la tua conferma compariranno qui, già collegati.</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
            <Link href="/inbox" className="btn btn-primary" style={{ gap: 6 }}><Icon name="plus" />Prima cattura</Link>
            <form action={loadDemoData}><button className="btn btn-secondary">Carica dati di esempio</button></form>
          </div>
        </div>
      </div>
    );
  }

  const layout = parseHome(layoutRaw);
  const shown = new Set(layout.widgets.filter((w) => !w.hidden).map((w) => w.id));
  // I dati dei riquadri nuovi si leggono solo se sono visibili.
  const [openGoals, openAims, recentChats] = await Promise.all([
    shown.has("goals") ? db.select().from(goalsTable).where(eq(goalsTable.done, false)).orderBy(goalsTable.ord) : [],
    shown.has("goals") ? db.select().from(aimsTable).where(eq(aimsTable.status, "active")).orderBy(aimsTable.due) : [],
    shown.has("chats") ? db.select({ id: chats.id, title: chats.title, updatedAt: chats.updatedAt }).from(chats).orderBy(desc(chats.updatedAt)).limit(5) : [],
  ]);

  const capturedToday = [...inbox, ...memory].filter((i) => isoDay(i.createdAt) === today).length;
  const open = tasks.filter((t) => !t.done);
  const overdue = open.filter((t) => dueInfo(t.due).group === "overdue").length;
  const dueToday = open.filter((t) => dueInfo(t.due).group === "today").length;
  const conflicts = memory.filter((m) => m.conflict);
  const sentence = [
    `Oggi hai catturato ${capturedToday} ${capturedToday === 1 ? "elemento" : "elementi"}; ${inbox.length} ${inbox.length === 1 ? "è" : "sono"} in Inbox.`,
    overdue || dueToday ? `Hai ${overdue ? `${overdue} ${overdue === 1 ? "attività scaduta" : "attività scadute"}` : ""}${overdue && dueToday ? " e " : ""}${dueToday ? `${dueToday} in scadenza oggi` : ""}.` : "Nessuna attività in scadenza oggi.",
    conflicts.length ? `${conflicts.length === 1 ? "C'è un punto aperto" : `Ci sono ${conflicts.length} punti aperti`}: ${conflicts.map((c) => `«${c.title}»`).join(", ")} contraddice una decisione precedente.` : "",
  ].join(" ");

  const upcoming = [...open].sort((a, b) => DUE_ORDER[dueInfo(a.due).group] - DUE_ORDER[dueInfo(b.due).group] || (a.due ?? "").localeCompare(b.due ?? "")).slice(0, 4);
  const active = projects.filter((p) => p.status === "Attivo");
  // Agenda: attività di oggi (e scadute), prima quelle con orario, in ordine di orario.
  const agenda = open
    .filter((t) => t.due && t.due <= today)
    .sort((a, b) => (a.due === today ? 0 : -1) - (b.due === today ? 0 : -1) || (a.time ?? "99").localeCompare(b.time ?? "99"))
    .slice(0, 6);
  const favorites = memory.filter((m) => m.favorite).slice(0, 5);
  // Catture recenti: prima quelle che aspettano la conferma, poi le ultime già in memoria (5 in tutto).
  const recentCaptures = [...inbox.slice(0, 5), ...memory].slice(0, 5);

  const taskRow = (t: (typeof tasks)[number], label: string, color?: string) => (
    <div key={t.id} style={{ display: "grid", gridTemplateColumns: "16px minmax(0,1fr)", gap: 12, alignItems: "start", padding: "10px 0", borderTop: "1px solid var(--color-divider)" }}>
      <TaskCheck id={t.id} done={t.done} />
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 14 }}>{t.title}</span>
        <span className="muted" style={{ fontSize: 12, display: "flex", gap: 6 }}>
          <span style={{ color }}>{label}</span>
          {t.projectId && <><span>·</span><span>{projName.get(t.projectId)}</span></>}
        </span>
      </div>
    </div>
  );

  const contents: Record<WidgetId, React.ReactNode> = {
    insights: shown.has("insights") ? <InsightsWidget items={await listInsights()} aiOn={await aiEnabled()} /> : null,

    news: shown.has("news") ? (
      <Suspense fallback={<div className="wx-skeleton" aria-label="Cerco le notizie…"><span style={{ height: 22 }} /><span /><span /><span /><span /></div>}>
        <NewsBox />
      </Suspense>
    ) : null,

    weather: shown.has("weather") ? (
      <Suspense fallback={<div className="wx-skeleton" aria-label="Carico il meteo…"><span /><span /><span /></div>}>
        <WeatherBox />
      </Suspense>
    ) : null,

    inbox: recentCaptures.length ? recentCaptures.map((it) => (
      <Link key={it.id} href={it.status === "memory" ? `/conoscenza/${it.id}` : "/inbox"} className="list-btn" style={{ gridTemplateColumns: "18px minmax(0,1fr)", alignItems: "start" }}>
        <span className="muted" style={{ paddingTop: 2 }}><Icon name={it.status === "memory" ? itemIcon(it.type, it.kind) : KIND_ICON[it.kind]} /></span>
        <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <span className="ellipsis" style={{ fontSize: 14 }}>{it.title}</span>
          <span className="muted" style={{ fontSize: 12 }}>
            {relTime(it.createdAt)} ·{" "}
            <span style={{ color: it.status === "error" ? "var(--danger)" : it.status === "ready" ? "var(--accent-text)" : undefined }}>
              {it.status === "memory" ? `In memoria${it.type ? ` · ${it.type}` : ""}` : it.status === "ready" ? "Proposta pronta" : it.status === "error" ? "Errore" : "In elaborazione…"}
            </span>
          </span>
        </span>
      </Link>
    )) : <Empty text="Nessuna cattura ancora." />,

    tasks: upcoming.length ? upcoming.map((t) => {
      const d = dueInfo(t.due);
      return taskRow(t, (d.label || "Senza scadenza") + (t.time ? ` · ${t.time}` : ""), d.group === "overdue" ? "var(--danger)" : d.group === "today" ? "var(--color-text)" : undefined);
    }) : <Empty text="Nessuna attività in scadenza." />,

    projects: active.length ? active.map((p) => (
      <Link key={p.id} href={`/progetti/${p.id}`} className="list-btn" style={{ display: "flex", flexDirection: "column", gap: 7, padding: "11px 0" }}>
        <span style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 14 }}><span>{p.name}</span><span className="muted" style={{ fontSize: 12 }}>{p.pct}%</span></span>
        <span style={{ height: 3, background: "var(--skel)", display: "block" }}><span style={{ display: "block", height: 3, width: p.pct + "%", background: "var(--color-accent)" }} /></span>
        <span className="muted" style={{ fontSize: 12 }}>{p.next}</span>
      </Link>
    )) : <Empty text="Nessun progetto attivo." />,

    knowledge: memory.length ? memory.slice(0, 4).map((k) => (
      <Link key={k.id} href={`/conoscenza/${k.id}`} className="list-btn" style={{ gridTemplateColumns: "18px minmax(0,1fr) auto", alignItems: "center", padding: "11px 0" }}>
        <span className="muted"><Icon name={itemIcon(k.type, k.kind)} /></span>
        <span className="ellipsis" style={{ fontSize: 14 }}>{k.title}</span>
        <span className="muted" style={{ fontSize: 12, whiteSpace: "nowrap" }}>{k.type} · {shortDate(k.createdAt)}</span>
      </Link>
    )) : <Empty text="La memoria è ancora vuota." />,

    people: people.length ? people.slice(0, 4).map((p) => (
      <Link key={p.id} href={`/persone/${p.id}`} className="list-btn" style={{ gridTemplateColumns: "30px minmax(0,1fr)", alignItems: "center", padding: "9px 0" }}>
        <span className="muted" style={{ width: 30, height: 30, borderRadius: "50%", border: "1px solid var(--color-divider)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11 }}>{initials(p.name)}</span>
        <span style={{ display: "flex", flexDirection: "column", minWidth: 0, lineHeight: 1.35 }}>
          <span style={{ fontSize: 14 }}>{p.name}</span>
          <span className="muted ellipsis" style={{ fontSize: 12 }}>{[p.role, p.org].filter(Boolean).join(" · ") || "—"}</span>
        </span>
      </Link>
    )) : <Empty text="Nessuna persona ancora. Le persone menzionate nelle catture compariranno qui." />,

    agenda: agenda.length ? agenda.map((t) => taskRow(
      t,
      t.due! < today ? `Scaduta · ${dueInfo(t.due).label}` : t.time ? `Alle ${t.time}${t.remind != null ? " · promemoria" : ""}` : "Oggi",
      t.due! < today ? "var(--danger)" : "var(--color-text)",
    )) : <Empty text="Niente in programma per oggi." />,

    goals: openGoals.length || openAims.length ? [...openAims.slice(0, 4).map((a) => (
      <Link key={a.id} href={`/obiettivi/${a.id}`} className="list-btn" style={{ gridTemplateColumns: "18px minmax(0,1fr)", alignItems: "start", padding: "9px 0" }}>
        <span style={{ color: "var(--color-accent)", paddingTop: 2 }}><Icon name="target" size={16} /></span>
        <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <span style={{ fontSize: 14 }}>{a.title}</span>
          <span className="muted" style={{ fontSize: 12 }}>Personale{a.due ? ` · entro ${dueLabel(a.due).toLowerCase()}` : ""}</span>
        </span>
      </Link>
    )), ...openGoals.slice(0, Math.max(2, 6 - Math.min(openAims.length, 4))).map((g) => (
      <Link key={g.id} href={`/progetti/${g.projectId}`} className="list-btn" style={{ gridTemplateColumns: "18px minmax(0,1fr)", alignItems: "start", padding: "9px 0" }}>
        <span style={{ color: "var(--color-accent)", paddingTop: 2 }}><Icon name="target" size={16} /></span>
        <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <span style={{ fontSize: 14 }}>{g.title}</span>
          <span className="muted" style={{ fontSize: 12 }}>{projName.get(g.projectId) ?? "Progetto"}</span>
        </span>
      </Link>
    ))] : <Empty text="Nessun obiettivo aperto. Creane uno in Obiettivi o dalla pagina di un progetto." />,

    favorites: favorites.length ? favorites.map((k) => (
      <Link key={k.id} href={`/conoscenza/${k.id}`} className="list-btn" style={{ gridTemplateColumns: "18px minmax(0,1fr)", alignItems: "center", padding: "10px 0" }}>
        <span style={{ color: "var(--accent-text)" }}><Icon name="star" size={16} /></span>
        <span className="ellipsis" style={{ fontSize: 14 }}>{k.title}</span>
      </Link>
    )) : <Empty text="Nessun preferito. Tocca la stella su un elemento della Conoscenza." />,

    chats: recentChats.length ? recentChats.map((c) => (
      <Link key={c.id} href={`/assistente?chat=${c.id}`} className="list-btn" style={{ gridTemplateColumns: "18px minmax(0,1fr)", alignItems: "start", padding: "9px 0" }}>
        <span className="muted" style={{ paddingTop: 2 }}><Icon name="ai" size={16} /></span>
        <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <span className="ellipsis" style={{ fontSize: 14 }}>{c.title}</span>
          <span className="muted" style={{ fontSize: 12 }}>{relTime(c.updatedAt)}</span>
        </span>
      </Link>
    )) : <Empty text="Nessuna conversazione. Fai una domanda all'Assistente." />,
  };

  const header = (
    <>
      <div className="eyebrow">{headerDate()}</div>
      <h1 className="page-title" style={{ margin: 0, fontSize: 48, letterSpacing: "-.02em" }}>{greeting() + (profile.name ? `, ${profile.name}` : "")}</h1>
    </>
  );
  const [brief, factQ, checkin] = await Promise.all([getDailyBrief(), todayFactQuestion().catch(() => null), todayCheckin().catch(() => null)]);
  const summary = (
    <>
      {brief ? (
        <div className="brief">
          <div className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--accent-text)" }}><Icon name="ai" size={13} />Il punto del mattino</div>
          <p style={{ margin: 0, fontSize: 17, lineHeight: 1.6, textWrap: "pretty" }}><strong style={{ fontWeight: 600 }}>{brief.title}</strong> {brief.body}</p>
          {brief.highlights.length > 0 && <ul>{brief.highlights.map((h) => <li key={h}>{h}</li>)}</ul>}
          {!!(brief.changes?.length || brief.delta?.length) && (
            <div className="brief-changes">
              <div className="eyebrow">{brief.sinceLabel ?? "Da ieri"}</div>
              {!!brief.changes?.length && <ul>{brief.changes.map((c) => <li key={c}>{c}</li>)}</ul>}
              {!!brief.delta?.length && (
                <div className="brief-delta">
                  {brief.delta.map((d) => <Link key={d.label} href={d.href}>{d.label}</Link>)}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
      <p style={{ margin: 0, fontSize: 17, lineHeight: 1.6, textWrap: "pretty" }}>{sentence}</p>
      )}
      {checkin && (
        <Link href={`/assistente?chat=${checkin.chatId}`} className="checkin-card">
          <span className="checkin-icon"><Icon name="ai" size={15} /></span>
          <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
            <span className="eyebrow" style={{ color: "var(--accent-text)" }}>Com&apos;è andata oggi?</span>
            <span style={{ fontSize: 15, lineHeight: 1.45 }}>{checkin.message}</span>
          </span>
          <span className="btn btn-secondary" style={{ height: 30, flex: "none" }}>Rispondi</span>
        </Link>
      )}
      {factQ && <FactQuestion q={factQ} />}
      {conflicts.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <span className="muted" style={{ fontSize: 12 }}>Fonti</span>
          <Link href="/inbox" className="btn btn-secondary" style={{ height: 26, fontSize: 12, fontFamily: "var(--font-body)", fontWeight: 400 }}><Icon name="inbox" size={14} />{inbox.length} in Inbox</Link>
          {conflicts.slice(0, 3).map((c) => (
            <Link key={c.id} href={`/conoscenza/${c.id}`} className="btn btn-secondary" style={{ height: 26, fontSize: 12, fontFamily: "var(--font-body)", fontWeight: 400 }}>
              <Icon name={itemIcon(c.type, c.kind)} size={14} />{c.title} · {shortDate(c.createdAt)}
            </Link>
          ))}
        </div>
      )}
    </>
  );

  return (
    <div className="page" style={{ maxWidth: 1320, gap: 32 }}>
      <HomeGrid initial={layout} contents={contents} header={header} summary={summary} />
    </div>
  );
}
