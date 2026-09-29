/** All'avvio del server: controllo ogni minuto delle notifiche programmate (promemoria delle attività, riepilogo del mattino). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const g = globalThis as unknown as { __sbTimer?: NodeJS.Timeout };
  if (g.__sbTimer) return;
  const { dailyDigestTick, remindersTick } = await import("./lib/push");
  const { syncEmbeddings } = await import("./lib/semantic");
  const { gardenTick } = await import("./lib/garden");
  const { backupTick } = await import("./lib/backup");
  const { expireFacts } = await import("./lib/fact-question");
  const { checkinTick } = await import("./lib/checkin");
  const { ready } = await import("./lib/db");
  let n = 0;
  // Prima si aspetta il database (al primo avvio crea tabelle e colonne), poi i controlli.
  const tick = () => ready().then(() => {
    remindersTick().catch((e) => console.error("[promemoria]", e));
    dailyDigestTick().catch((e) => console.error("[notifiche]", e));
    // Di notte: cura della memoria (collegamenti, tag, doppioni da proporre).
    gardenTick().catch((e) => console.error("[cura]", e));
    // Di notte: copia del database e degli allegati nuovi in data/backups.
    backupTick().catch((e) => console.error("[backup]", e));
    // Una volta al giorno: i fatti con la data di fine passata diventano storia.
    expireFacts().catch((e) => console.error("[fatti]", e));
    // La sera: «Com'è andata oggi?», solo quando c'è un motivo.
    checkinTick().catch((e) => console.error("[diario]", e));
    // Ogni 10 minuti: impronte di significato mancanti (elementi nuovi o modificati).
    if (n++ % 10 === 0) syncEmbeddings().catch((e) => console.error("[indice]", e));
  }).catch((e) => console.error("[pianificatore]", e));
  g.__sbTimer = setInterval(tick, 60_000);
  setTimeout(tick, 5_000);
}
