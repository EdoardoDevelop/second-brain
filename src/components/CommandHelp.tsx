"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui";
import type { IconName } from "@/lib/icons";

type Row = { icon: IconName; what: string; detail: string; examples: string[] };
type Group = { title: string; rows: Row[] };

/** Informativa dei comandi che l'IA sa eseguire. Tenere allineata a COMMAND_KINDS in lib/ai.ts. */
const GROUPS: Group[] = [
  {
    title: "Catture e domande",
    rows: [
      { icon: "inbox", what: "Cattura in Inbox", detail: "Note, idee, resoconti. Passano dall'Inbox: la classificazione va confermata.", examples: ["Annota che il fornitore consegna a fine ottobre", "Idea: newsletter mensile per i clienti"] },
      { icon: "search", what: "Domanda alla memoria", detail: "Solo nell'Assistente. Risponde citando le fonti, senza modificare nulla.", examples: ["Cosa abbiamo deciso sul budget di Alpha?", "Cosa devo fare questa settimana?"] },
    ],
  },
  {
    title: "Attività",
    rows: [
      { icon: "tasks", what: "Nuova attività", detail: "Con scadenza (anche relativa: domani, venerdì), orario, promemoria, progetto e priorità.", examples: ["Ricordami di chiamare Marco venerdì alle 15", "Domani alle 9 riunione con Giulia, avvisami mezz'ora prima", "Attività urgente per il progetto Alpha: inviare il preventivo entro domani"] },
      { icon: "check", what: "Completa attività", detail: "Solo attività esistenti.", examples: ["Ho finito di inviare il preventivo"] },
      { icon: "refresh", what: "Riapri attività", detail: "Tra le ultime 30 completate.", examples: ["Riapri l'attività del preventivo"] },
      { icon: "calendar", what: "Cambia scadenza o orario", detail: "Il promemoria si sposta con la scadenza.", examples: ["Sposta la chiamata a Marco a lunedì alle 10", "Aggiungi un promemoria alle 18 per l'attività del preventivo"] },
      { icon: "edit", what: "Modifica attività", detail: "Titolo, progetto, priorità, scadenza.", examples: ["Rinomina «chiamare Marco» in «call con Marco e Giulia»", "Metti l'attività del preventivo nel progetto Beta, priorità bassa"] },
      { icon: "trash", what: "Elimina attività", detail: "", examples: ["Elimina l'attività di prenotare la sala"] },
    ],
  },
  {
    title: "Progetti e persone",
    rows: [
      { icon: "folder", what: "Nuovo progetto", detail: "Con stato, avanzamento, milestone e descrizione.", examples: ["Crea il progetto Sito nuovo, prossima milestone il mockup"] },
      { icon: "folder", what: "Modifica progetto", detail: "Stato (Attivo, In pausa, Chiuso), avanzamento, milestone, descrizione.", examples: ["Metti Alpha al 60%", "Metti in pausa il progetto Beta"] },
      { icon: "target", what: "Obiettivi personali", detail: "Un risultato che vuoi raggiungere, anche fuori dai progetti: crealo con una scadenza, collegaci attività e note, segnalo raggiunto o mettilo in pausa.", examples: ["Il mio obiettivo è cambiare lavoro entro marzo", "Aggiungi l'attività aggiornare il CV per l'obiettivo cambiare lavoro", "Metti in pausa l'obiettivo della maratona"] },
      { icon: "target", what: "Obiettivi del progetto", detail: "Aggiungi, segna come raggiunto, riapri o elimina un obiettivo.", examples: ["Aggiungi al progetto Casa l'obiettivo: finire la ristrutturazione entro marzo", "Abbiamo raggiunto l'obiettivo del preventivo firmato"] },
      { icon: "user", what: "Crea o modifica persona", detail: "Ruolo, organizzazione, email, note (le note si aggiungono a quelle esistenti).", examples: ["Giulia Bianchi è la nuova responsabile acquisti di Acme", "Aggiungi a Marco: preferisce essere contattato via email"] },
    ],
  },
  {
    title: "Elementi della memoria",
    rows: [
      { icon: "edit", what: "Modifica elemento", detail: "Titolo, sintesi, progetto, tag da aggiungere o togliere, persone da collegare.", examples: ["Collega il documento planimetria casa al progetto Casa", "Nella nota della riunione Alpha aggiungi il tag budget e collega Marco", "Togli il tag bozza dal documento del contratto"] },
      { icon: "note", what: "Aggiungi all'elemento", detail: "Accoda testo al contenuto di un elemento esistente.", examples: ["Aggiungi alla nota della riunione che il budget è approvato"] },
      { icon: "archive", what: "Archivia elemento", detail: "", examples: ["Archivia la nota sul vecchio fornitore"] },
      { icon: "star", what: "Preferiti", detail: "Aggiunge o toglie dai preferiti.", examples: ["Metti tra i preferiti il documento del contratto", "Togli dai preferiti la nota sul vecchio fornitore"] },
      { icon: "link", what: "Collega elementi", detail: "Collegamento semplice o in conflitto (se si contraddicono).", examples: ["Collega la riunione di ieri al preventivo", "Il verbale di lunedì contraddice il preventivo sulle date"] },
    ],
  },
];

