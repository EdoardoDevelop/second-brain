import "server-only";
import zlib from "node:zlib";

/** SKILL.md per Claude: quando e come usare Second Brain tramite l'API REST. */
export function skillMarkdown(base: string, key: string | null, name: string) {
  const who = name || "l'utente";
  const auth = key ? `Authorization: Bearer ${key}` : "Authorization: Bearer $SECOND_BRAIN_KEY";
  return `---
name: second-brain
description: Memoria personale "Second Brain" di ${who} — note, documenti, decisioni, riunioni, progetti con obiettivi, persone, attività con scadenze e promemoria. Usala quando ${who} chiede dei suoi impegni, progetti, persone o appunti passati ("cosa devo fare oggi?", "cosa abbiamo deciso su…?", "chi è…?"), o vuole salvare qualcosa, creare o completare attività e promemoria.
---

# Second Brain

Second Brain è la memoria personale di ${who}. Prima di rispondere a domande sulla sua vita, sul lavoro, sui progetti o sugli impegni, **cerca qui** invece di rispondere a memoria. Rivolgiti a ${who} in modo amichevole, con il tu.

## Accesso

- Base: \`${base}/api/v1\`
- Header: \`${auth}\`${key ? "" : "\n- La chiave si crea in Second Brain → Impostazioni → Integrazioni. Mettila nella variabile d'ambiente `SECOND_BRAIN_KEY`."}
- Risposte in JSON. Date \`YYYY-MM-DD\`, orari \`HH:MM\`, fuso Europe/Rome.

Esempio:

\`\`\`bash
curl -s "${base}/api/v1/today" -H "${auth}"
curl -s "${base}/api/v1/search?query=planimetria" -H "${auth}"
curl -s -X POST "${base}/api/v1/tasks" -H "${auth}" -H "Content-Type: application/json" \\
  -d '{"title":"Chiamare Marco","due":"2026-10-02","time":"15:00","reminder":0}'
\`\`\`

## Endpoint

| Metodo e percorso | A cosa serve |
|---|---|
| \`GET /today\` | La giornata: attività scadute, di oggi e dei prossimi 7 giorni, catture da confermare, obiettivi aperti. Parti da qui per "cosa devo fare?". |
| \`GET /search?query=…&limit=10\` | Ricerca nella memoria (titolo, tipo, data, sintesi, tag, progetto, persone). |
| \`GET /items/{id}\` | Contenuto completo di un elemento, con collegamenti e allegati. |
| \`GET /items?limit=10&type=Decisione\` | Elementi recenti, anche per tipo (Nota, Idea, Decisione, Riunione, Documento, Pagina web, Attività). |
| \`POST /ask\` \`{question, scope?}\` | Risposta dell'assistente di Second Brain con le fonti. Ambito: \`all\`, \`recent\`, \`project:<id>\`, \`person:<id>\`. |
| \`POST /capture\` \`{text, title?}\` | Salva una nota, un'idea o un link in Inbox: ${who} la conferma nell'app. |
| \`GET /tasks?status=open\\|done\\|all&projectId=…\` | Attività. |
| \`POST /tasks\` \`{title, due?, time?, reminder?, projectId?, priority?}\` | Nuova attività; \`reminder\` = minuti di anticipo della notifica (0 = all'orario). \`priority\`: alta, media, bassa. |
| \`PATCH /tasks/{id}\` \`{done?, title?, due?, time?, reminder?, priority?, projectId?}\` | Completa o modifica un'attività. |
| \`GET /projects\`, \`GET /projects/{id}\` | Progetti; il dettaglio include obiettivi, attività, documenti, persone e la sintesi "Cosa dovresti sapere". |
| \`GET /people?query=…\`, \`GET /people/{id}\` | Persone; il dettaglio include elementi, progetti e la "Relazione in breve". |
| \`POST /command\` \`{text, execute?}\` | Comando in italiano come nella barra dell'app (obiettivi, modifiche e collegamenti tra elementi, progetti, persone…). Con \`execute\` assente o false restituisce solo le azioni proposte. |

## Regole

1. **Leggere è sempre ok.** Per domande di sintesi usa \`/ask\`; per trovare elementi specifici \`/search\` e poi \`/items/{id}\`.
2. **Prima di modificare dati chiedi conferma** a ${who}: descrivi cosa farai (per \`/command\` mostra le azioni proposte), poi esegui (\`execute: true\`).
3. **Le catture passano dall'Inbox**: dopo \`/capture\` ricorda che la conferma avviene nell'app.
4. Converti le date relative ("venerdì", "domani") in \`YYYY-MM-DD\` rispetto a oggi (lo trovi in \`/today\`).
5. Cita i titoli degli elementi usati, così ${who} li ritrova.
6. Se ricevi 401 la chiave manca o è revocata; con 403 è in sola lettura.
`;
}

/** Zip minimale (senza compressione) con i file indicati. */
export function zip(files: { name: string; data: Buffer }[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const crc = zlib.crc32(f.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 10); local.writeUInt32LE(crc, 14); local.writeUInt32LE(f.data.length, 18); local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    parts.push(local, name, f.data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(0, 10);
    c.writeUInt32LE(0, 12); c.writeUInt32LE(crc, 16); c.writeUInt32LE(f.data.length, 20); c.writeUInt32LE(f.data.length, 24);
    c.writeUInt16LE(name.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += 30 + name.length + f.data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}
