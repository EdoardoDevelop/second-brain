/** All'avvio del server: controllo ogni minuto delle notifiche programmate (promemoria delle attività, riepilogo del mattino). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const g = globalThis as unknown as { __sbTimer?: NodeJS.Timeout };
  if (g.__sbTimer) return;
  const { dailyDigestTick, remindersTick } = await import("./lib/push");
  const { syncEmbeddings } = await import("./lib/semantic");
  const { ready } = await import("./lib/db");
  let n = 0;
  // Prima si aspetta il database (al primo avvio crea tabelle e colonne), poi i controlli.
  const tick = () => ready().then(() => {
    remindersTick().catch((e) => console.error("[promemoria]", e));
    dailyDigestTick().catch((e) => console.error("[notifiche]", e));
    // Ogni 10 minuti: impronte di significato mancanti (elementi nuovi o modificati).
    if (n++ % 10 === 0) syncEmbeddings().catch((e) => console.error("[indice]", e));
  }).catch((e) => console.error("[pianificatore]", e));
  g.__sbTimer = setInterval(tick, 60_000);
  setTimeout(tick, 5_000);
}
