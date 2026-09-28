import type { GraphEdge, GraphNode } from "@/lib/queries";

export type Vec = [number, number, number];
export type Positions = Record<string, Vec>;

/** Raggio d'ingombro di un nodo: in 2D conta anche l'etichetta, che è orizzontale e larga. */
function footprint(n: GraphNode, dim: 2 | 3) {
  const r = n.type === "project" ? 24 : 18;
  // In 3D le etichette non contano nell'ingombro, ma serve aria: in proiezione i nodi si avvicinano.
  if (dim === 3) return r + 58;
  return r + Math.min(n.label.length, 24) * 3.4 + 14;
}

/** Punto i-esimo di n distribuiti in modo uniforme su una sfera (o su un cerchio in 2D). */
function spread(i: number, n: number, radius: number, dim: 2 | 3): Vec {
  if (dim === 2) {
    const a = i * 2.39996;
    const r = radius * Math.sqrt((i + 0.5) / Math.max(n, 1));
    return [Math.cos(a) * r, Math.sin(a) * r, 0];
  }
  const y = 1 - (2 * (i + 0.5)) / Math.max(n, 1);
  const rr = Math.sqrt(1 - y * y);
  const a = i * 2.39996;
  const r = radius * Math.cbrt((i + 0.5) / Math.max(n, 1));
  return [Math.cos(a) * rr * r, y * r, Math.sin(a) * rr * r];
}

/**
 * Disposizione a forze in 2D o 3D. I nodi in `fixed` restano dove sono (posizioni salvate o spostate a mano);
 * gli altri si sistemano attorno. Con `byType` ogni tipo tende verso una propria zona.
 */
