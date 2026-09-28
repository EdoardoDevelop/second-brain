import { ProjectsView } from "./ProjectsView";
import { getProjectsOverview } from "@/lib/queries";

export default async function ProjectsPage() {
  return <ProjectsView projects={await getProjectsOverview()} />;
}
