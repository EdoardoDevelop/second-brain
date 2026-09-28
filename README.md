# Second Brain

La tua memoria personale. Catturi qualsiasi cosa, l'IA propone come archiviarla e tu confermi: nulla entra in memoria senza il tuo ok.

Web app per un solo utente, usabile da più dispositivi. Implementa il design `Second Brain.dc.html` con il design system Industry.

## Stack

- **Next.js 16** (App Router, server actions) + React 19 + TypeScript
- **libSQL/SQLite** con Drizzle ORM: in locale è un file, in produzione un database [Turso](https://turso.tech). Il codice è lo stesso.
- **OpenRouter** (API compatibile OpenAI, chiamata con `fetch`) per classificare le catture e per le azioni IA; il modello si sceglie da `.env`
- Accesso protetto da password, con cookie firmato valido 90 giorni

## Avvio in locale

```bash
npm install
cp .env.example .env.local   # poi compila i valori
npm run dev
```

Apri http://localhost:3000 ed entra con `APP_PASSWORD`. Con la memoria vuota, la Home offre **Carica dati di esempio**, cioè i dati del prototipo.

Le tabelle si creano da sole al primo avvio.

### Variabili d'ambiente

| Variabile | A cosa serve |
|---|---|
| `APP_PASSWORD` | Password di accesso |
| `SESSION_SECRET` | Chiave per firmare il cookie (almeno 16 caratteri casuali) |
| `DATABASE_URL` | `file:data/second-brain.db` in locale, `libsql://…turso.io` in produzione |
| `DATABASE_AUTH_TOKEN` | Token di Turso (solo in produzione) |
| `OPENROUTER_API_KEY` | Attiva la classificazione IA. Senza chiave l'app funziona e classifichi a mano |
| `AI_MODEL` | Opzionale, id OpenRouter del modello, predefinito `google/gemini-3.5-flash-lite`. Deve supportare gli output strutturati |
| `AI_DATA_COLLECTION` | Opzionale. Predefinito: esclude i fornitori che conservano o addestrano sui dati. `allow` li ammette (serve per molti modelli `:free`) |

## Online, da tutti i dispositivi

1. Crea il database: `turso db create second-brain`, poi `turso db show second-brain --url` e `turso db tokens create second-brain`.
2. Importa il repository su [Vercel](https://vercel.com) e imposta le variabili qui sopra.
3. Apri l'URL da computer e telefono. Il layout si adatta al mobile (la barra laterale diventa un menu).

## Cosa c'è in questa fase

| Schermata | Stato |
|---|---|
| Home | Sintesi del giorno, catture, attività, progetti, conoscenza recente, persone |
| Inbox | Cattura di testo e link, proposta IA modificabile (tipo, titolo, sintesi, persone, progetto, tag, collegamenti, conflitti, attività), Conferma / Salva senza classificazione / Scarta, Riprova |
| Conoscenza | Ricerca, viste, filtri per tipo, progetto e tag, preferiti |
| Dettaglio | Sintesi, contenuto modificabile, conflitti, azioni IA (Riassumi, Spiega, Genera attività) con conferma, collegati, provenienza, registro IA, esporta in Markdown, archivia, elimina |
| Attività | Gruppi per scadenza, filtri, aggiunta rapida, scadenza modificabile, origine dell'attività |
| ⌘K, tema chiaro/scuro | Ricerca rapida e tema salvato |
| Progetti, Persone, Timeline, Connessioni, Assistente, Impostazioni, Moduli | Prossime fasi (segnaposto "In arrivo") |

## Struttura

```
src/lib/db/schema.ts   modello dati: items, projects, people, links, tasks, ai_log
src/lib/ai.ts          chiamate a Claude (output strutturato con Zod)
src/lib/actions.ts     server actions: ogni modifica passa da qui
src/lib/queries.ts     letture
src/app/(app)/…        pagine protette
src/app/industry.css   design system Industry (copiato da _ds)
```
