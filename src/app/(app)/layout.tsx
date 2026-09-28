import { AppShell } from "@/components/AppShell";
import { requireAuth } from "@/lib/auth";
import { getInboxCount } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireAuth();
  return <AppShell inboxCount={await getInboxCount()}>{children}</AppShell>;
}
