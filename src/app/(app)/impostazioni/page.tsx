import { cookies, headers } from "next/headers";
import { desc, eq, sql } from "drizzle-orm";
import { Icon } from "@/components/ui";
import { db, ready } from "@/lib/db";
import { aiLog, apiKeys, backgrounds, items, people, projects, pushSubs, tasks, webhooks } from "@/lib/db/schema";
import { getNotifyPrefs } from "@/lib/push";
import { CheckinSettings, NotifySettings } from "./NotifySettings";
import { getCheckinPrefs } from "@/lib/checkin";
import { ProfileSettings } from "./ProfileSettings";
import Link from "next/link";
import { SetCard, SettingsShell, type SettingsSection } from "./SettingsShell";
import { IntegrationsSettings } from "./IntegrationsSettings";
import { clock, shortDate } from "@/lib/format";
import { AI_VOICES, DEFAULT_MODEL, DEFAULT_MODELS, getAiConfig, getLook, getProfile, getVoicePrefs, maskKey } from "@/lib/settings";
import { VoiceSettings } from "./VoiceSettings";
import { parseMode } from "@/lib/theme";
import { DeleteAll, DensitySwitch, ImportBackup, LookEditor, ThemeSwitch } from "./SettingsClient";
import { AiSettings } from "./AiSettings";
import { BackupCard } from "./BackupCard";
import { backupStatus, listBackups } from "@/lib/backup";

