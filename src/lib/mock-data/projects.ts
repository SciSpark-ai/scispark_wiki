export interface Project {
  id: string;
  name: string;
  description: string;
  papersCount: number;
  chatsCount: number;
  updatedAt: string;
  color: string;
}

export const mockProjects: Project[] = [
  {
    id: "proj-1",
    name: "Psilocybin for Treatment-Resistant Depression",
    description:
      "Collecting evidence on psilocybin-assisted therapy efficacy, safety profiles, and neuroimaging findings.",
    papersCount: 8,
    chatsCount: 3,
    updatedAt: "2 hours ago",
    color: "#e87b35",
  },
  {
    id: "proj-2",
    name: "DBS Targets in OCD",
    description:
      "Reviewing deep brain stimulation target sites, outcomes, and emerging protocol optimizations for OCD.",
    papersCount: 5,
    chatsCount: 2,
    updatedAt: "1 day ago",
    color: "#6366f1",
  },
  {
    id: "proj-3",
    name: "Gut-Brain Axis & Probiotics",
    description:
      "Exploring microbiome interventions and their effects on mood disorders and cognitive function.",
    papersCount: 12,
    chatsCount: 4,
    updatedAt: "3 days ago",
    color: "#10b981",
  },
];