/** Pulsante «?» che apre l'informativa. onPick riceve l'esempio cliccato. */
export function CommandHelpButton({ onPick }: { onPick?: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-secondary btn-icon" onClick={() => setOpen(true)} title="Comandi disponibili" aria-label="Comandi disponibili" style={{ fontWeight: 700 }}>?</button>
      {open && <CommandHelp onClose={() => setOpen(false)} onPick={onPick && ((t) => { onPick(t); setOpen(false); })} />}
    </>
  );
}

export function CommandHelp({ onClose, onPick }: { onClose: () => void; onPick?: (text: string) => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopImmediatePropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div className="sb-scrim" onClick={(e) => { e.stopPropagation(); onClose(); }} style={{ position: "fixed", inset: 0, zIndex: 70, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "6vh" }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Comandi disponibili" className="blueprint sb-dialog" style={{ width: "min(860px,94vw)", maxHeight: "86vh", display: "flex", flexDirection: "column", background: "var(--raised)", boxShadow: "var(--shadow-lg)" }}>
        <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: "1px solid var(--color-divider)" }}>
          <span style={{ color: "var(--accent-text)" }}><Icon name="ai" /></span>
          <h4 style={{ margin: 0, fontSize: 18, flex: 1 }}>Comandi disponibili</h4>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Chiudi"><Icon name="x" /></button>
        </div>
        <div style={{ overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 20 }}>
          <p className="muted" style={{ margin: 0, fontSize: 14 }}>
            Scrivi o detta in linguaggio naturale, anche più richieste insieme. L'IA propone le azioni come schede: nulla viene salvato senza la tua conferma.
            {onPick && " Tocca un esempio per usarlo."}
          </p>
          {GROUPS.map((g) => (
            <section key={g.title} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div className="eyebrow muted">{g.title}</div>
              <table className="cmd-help">
                <thead><tr><th>Comando</th><th>Esempi</th></tr></thead>
                <tbody>
                  {g.rows.map((r) => (
                    <tr key={r.what}>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600 }}><span style={{ color: "var(--accent-text)", display: "flex" }}><Icon name={r.icon} size={16} /></span>{r.what}</div>
                        {r.detail && <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>{r.detail}</div>}
                      </td>
                      <td>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          {r.examples.map((ex) =>
                            onPick ? (
                              <button key={ex} type="button" className="cmd-example" onClick={() => onPick(ex)}>«{ex}»</button>
                            ) : (
                              <span key={ex} className="cmd-example">«{ex}»</span>
                            ),
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            L'IA riconosce i 300 elementi della memoria più recenti, tutti i progetti, le persone e le attività aperte. Se un riferimento è ambiguo, propone una semplice cattura in Inbox.
          </p>
        </div>
      </div>
    </div>
  );
}
