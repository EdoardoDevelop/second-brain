import { GraphView } from "./GraphView";
import { getGraph } from "@/lib/queries";
import { getSetting } from "@/lib/settings";
import type { Positions } from "./layout-engine";

const parse = (raw: string | null): Positions => {
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
};

export default async function ConnectionsPage({ searchParams }: { searchParams: Promise<{ nodo?: string }> }) {
  const [graph, { nodo }, p2, p3] = await Promise.all([getGraph(), searchParams, getSetting("graph_pos_2d"), getSetting("graph_pos_3d")]);
  return <GraphView nodes={graph.nodes} edges={graph.edges} initialSelection={nodo ?? null} saved={{ "2d": parse(p2), "3d": parse(p3) }} />;
}
