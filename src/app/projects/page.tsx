"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  FolderOpen,
  FileText,
  MessageSquare,
  MoreHorizontal,
  Search,
} from "lucide-react";

interface Project {
  id: string;
  name: string;
  description: string;
  papersCount: number;
  chatsCount: number;
  updatedAt: string;
  color: string;
}

const mockProjects: Project[] = [
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

export default function ProjectsPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");

  const filtered = mockProjects.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.description.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-7">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-[28px] text-espresso tracking-heading">
          Projects
        </h1>
        <button className="flex items-center gap-2 px-4 py-2.5 bg-orange text-white rounded-[10px] text-[14px] font-medium hover:bg-orange/90 transition-colors">
          <Plus size={16} />
          New Project
        </button>
      </div>
      <p className="text-[14px] text-muted-text tracking-body mt-1">
        Organize papers, chats, and notes into research projects.
      </p>

      {/* Search */}
      <div className="mt-5">
        <div className="flex items-center gap-2 bg-light-surface border border-border-warm rounded-[10px] px-3 py-2.5">
          <Search size={16} className="text-muted-text flex-shrink-0" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search projects..."
            className="flex-1 text-[14px] text-espresso placeholder:text-muted-text bg-transparent focus:outline-none"
          />
        </div>
      </div>

      {/* Project cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mt-6">
        {filtered.map((project) => (
          <div
            key={project.id}
            onClick={() => router.push(`/projects/${project.id}`)}
            className="bg-light-surface border border-border-warm/30 rounded-[14px] p-5 cursor-pointer hover:shadow-sm transition-all group"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div
                  className="w-9 h-9 rounded-[8px] flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: project.color + "18" }}
                >
                  <FolderOpen
                    size={18}
                    style={{ color: project.color }}
                  />
                </div>
                <h3 className="font-heading text-[16px] text-espresso tracking-heading-card leading-[1.35] line-clamp-2">
                  {project.name}
                </h3>
              </div>
              <button
                onClick={(e) => e.stopPropagation()}
                className="p-1 text-muted-text hover:text-espresso opacity-0 group-hover:opacity-100 transition-all"
              >
                <MoreHorizontal size={16} />
              </button>
            </div>

            <p className="text-[13px] text-muted-text leading-[1.5] mt-3 line-clamp-2">
              {project.description}
            </p>

            <div className="flex items-center gap-4 mt-4 pt-3 border-t border-border-warm/30">
              <span className="flex items-center gap-1.5 text-[12px] text-muted-text">
                <FileText size={13} />
                {project.papersCount} papers
              </span>
              <span className="flex items-center gap-1.5 text-[12px] text-muted-text">
                <MessageSquare size={13} />
                {project.chatsCount} chats
              </span>
              <span className="text-[12px] text-muted-text/60 ml-auto">
                {project.updatedAt}
              </span>
            </div>
          </div>
        ))}

        {/* New project card */}
        <button className="border-2 border-dashed border-border-warm/50 rounded-[14px] p-5 flex flex-col items-center justify-center gap-2 min-h-[180px] hover:border-orange/40 hover:bg-orange/[0.02] transition-colors group">
          <div className="w-10 h-10 rounded-full bg-card-surface flex items-center justify-center group-hover:bg-orange/10 transition-colors">
            <Plus size={20} className="text-muted-text group-hover:text-orange transition-colors" />
          </div>
          <span className="text-[14px] text-muted-text group-hover:text-espresso transition-colors">
            Create new project
          </span>
        </button>
      </div>
    </div>
  );
}
