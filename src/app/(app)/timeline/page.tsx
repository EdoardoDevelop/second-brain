import { TimelineView } from "./TimelineView";
import { getTimeline } from "@/lib/queries";

export default async function TimelinePage() {
  return <TimelineView events={await getTimeline()} />;
}
