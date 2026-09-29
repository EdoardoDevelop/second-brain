# Second Brain

La tua memoria personale. Catturi qualsiasi cosa (testo, link, foto, PDF, audio, condivisioni dal telefono), l'IA propone come archiviarla e tu confermi: **nulla entra in memoria senza il tuo ok**, e ogni azione dell'IA finisce nel registro.

Web app per un solo utente, usata da computer e telefono (installabile come app). In produzione gira su un VPS personale: <https://localvps.ddns.net>.

## Cosa fa

| Area | Cosa c'è |
|---|---|
| **Home** | Riepilogo del mattino scritto dall'IA, suggerimenti dell'IA con azioni da confermare, meteo, notizie per te, catture, attività, agenda, progetti, obiettivi, persone, preferiti, conversazioni. Riquadri riordinabili e ridimensionabili |
| **Inbox** | Cattura di testo, link, file (foto, PDF, audio) e registrazioni; condivisione dal telefono (Android); proposta dell'IA modificabile (tipo, titolo, sintesi, persone, progetto, tag, collegamenti e conflitti, attività) da confermare |
| **Conoscenza** | Ricerca, viste, filtri, preferiti; dettaglio con contenuto modificabile, allegati (popup immagini, lettore PDF integrato), azioni IA, collegamenti, esporta in Markdown, «Chiedi all'IA su questo» |
| **Assistente** | Domande e comandi, scritti o a voce. L'IA lavora a passi (cerca, apre, confronta), risponde con citazioni cliccabili, suggerisce domande successive, propone azioni e fatti da ricordare che confermi tu. Per le domande sul perché («perché X è fermo?») segue in un passo solo i collegamenti tra progetto, attività, persone, riunioni e documenti. «Pensa meglio» usa un modello più potente; «Salva in memoria» manda la risposta in Inbox |
| **Barra comandi** | ⌘J (o il pulsante IA/microfono): comandi e domande rapide con lo stesso motore dell'Assistente |
| **Attività** | Gruppi per scadenza, orari e promemoria con notifica («Fatto», «+1 ora»), modifica ed eliminazione |
| **Progetti e Persone** | Obiettivi, attività, documenti, persone coinvolte, «Cosa dovresti sapere» e «Relazione in breve» generate dall'IA |
| **Quadro completo** | «Fammi il quadro completo di X» (Assistente, ⌘J o pulsanti su progetto, persona, obiettivo): stato, decisioni, problemi aperti, persone, contraddizioni e prossimi passi con le fonti; vista derivata, non salvata in memoria |
| **Obiettivi** | Obiettivi personali (anche fuori dai progetti) con stato e scadenza; attività ed elementi collegati; l'IA li tiene presenti in risposte e suggerimenti e segnala quelli fermi o in scadenza |
| **Timeline e Connessioni** | Cronologia per giorno; grafo 2D/3D di elementi, progetti, persone e concetti |
| **Cosa so di te** | I fatti che l'IA sa di te, con provenienza, gruppi ed età (fresco, vecchio, forse superato); una domanda al giorno «È ancora vero che…?» anche nella Home; la cura notturna propone doppioni, contraddizioni e riconferme |
| **Impostazioni** | Profilo, aspetto (temi, colori, carattere, sfondi), notifiche push, IA (modelli per compito, privacy, spesa del mese con tetto, confronto modelli), integrazioni, registro IA, backup |
| **Integrazioni** | Server MCP e skill per Claude, API REST con chiavi, webhook firmati |

## Come funziona l'IA

Tutte le chiamate passano da **OpenRouter** (`src/lib/llm.ts`), con un modello diverso per compito:

| Compito | Uso | Predefinito |
|---|---|---|
| Veloce | Classificazione delle catture, notizie | `google/gemini-3.5-flash-lite` |
| File e audio | Lettura di foto, PDF, registrazioni | come il veloce |
| Ragionamento | Assistente, comandi, sintesi, riepilogo, suggerimenti | `deepseek/deepseek-v4-pro` |
| Pensa meglio | Su richiesta, per la singola domanda | `anthropic/claude-sonnet-5` |
| Significato | Ricerca per significato (embedding) | `google/gemini-embedding-2` |

