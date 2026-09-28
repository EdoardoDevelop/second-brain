import type { ReactNode } from "react";
import { PeopleList } from "./PeopleList";
import { getPeopleOverview } from "@/lib/queries";

export default async function PeopleLayout({ children }: { children: ReactNode }) {
  const people = await getPeopleOverview();
  return (
    <div className="stack-mobile" style={{ display: "grid", gridTemplateColumns: "320px minmax(0,1fr)", minHeight: "100%" }}>
      <PeopleList people={people.map((p) => ({ id: p.id, name: p.name, role: p.role, org: p.org, items: p.items }))} />
      {children}
    </div>
  );
}
