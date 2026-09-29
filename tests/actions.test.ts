// Validazione delle azioni proposte dall'IA: niente id inventati, conversioni e limiti.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL = ":memory:";

const ctx = {
  today: "2026-09-29 (martedì)",
  projects: [{ id: "pr_a", name: "Alpha", status: "Attivo", pct: 10 }],
  people: [{ id: "pe_m", name: "Marco", role: "", org: "" }],
  tasks: [{ id: "ta_1", title: "Chiamare Marco", due: null, projectId: null, done: false }],
  goals: [{ id: "go_1", title: "Beta privata", projectId: "pr_a", done: false }],
  aims: [{ id: "ob_1", title: "Cambiare lavoro", status: "active", due: null }],
  items: [{ id: "it_1", type: "Nota", date: "2026-09-20", title: "Nota", tags: [] }, { id: "it_2", type: "Nota", date: "2026-09-21", title: "Altra", tags: [] }],
};

test("cleanActions: scarta gli id inesistenti e le azioni incomplete", async () => {
  const { cleanActions } = await import("../src/lib/ai");
  const out = cleanActions([
    { kind: "complete_task", label: "ok", taskId: "ta_1" },
    { kind: "complete_task", label: "inventata", taskId: "ta_999" },
    { kind: "add_task", label: "senza titolo", title: "  " },
    { kind: "update_item", label: "elemento inesistente", itemId: "it_999" },
  ], ctx);
  assert.deepEqual(out.map((a) => a.label), ["ok"]);
});

test("cleanActions: obiettivi personali e di progetto", async () => {
  const { cleanActions } = await import("../src/lib/ai");
  const out = cleanActions([
    { kind: "add_goal", label: "personale", title: "Imparare lo spagnolo", due: "2027-06-30" },
    { kind: "add_goal", label: "di progetto", title: "Lancio", projectId: "pr_a" },
    { kind: "add_task", label: "per l'obiettivo", title: "Aggiornare il CV", goalId: "ob_1" },
    // Un obiettivo di progetto non si usa come «obiettivo personale» di un'attività.
    { kind: "add_task", label: "goal di progetto", title: "Test", goalId: "go_1" },
    { kind: "update_goal", label: "modifica", goalId: "ob_1", status: "In pausa" },
    { kind: "update_goal", label: "non è un aim", goalId: "go_1", status: "In pausa" },
  ], ctx);
  assert.deepEqual(out.map((a) => a.label), ["personale", "di progetto", "per l'obiettivo", "goal di progetto", "modifica"]);
  assert.equal(out[2].goalId, "ob_1");
  assert.equal(out[3].goalId, null);
});

test("cleanActions: collegare a un progetto diventa update_item; date, orari e priorità ripuliti", async () => {
  const { cleanActions } = await import("../src/lib/ai");
  const [link, task] = cleanActions([
    { kind: "link_items", label: "collega al progetto", itemId: "it_1", targetId: "pr_a" },
    { kind: "add_task", label: "attività", title: "Preventivo", due: "venerdì", time: "25:00", prio: 7, remind: -5 },
  ], ctx);
  assert.equal(link.kind, "update_item");
  assert.equal(link.projectId, "pr_a");
  assert.equal(task.due, null);
  assert.equal(task.time, null);
  assert.equal(task.prio, 3);
  assert.equal(task.remind, 0);
});