export function computeLayout(nodes: GraphNode[], edges: GraphEdge[], dim: 2 | 3, fixed: Positions = {}, byType = false): Positions {
  const n = nodes.length;
  if (!n) return {};
  const idx = new Map(nodes.map((d, i) => [d.id, i]));
  const pinned = nodes.map((d) => !!fixed[d.id]);
  const rad = nodes.map((d) => footprint(d, dim));
  const E = edges.map((e) => [idx.get(e.a), idx.get(e.b)] as const).filter((e): e is readonly [number, number] => e[0] != null && e[1] != null);
  const nbrs: number[][] = nodes.map(() => []);
  for (const [a, b] of E) { nbrs[a]!.push(b); nbrs[b]!.push(a); }
  const deg = nbrs.map((x) => x.length);

  // Zone dei tipi (solo per "raggruppa per tipo").
  const types = [...new Set(nodes.map((d) => d.type))];
  const R0 = 90 * Math.sqrt(n) + 120;
  const anchor = new Map(types.map((t, i) => [t, spread(i, types.length, R0 * 1.1, dim)]));

  // Posizioni iniziali: fissi dove sono; i nuovi vicino a un vicino già piazzato, altrimenti distribuiti.
  const P: Vec[] = new Array(n);
  const free: number[] = [];
  nodes.forEach((d, i) => { if (pinned[i]) P[i] = [...fixed[d.id]!] as Vec; else free.push(i); });
  free.forEach((i, k) => {
    const near = nbrs[i]!.find((j) => P[j]);
    const jitter = spread(k + 1, free.length + 1, 60, dim);
    if (near != null) { const q = P[near]!; P[i] = [q[0] + jitter[0] + 40, q[1] + jitter[1], q[2] + jitter[2]]; }
    else if (byType) { const a = anchor.get(nodes[i]!.type)!; P[i] = [a[0] + jitter[0] * 2, a[1] + jitter[1] * 2, a[2] + jitter[2] * 2]; }
    else P[i] = spread(k, free.length, R0, dim);
  });
  if (!free.length) return Object.fromEntries(nodes.map((d, i) => [d.id, P[i]!]));

  const V: Vec[] = P.map(() => [0, 0, 0]);
  const iters = n > 400 ? 220 : n > 150 ? 320 : 420;
  const rest = dim === 3 ? 230 : 170;
  const D = dim === 3 ? 3 : 2;

  for (let it = 0; it < iters; it++) {
    const cool = 1 - it / iters;
    // Repulsione.
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const d: Vec = [P[i]![0] - P[j]![0], P[i]![1] - P[j]![1], P[i]![2] - P[j]![2]];
        let d2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
        if (d2 < 1) { d[0] = ((i % 7) - 3) || 1; d[1] = ((j % 5) - 2) || 1; d[2] = dim === 3 ? ((i + j) % 3) - 1 : 0; d2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2]; }
        if (d2 > 900 * 900) continue;
        const f = (dim === 3 ? 30000 : 14000) / d2;
        const dl = Math.sqrt(d2);
        for (let k = 0; k < D; k++) { V[i]![k] += (d[k]! / dl) * f; V[j]![k] -= (d[k]! / dl) * f; }
      }
    }
    // Molle sugli archi.
    for (const [a, b] of E) {
      const d: Vec = [P[b]![0] - P[a]![0], P[b]![1] - P[a]![1], P[b]![2] - P[a]![2]];
      const dl = Math.hypot(d[0], d[1], d[2]) || 1;
      const f = (dl - rest) * 0.035;
      for (let k = 0; k < D; k++) {
        V[a]![k] += (d[k]! / dl) * f / Math.sqrt(deg[a]!);
        V[b]![k] -= (d[k]! / dl) * f / Math.sqrt(deg[b]!);
      }
    }
    // Gravità verso il centro o verso la zona del tipo; aggiornamento delle posizioni dei nodi liberi.
    for (let i = 0; i < n; i++) {
      if (pinned[i]) { V[i] = [0, 0, 0]; continue; }
      const target = byType ? anchor.get(nodes[i]!.type)! : ([0, 0, 0] as Vec);
      const g = byType ? 0.05 : 0.008;
      for (let k = 0; k < D; k++) V[i]![k] -= (P[i]![k]! - target[k]!) * g;
      const sp = Math.hypot(V[i]![0], V[i]![1], V[i]![2]) || 1;
      const s = Math.min(1, 28 / sp) * cool;
      for (let k = 0; k < D; k++) { P[i]![k] += V[i]![k]! * s; V[i]![k] *= 0.5; }
    }
    // Collisioni: nessuna sovrapposizione tra nodi (ed etichette, in 2D).
    if (it > iters * 0.4) {
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          if (pinned[i] && pinned[j]) continue;
          const d: Vec = [P[i]![0] - P[j]![0], P[i]![1] - P[j]![1], P[i]![2] - P[j]![2]];
          let overlap: number;
          if (dim === 2) {
            // Ingombro rettangolare: le etichette sono larghe e basse.
            const ox = (rad[i]! + rad[j]!) - Math.abs(d[0]);
            const oy = 62 - Math.abs(d[1]);
            if (ox <= 0 || oy <= 0) continue;
            // Si separa lungo l'asse che richiede meno spostamento.
            const axis = oy < ox ? 1 : 0;
            overlap = axis === 1 ? oy : ox;
            const sign = Math.sign(d[axis]!) || (i < j ? 1 : -1);
            const move = overlap / (pinned[i] || pinned[j] ? 1 : 2);
            if (!pinned[i]) P[i]![axis] += sign * move;
            if (!pinned[j]) P[j]![axis] -= sign * move;
            continue;
          }
          const dl = Math.hypot(d[0], d[1], d[2]) || 1;
          overlap = rad[i]! + rad[j]! - dl;
          if (overlap <= 0) continue;
          const move = overlap / (pinned[i] || pinned[j] ? 1 : 2);
          for (let k = 0; k < 3; k++) {
            if (!pinned[i]) P[i]![k] += (d[k]! / dl) * move;
            if (!pinned[j]) P[j]![k] -= (d[k]! / dl) * move;
          }
        }
      }
    }
  }
  return Object.fromEntries(nodes.map((d, i) => [d.id, P[i]!.map((v) => Math.round(v * 10) / 10) as Vec]));
}
