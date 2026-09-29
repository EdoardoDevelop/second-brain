import { desc, eq, inArray } from "drizzle-orm";
import { OverviewView } from "./OverviewView";
import { aiEnabled } from "@/lib/ai";
import { db } from "@/lib/db";
import { aims, items, projects } from "@/lib/db/schema";
import { cachedOverview, overviewCounts, recentOverviews } from "@/lib/overview";

export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const topic = ((await searchParams).t ?? "").trim().slice(0, 120);
  const [cached, recent, aiOn, ps, as, mem] = await Promise.all([
    topic ? cachedOverview(topic) : null,
    recentOverviews(),
    aiEnabled(),
    db.select({ name: projects.name }).from(projects).where(eq(projects.status, "Attivo")),
    db.select({ title: aims.title }).from(aims).where(inArray(aims.status, ["active", "paused"])),
    db.select({ tags: items.tags }).from(items).where(eq(items.status, "memory")).orderBy(desc(items.createdAt)).limit(200),
  ]);
  // Superato se oggi leggerebbe un numero diverso di elementi o attività.
  const now = cached ? await overviewCounts(topic).catch(() => null) : null;
  const stale = !!cached && !!now && (now.items !== cached.counts.items || now.tasks !== cached.counts.tasks);
  const tagCount = new Map<string, number>();
  for (const i of mem) for (const t of i.tags) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
  const suggestions = [
    ...ps.map((p) => p.name), ...as.map((a) => a.title),
    ...[...tagCount].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([t]) => "#" + t),
  ].slice(0, 10);
  return <OverviewView key={topic} topic={topic} initial={cached} stale={stale} recent={recent} suggestions={suggestions} aiOn={aiOn} />;
}
