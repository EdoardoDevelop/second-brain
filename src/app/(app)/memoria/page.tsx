import { inspectorData } from "@/lib/actions";
import { MemoryInspector } from "./MemoryInspector";

export default async function MemoryPage() {
  const data = await inspectorData();
  return <MemoryInspector initial={data} />;
}