export default async function SettingsPage() {
  await ready();
  const count = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
  const jar = await cookies();
  const theme = parseMode(jar.get("sb_theme")?.value);
  const density = jar.get("sb_density")?.value === "compact" ? "compact" : "comfortable";
  const [look, cfg, log, nItems, nProjects, nPeople, nTasks, notify, subs, bgs, profile, keys, hooks, bkStatus, bkList, checkinPrefs, voicePrefs] = await Promise.all([
    getLook(),
    getAiConfig(),
    db.select({ id: aiLog.id, at: aiLog.at, action: aiLog.action, outcome: aiLog.outcome, title: items.title, itemId: aiLog.itemId })
      .from(aiLog).leftJoin(items, eq(aiLog.itemId, items.id)).orderBy(desc(aiLog.at)).limit(100),
    count(db.select({ n: sql<number>`count(*)` }).from(items).where(eq(items.status, "memory"))),
    count(db.select({ n: sql<number>`count(*)` }).from(projects)),
    count(db.select({ n: sql<number>`count(*)` }).from(people)),
    count(db.select({ n: sql<number>`count(*)` }).from(tasks)),
    getNotifyPrefs(),
    db.select().from(pushSubs).orderBy(pushSubs.createdAt),
    db.select({ id: backgrounds.id, name: backgrounds.name }).from(backgrounds).orderBy(desc(backgrounds.createdAt)),
    getProfile(),
    db.select().from(apiKeys).orderBy(desc(apiKeys.createdAt)),
    db.select().from(webhooks).orderBy(webhooks.createdAt),
    backupStatus(),
    listBackups(),
    getCheckinPrefs(),
    getVoicePrefs(),
  ]);
  // Indirizzo pubblico dell'app (dietro nginx arriva negli header inoltrati).
  const h = await headers();
  const base = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host") ?? "localhost"}`;

  const stats: [string, number][] = [["Elementi in memoria", nItems], ["Progetti", nProjects], ["Persone", nPeople], ["Attività", nTasks]];

  const sections: SettingsSection[] = [
    {
      id: "profilo", title: "Profilo", icon: "user",
      desc: "Chi sei e come vuoi che l'IA ti parli. Vale su tutti i dispositivi.",
      content: (
        <>
          <SetCard title="Chi sei" icon="user"><ProfileSettings initial={profile} /></SetCard>
          <SetCard title="Cosa l'IA sa di te" icon="ai" desc="I fatti su di te che l'IA usa in ogni conversazione, con da dove vengono, da quando valgono e cosa è da verificare, più le persone che conosce.">
            <Link href="/memoria" className="btn btn-secondary" style={{ alignSelf: "flex-start", gap: 6 }}>Apri «Cosa so di te»<Icon name="arrowR" size={14} /></Link>
          </SetCard>
        </>
      ),
    },
    {
      id: "aspetto", title: "Aspetto", icon: "layout",
      desc: "Tema, colori, carattere e sfondo dell'app.",
      content: (
        <>
          <SetCard title="Su questo dispositivo" icon="laptop" desc="Queste due scelte valgono solo per il dispositivo che stai usando.">
            <Row title="Modalità" desc="Automatico segue l'impostazione chiaro/scuro del dispositivo."><ThemeSwitch initial={theme} /></Row>
            <Row title="Densità" desc="Compatta riduce spazi e dimensioni per vedere più contenuti."><DensitySwitch initial={density} /></Row>
          </SetCard>
          <SetCard title="Tema dell'app" icon="star" desc="Uguale su tutti i dispositivi. Le modifiche si vedono subito.">
            <LookEditor initial={look} uploads={bgs} />
          </SetCard>
        </>
      ),
    },
    {
      id: "notifiche", title: "Notifiche", icon: "bell",
      desc: "Notifiche push sul telefono o sul computer, anche con l'app chiusa. Vanno attivate su ogni dispositivo.",
      content: (
        <>
          <SetCard title="Notifiche push" icon="bell">
            <NotifySettings prefs={notify} devices={subs.map((s) => ({ endpoint: s.endpoint, device: s.device, since: shortDate(s.createdAt) }))} />
          </SetCard>
          <SetCard title="Com'è andata oggi?" icon="ai" desc="La sera, quando c'è qualcosa di cui parlare, ti scrivo come farebbe un amico. Rispondi a voce o per iscritto: alla fine ti propongo cosa ricordare (nota di diario, persone, fatti, attività), e salvo solo quello che confermi.">
            <CheckinSettings prefs={checkinPrefs} />
          </SetCard>
        </>
      ),
    },
    {
      id: "ia", title: "Intelligenza artificiale", icon: "ai",
      desc: "Tutto il lavoro dell'IA passa da OpenRouter: un modello forte per ragionare, modelli economici per la routine, con la privacy e il tetto di spesa scelti qui.",
      content: (
        <AiSettings
          keyMasked={maskKey(cfg.apiKey)}
          keySource={cfg.keySource}
          models={cfg.models}
          defaults={{ fast: process.env.AI_MODEL || DEFAULT_MODEL, files: cfg.models.fast, ...DEFAULT_MODELS }}
          privacy={cfg.privacy}
          budgetEur={cfg.budgetEur}
        />
      ),
    },
    {
      id: "voce", title: "Voce", icon: "volume",
      desc: "Come l'Assistente legge ad alta voce le risposte.",
      content: (
        <SetCard title="Voce delle risposte" icon="volume">
          <VoiceSettings initial={voicePrefs} voices={AI_VOICES} aiEnabled={!!cfg.apiKey} />
        </SetCard>
      ),
    },
    {
      id: "integrazioni", title: "Integrazioni", icon: "link",
      desc: "Collega Second Brain a Claude (server MCP e skill), ad app e automazioni (API REST) e ricevi eventi (webhook).",
      content: (
        <SetCard title="Claude, API e webhook" icon="link">
          <IntegrationsSettings
            base={base}
            keys={keys.map((k) => ({ id: k.id, name: k.name, prefix: k.prefix, scope: k.scope, created: shortDate(k.createdAt), lastUsed: k.lastUsedAt ? `${shortDate(k.lastUsedAt)} ${clock(k.lastUsedAt)}` : null }))}
            hooks={hooks.map((w) => ({ id: w.id, url: w.url, events: w.events, lastStatus: w.lastStatus, lastAt: w.lastAt ? `${shortDate(w.lastAt)} ${clock(w.lastAt)}` : null }))}
          />
        </SetCard>
      ),
    },
    {
      id: "registro", title: "Registro IA", icon: "journal",
      desc: "Ogni azione proposta o eseguita dall'IA, con il suo esito. Ultime 100.",
      content: (
        <SetCard title="Ultime azioni dell'IA" icon="journal">
          {log.length ? (
            <div style={{ overflowX: "auto" }}>
              <table className="table">
                <thead><tr><th>Quando</th><th>Azione</th><th>Elemento</th><th>Esito</th></tr></thead>
                <tbody>
                  {log.map((r) => (
                    <tr key={r.id}>
                      <td className="muted" style={{ whiteSpace: "nowrap" }}>{shortDate(r.at)} {clock(r.at)}</td>
                      <td>{r.action}</td>
                      <td>{r.title ? <a href={`/conoscenza/${r.itemId}`} style={{ color: "inherit" }}>{r.title}</a> : <span className="muted">—</span>}</td>
                      <td style={{ color: r.outcome.startsWith("Errore") ? "var(--danger)" : r.outcome.startsWith("Confermata") ? "var(--accent-text)" : "var(--muted)" }}>{r.outcome}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="muted" style={{ margin: 0, fontSize: 14 }}>Ancora nessuna azione dell&apos;IA.</p>}
        </SetCard>
      ),
    },
    {
      id: "dati", title: "Dati e backup", icon: "shield",
      desc: "I dati restano sul tuo server. All'IA vengono inviati solo i contenuti da elaborare e il contesto necessario.",
      content: (
        <>
          <SetCard title="La tua memoria" icon="book">
            <div className="set-stats">
              {stats.map(([label, value]) => (
                <div key={label}>
                  <span className="muted" style={{ fontSize: 12 }}>{label}</span>
                  <span style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 26 }}>{value}</span>
                </div>
              ))}
            </div>
          </SetCard>
          <SetCard title="Backup automatico" icon="shield" desc="Ogni notte alle 2:30 una copia del database (e degli allegati nuovi) sul server: le ultime due settimane, poi una a settimana per due mesi. Scarica ogni tanto l'ultima copia per averne una anche fuori dal server.">
            <BackupCard initial={bkStatus} copies={bkList.map((b) => ({ day: b.day, size: b.size }))} />
          </SetCard>
          <SetCard title="Esporta e ripristina" icon="download" desc="Il backup JSON contiene tutto (anche conversazioni, obiettivi e fatti su di te) e si può reimportare; il Markdown è leggibile ovunque. Gli allegati restano sul server.">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <a className="btn btn-secondary" href="/api/export?format=md" style={{ gap: 6 }}><Icon name="download" />Esporta in Markdown</a>
              <a className="btn btn-secondary" href="/api/export?format=json" style={{ gap: 6 }}><Icon name="download" />Esporta in JSON</a>
              <ImportBackup />
            </div>
          </SetCard>
          <SetCard title="Zona pericolosa" icon="alert" tone="danger" desc="Elimina elementi, progetti, persone, attività, conversazioni e registro IA. Profilo, fatti su di te e impostazioni restano. Scarica prima un backup.">
            <div><DeleteAll /></div>
          </SetCard>
        </>
      ),
    },
  ];

  return (
    <div className="page" style={{ maxWidth: 1180, gap: 24 }}>
      <h1 className="page-title" style={{ margin: 0, fontSize: 40 }}>Impostazioni</h1>
      <SettingsShell sections={sections} />
    </div>
  );
}

function Row({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "14px 0", borderTop: "1px solid var(--color-divider)", flexWrap: "wrap" }}>
      <div><div style={{ fontSize: 15 }}>{title}</div><div className="muted" style={{ fontSize: 13 }}>{desc}</div></div>
      {children}
    </div>
  );
}