- **Privacy:** si possono escludere i fornitori che conservano o usano i dati, fino alla conservazione zero (ZDR). Se un modello non è disponibile con la privacy scelta, l'app ripiega sul modello veloce e lo segnala; la privacy non si allenta mai.
- **Spesa:** ogni chiamata registra token e costo; nelle Impostazioni si vede la spesa del mese e si fissa un tetto (predefinito 5 €). Oltre il tetto il ragionamento passa al modello veloce.
- **Ricerca:** parole (SQLite FTS5) più significato (embedding), unite per pertinenza. L'indice si aggiorna da solo ogni 10 minuti.
- Senza chiave OpenRouter l'app funziona lo stesso: classifichi a mano e l'Assistente è spento.

## Stack

- **Next.js 16** (App Router, server actions), React 19, TypeScript 5
- **libSQL/SQLite** con Drizzle ORM; le tabelle (e le colonne nuove) si creano da sole all'avvio, senza migrazioni
- **OpenRouter** via `fetch`, output strutturati validati con Zod 4
- **Web Push** implementato senza librerie (VAPID + aes128gcm con `node:crypto`)
- **pdf.js** copiato in `public/pdfjs/` per il lettore PDF
- Open-Meteo (meteo) e Google News RSS (notizie), gratuiti e senza chiave
- Accesso con password unica e cookie firmato valido 90 giorni

## Avvio in locale

```bash
npm install
cp .env.example .env.local   # poi compila i valori
npm run dev
```

Apri <http://localhost:3000> ed entra con `APP_PASSWORD`. Con la memoria vuota, la Home offre **Carica dati di esempio**.

> **Progetto su Google Drive:** `npm install` si rompe (TAR_ENTRY_ERROR), Turbopack non riesce a creare i collegamenti e `npx` non funziona per lo spazio nel percorso. Per la build usa `node node_modules/next/dist/bin/next build --webpack`, per i controlli `node node_modules/typescript/bin/tsc --noEmit -p .`.

### Variabili d'ambiente

| Variabile | A cosa serve |
|---|---|
| `APP_PASSWORD` | Password di accesso |
| `SESSION_SECRET` | Chiave per firmare il cookie (almeno 16 caratteri casuali) |
| `DATABASE_URL` | Predefinito `file:data/second-brain.db` |
| `DATABASE_AUTH_TOKEN` | Solo se il database è remoto (Turso) |
| `OPENROUTER_API_KEY` | Chiave OpenRouter. Si può anche impostare dall'app (Impostazioni → IA), che ha la precedenza |
| `AI_MODEL` | Facoltativo: modello veloce predefinito. Gli altri modelli si scelgono dall'app |
| `AI_DATA_COLLECTION` | Facoltativo: `allow` ammette i fornitori che conservano i dati. La privacy si sceglie comunque dall'app |
| `FILES_DIR` | Facoltativo: cartella degli allegati, predefinito `data/files` |
| `PUSH_CONTACT` | Facoltativo: contatto (mailto: o URL) inviato ai servizi push |
| `OPENROUTER_URL` | Solo per i test: sostituisce l'indirizzo di OpenRouter con un server finto |

## Produzione

L'app gira su un VPS Ubuntu con aaPanel: servizio systemd `second-brain` su `127.0.0.1:3100`, dietro nginx con HTTPS (Let's Encrypt). Database e allegati stanno in `data/` sul server; la configurazione in `.env.local`, che il pacchetto di deploy non sovrascrive mai.

Il deploy carica un archivio del progetto (senza `node_modules`, `.next`, `data`, `.env.local`), poi sul server esegue `npm ci && npm run build && systemctl restart second-brain`.

## Struttura

```
src/lib/db/            schema (Drizzle) e creazione delle tabelle
src/lib/llm.ts         chiamate a OpenRouter: modello per compito, privacy, costi, tetto, ripiego
src/lib/ai.ts          prompt e schemi (classificazione, lettura file, comandi, sintesi, notizie)
src/lib/agent.ts       Assistente a passi con strumenti
src/lib/semantic.ts    ricerca per significato e ricerca ibrida
src/lib/proactive.ts   riepilogo del mattino e suggerimenti
src/lib/actions.ts     server actions: ogni modifica passa da qui
src/lib/queries.ts     letture
src/lib/api-core.ts    strumenti condivisi da API REST, MCP e Assistente
src/lib/push.ts        notifiche push, promemoria, giro del mattino
src/instrumentation.ts pianificatore (ogni minuto): promemoria, mattino, indice
src/app/(app)/…        pagine protette
src/app/api/…          ask (Assistente in streaming), capture, share, files, export/import, mcp, v1 (REST)
src/components/…       componenti condivisi (meteo, notizie, suggerimenti, lettore PDF, popup immagini…)
src/app/globals.css    stili dell'app; industry.css è il design system
```
