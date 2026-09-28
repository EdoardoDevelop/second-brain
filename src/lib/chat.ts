// Tipi dell'Assistente condivisi tra server (route /api/ask, conversazioni salvate) e client.
import type { CommandAction } from "./ai";
import type { ItemKind } from "./db/schema";

export type Source = { id: string; title: string; type: string | null; kind: ItemKind; date: string };

/**
 * Risposta in testo semplice con paragrafi separati da una riga vuota ed elenchi "- ".
 * Le citazioni nel testo sono ⟦id⟧ (id di un elemento in `sources`).
 */
export type ChatAnswer = {
  text: string; note: string; sources: Source[]; read: number;
  /** Domande successive suggerite. */
  followUps?: string[];
  /** Passi fatti per trovare la risposta ("Cerco «…»", "Leggo «…»"). */
  steps?: string[];
  model?: string; cost?: number;
  /** Risposta ottenuta con «Pensa meglio» (modello più potente). */
  expert?: boolean;
};

/** Fatto sull'utente proposto dall'IA, da confermare. */
/** Fatto proposto dall'IA: se contraddice fatti già noti, `replaces` li indica (confermando diventano storia). */
export type ProposedFact = { text: string; replaces: { id: string; text: string }[] };
export type FactCard = ProposedFact & { state: "review" | "saved" | "discarded" };
/** Formato delle risposte salvate prima dello streaming (27/9). */
export type LegacyAnswer = { paragraphs: string[]; list: string[]; after: string; note: string; sources: Source[]; read: number };

export type Card = CommandAction & { on: boolean };
export type CmdState = "review" | "saving" | "done" | "discarded";

export type Reply = {
  role: "assistant";
  answer: ChatAnswer | LegacyAnswer | null;
  /** Mentre la risposta arriva: testo parziale e passo corrente. */
  streaming?: boolean;
  step?: number;
  cards: Card[];
  names: Record<string, string>;
  cmd: CmdState;
  doneCount: number;
  scope: string;
  /** Passi in corso (durante lo streaming). */
  tools?: string[];
  facts?: FactCard[];
  /** Domanda a cui risponde (per «Pensa meglio» e «Salva in memoria»). */
  question?: string;
};
export type ChatMsg = { role: "user"; text: string; voice?: boolean; expert?: boolean } | Reply | { role: "error"; text: string };

/** Eventi della risposta in streaming (una riga JSON per evento). */
export type AskEvent =
  | { type: "step"; step: number; read?: number }
  | { type: "delta"; text: string }
  | { type: "answer"; answer: ChatAnswer }
  | { type: "command"; actions: CommandAction[]; names: Record<string, string> }
  | { type: "scope"; scope: string }
  | { type: "tool"; label: string }
  | { type: "reset" }
  | { type: "facts"; facts: ProposedFact[] }
  | { type: "error"; error: string }
  | { type: "done" };

export type ChatSummary = { id: string; title: string; updatedAt: number };

/** Testo di una risposta, per la cronologia passata all'IA. */
export function answerText(a: ChatAnswer | LegacyAnswer): string {
  if ("text" in a) return a.text;
  return [...a.paragraphs, ...a.list.map((l) => "- " + l), a.after].filter(Boolean).join("\n");
}
