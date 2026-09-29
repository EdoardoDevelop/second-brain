import { AimsView } from "./AimsView";
import { getAims } from "@/lib/queries";

export default async function AimsPage() {
  const list = await getAims();
  return <AimsView aims={list.map((a) => ({ ...a, createdAt: a.createdAt.getTime(), updatedAt: a.updatedAt.getTime(), doneAt: a.doneAt?.getTime() ?? null }))} />;
}
