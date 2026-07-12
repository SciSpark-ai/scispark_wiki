"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ChevronLeft,
  FileText,
  MessageSquare,
  StickyNote,
  Plus,
  ExternalLink,
  Trash2,
  MoreHorizontal,
  FolderOpen,
  Sparkles,
  Upload,
  Settings,
} from "lucide-react";
import { StarsRating } from "@/components/shared/StarsRating";
import { ShareButton } from "@/components/shared/ShareButton";
import { NoteCard } from "@/components/notes/NoteCard";
import { useNotesStore } from "@/stores/notes-store";

type Tab = "papers" | "chats" | "notes";

interface ProjectPaper {
  id: string;
  title: string;
  journal: string;
  year: number;
  rating: number;
  addedAt: string;
  tags: string[];
}

interface ProjectChat {
  id: string;
  title: string;
  preview: string;
  date: string;
  messageCount: number;
}

interface ProjectNote {
  id: string;
  title: string;
  content: string;
  updatedAt: string;
}

interface ProjectDetail {
  id: string;
  name: string;
  description: string;
  color: string;
  createdAt: string;
  papers: ProjectPaper[];
  chats: ProjectChat[];
  notes: ProjectNote[];
  instructions: string;
}

const mockProjectDetail: Record<string, ProjectDetail> = {
  "proj-1": {
    id: "proj-1",
    name: "Psilocybin for Treatment-Resistant Depression",
    description:
      "Collecting evidence on psilocybin-assisted therapy efficacy, safety profiles, and neuroimaging findings.",
    color: "#e87b35",
    createdAt: "Mar 15, 2025",
    instructions:
      "Focus on RCTs with sample size > 50. Prioritize studies with neuroimaging substudies. Flag any safety concerns or contraindications. Summarize in clinical language suitable for a department presentation.",
    papers: [
      {
        id: "paper-001",
        title:
          "Psilocybin-Assisted Therapy Achieves Rapid Remission in Treatment-Resistant Depression",
        journal: "JAMA Psychiatry",
        year: 2025,
        rating: 5,
        addedAt: "Mar 16, 2025",
        tags: ["Key paper", "RCT"],
      },
      {
        id: "p-2",
        title:
          "Psilocybin vs Escitalopram for Major Depressive Disorder: A Phase II Double-Blind Comparison",
        journal: "New England Journal of Medicine",
        year: 2024,
        rating: 5,
        addedAt: "Mar 17, 2025",
        tags: ["Head-to-head", "RCT"],
      },
      {
        id: "p-3",
        title:
          "Default Mode Network Changes After Psilocybin: A Systematic Review of fMRI Studies",
        journal: "Neuroscience & Biobehavioral Reviews",
        year: 2024,
        rating: 4,
        addedAt: "Mar 18, 2025",
        tags: ["Neuroimaging", "Review"],
      },
      {
        id: "p-4",
        title:
          "Long-Term Safety of Psilocybin-Assisted Therapy: 12-Month Follow-Up of Three Clinical Trials",
        journal: "The Lancet Psychiatry",
        year: 2025,
        rating: 4,
        addedAt: "Mar 20, 2025",
        tags: ["Safety", "Follow-up"],
      },
      {
        id: "p-5",
        title:
          "Predictors of Psilocybin Response: Baseline DMN Connectivity and Mystical Experience Scores",
        journal: "Biological Psychiatry",
        year: 2025,
        rating: 4,
        addedAt: "Mar 22, 2025",
        tags: ["Predictors", "Neuroimaging"],
      },
      {
        id: "p-6",
        title:
          "Psilocybin Therapy in Older Adults with Treatment-Resistant Depression: A Pilot RCT",
        journal: "American Journal of Geriatric Psychiatry",
        year: 2024,
        rating: 3,
        addedAt: "Mar 25, 2025",
        tags: ["Elderly", "Pilot"],
      },
      {
        id: "p-7",
        title:
          "Cost-Effectiveness of Psilocybin-Assisted Therapy vs Standard Antidepressants for TRD",
        journal: "JAMA Network Open",
        year: 2025,
        rating: 4,
        addedAt: "Apr 1, 2025",
        tags: ["Health economics"],
      },
      {
        id: "p-8",
        title:
          "Microdosing vs Macrodosing Psilocybin for Depression: A Meta-Analysis",
        journal: "Psychopharmacology",
        year: 2025,
        rating: 3,
        addedAt: "Apr 2, 2025",
        tags: ["Meta-analysis", "Dosing"],
      },
    ],
    chats: [
      {
        id: "chat-p1",
        title: "How effective is psilocybin therapy for treatment-resistant depression?",
        preview:
          "Based on the papers in this project, psilocybin shows a remission rate of 37.5% at 8 weeks...",
        date: "2 hours ago",
        messageCount: 12,
      },
      {
        id: "chat-p2",
        title: "Compare neuroimaging findings across the psilocybin studies",
        preview:
          "Three of the papers report fMRI substudies. The consistent finding is increased DMN entropy...",
        date: "1 day ago",
        messageCount: 8,
      },
      {
        id: "chat-p3",
        title: "Summarize safety concerns for my department presentation",
        preview:
          "Across 4 trials totaling ~800 participants, the most common adverse events were transient anxiety (38-42%)...",
        date: "3 days ago",
        messageCount: 6,
      },
    ],
    notes: [
      {
        id: "note-1",
        title: "Key takeaways for presentation",
        content:
          "1. Psilocybin 25mg single-dose produces durable remission (~37%) at 8wk\n2. Effect mediated by DMN entropy increase — correlates with mystical experience\n3. Safety profile favorable: no SAEs, transient AEs resolve in session\n4. Cost-effectiveness superior to 3rd-line antidepressants\n5. Need more data on elderly populations (only 1 pilot)",
        updatedAt: "2 hours ago",
      },
      {
        id: "note-2",
        title: "Questions for Dr. Carhart-Harris",
        content:
          "- What is the minimum therapist training needed for supervised sessions?\n- Are there biomarkers that predict non-response?\n- Plans for phase IV / real-world evidence studies?\n- View on microdosing protocols as maintenance therapy?",
        updatedAt: "1 day ago",
      },
      {
        id: "note-3",
        title: "Gaps in the literature",
        content:
          "- No head-to-head vs ketamine/esketamine\n- Limited data in comorbid anxiety + TRD\n- No studies in adolescents\n- Long-term (>12mo) durability unknown\n- Interaction with ongoing SSRIs poorly characterized",
        updatedAt: "3 days ago",
      },
    ],
  },
};

export default function ProjectDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;
  const [activeTab, setActiveTab] = useState<Tab>("chats");
  const [autoOpenNoteId, setAutoOpenNoteId] = useState<string | null>(null);

  const allNotes = useNotesStore((s) => s.notes);
  const notes = useMemo(
    () => allNotes.filter((n) => n.projectId === id),
    [allNotes, id]
  );
  const addNote = useNotesStore((s) => s.addNote);

  const project = mockProjectDetail[id];

  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-[16px] text-espresso">Project not found.</p>
        <button
          onClick={() => router.push("/projects")}
          className="flex items-center gap-1.5 text-[14px] text-muted-text hover:text-espresso transition-colors"
        >
          <ChevronLeft size={16} />
          Back to Projects
        </button>
      </div>
    );
  }

  const tabs: { id: Tab; label: string; icon: typeof FileText; count: number }[] = [
    { id: "chats", label: "Chats", icon: MessageSquare, count: project.chats.length },
    { id: "notes", label: "Notes", icon: StickyNote, count: notes.length },
    { id: "papers", label: "Papers", icon: FileText, count: project.papers.length },
  ];

  function handleAdd() {
    if (activeTab === "notes") {
      const newId = addNote({
        projectId: id,
        title: "",
        content: "",
        source: { kind: "manual" },
      });
      setAutoOpenNoteId(newId);
    }
  }

  return (
    <div className="flex h-full">
      {/* Main content */}
      <div className="flex-1 overflow-y-auto p-7">
        {/* Back */}
        <button
          onClick={() => router.push("/projects")}
          className="flex items-center gap-1.5 text-[14px] text-muted-text hover:text-espresso transition-colors mb-5"
        >
          <ChevronLeft size={16} />
          Projects
        </button>

        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4">
            <div
              className="w-11 h-11 rounded-[10px] flex items-center justify-center flex-shrink-0 mt-0.5"
              style={{ backgroundColor: project.color + "18" }}
            >
              <FolderOpen size={22} style={{ color: project.color }} />
            </div>
            <div>
              <h1 className="font-heading text-[26px] text-espresso tracking-heading leading-[1.2]">
                {project.name}
              </h1>
              <p className="text-[14px] text-muted-text tracking-body mt-1">
                {project.description}
              </p>
              <p className="text-[12px] text-muted-text/60 mt-1.5">
                Created {project.createdAt} · {project.papers.length} papers · {project.chats.length} chats · {notes.length} notes
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <ShareButton variant="ghost" title={`${project.name} · SciSpark project`} />
            <button className="p-2 text-muted-text hover:text-espresso transition-colors rounded-[8px] hover:bg-card-surface/50">
              <Settings size={18} />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 mt-6 border-b border-border-warm/30">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2.5 text-[14px] transition-colors relative ${
                  activeTab === tab.id
                    ? "text-espresso font-medium"
                    : "text-muted-text hover:text-espresso"
                }`}
              >
                <Icon size={15} />
                {tab.label}
                <span className={`text-[12px] px-1.5 py-0.5 rounded-full ${
                  activeTab === tab.id
                    ? "bg-orange/10 text-orange"
                    : "bg-card-surface text-muted-text"
                }`}>
                  {tab.count}
                </span>
                {activeTab === tab.id && (
                  <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-orange rounded-full" />
                )}
              </button>
            );
          })}

          <div className="ml-auto">
            <button
              onClick={handleAdd}
              className="flex items-center gap-1.5 px-3 py-2 text-[13px] text-orange hover:text-orange/80 transition-colors"
            >
              <Plus size={14} />
              Add {activeTab === "papers" ? "Paper" : activeTab === "chats" ? "Chat" : "Note"}
            </button>
          </div>
        </div>

        {/* Tab content */}
        <div className="mt-4">
          {activeTab === "papers" && (
            <div className="space-y-0">
              {project.papers.map((paper) => (
                <div
                  key={paper.id}
                  onClick={() => router.push(`/paper/${paper.id}`)}
                  className="flex items-center gap-4 py-3.5 border-b border-border-warm/20 cursor-pointer hover:bg-light-surface/50 transition-colors px-3 -mx-3 rounded-[8px] group"
                >
                  <FileText size={16} className="text-muted-text flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[15px] text-espresso leading-[1.35] line-clamp-1">
                      {paper.title}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[12px] text-muted-text">
                        {paper.journal} · {paper.year}
                      </span>
                      <StarsRating rating={paper.rating} size={10} />
                      {paper.tags.map((tag) => (
                        <span
                          key={tag}
                          className="text-[11px] px-1.5 py-0.5 bg-card-surface rounded-[4px] text-muted-text"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                  <span className="text-[12px] text-muted-text/50 flex-shrink-0">
                    {paper.addedAt}
                  </span>
                  <button
                    onClick={(e) => e.stopPropagation()}
                    className="p-1 text-muted-text hover:text-espresso opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <MoreHorizontal size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {activeTab === "chats" && (
            <div className="space-y-3">
              {project.chats.map((chat) => (
                <div
                  key={chat.id}
                  className="bg-white border border-border-warm/30 rounded-[12px] p-4 cursor-pointer hover:shadow-sm transition-all group"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <MessageSquare
                        size={18}
                        className="text-espresso flex-shrink-0 mt-[3px]"
                        strokeWidth={1.8}
                      />
                      <div>
                        <p className="text-[15px] text-espresso font-medium leading-[1.35]">
                          {chat.title}
                        </p>
                        <p className="text-[13px] text-muted-text leading-[1.5] mt-1 line-clamp-2">
                          {chat.preview}
                        </p>
                        <div className="flex items-center gap-3 mt-2">
                          <span className="text-[12px] text-muted-text/60">{chat.date}</span>
                          <span className="text-[12px] text-muted-text/60">{chat.messageCount} messages</span>
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={(e) => e.stopPropagation()}
                      className="p-1 text-muted-text hover:text-espresso opacity-0 group-hover:opacity-100 transition-all"
                    >
                      <MoreHorizontal size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeTab === "notes" && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 auto-rows-fr">
              {notes.length === 0 ? (
                <p className="col-span-full text-[14px] text-muted-text py-8 text-center">
                  No notes yet. Highlight text in a paper or chat to save one,
                  or click <span className="text-orange">+ Add Note</span>.
                </p>
              ) : (
                notes.map((note) => (
                  <NoteCard
                    key={note.id}
                    note={note}
                    autoOpen={note.id === autoOpenNoteId}
                  />
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right sidebar — Project instructions */}
      <div className="hidden xl:block w-[280px] border-l border-border-warm/30 bg-light-surface/50 p-5 overflow-y-auto flex-shrink-0">
        <h3 className="text-[13px] uppercase tracking-[0.06em] text-muted-text font-medium mb-3">
          Project Instructions
        </h3>
        <p className="text-[13px] text-espresso leading-[1.6] tracking-body">
          {project.instructions}
        </p>

        <hr className="border-border-warm/30 my-5" />

        <h3 className="text-[13px] uppercase tracking-[0.06em] text-muted-text font-medium mb-3">
          Quick Actions
        </h3>
        <div className="space-y-2">
          <button className="w-full flex items-center gap-2 px-3 py-2.5 bg-white border border-border-warm/30 rounded-[10px] text-[13px] text-espresso hover:bg-card-surface/50 transition-colors">
            <Sparkles size={14} className="text-orange" />
            Ask AI about this project
          </button>
          <button className="w-full flex items-center gap-2 px-3 py-2.5 bg-white border border-border-warm/30 rounded-[10px] text-[13px] text-espresso hover:bg-card-surface/50 transition-colors">
            <Upload size={14} className="text-muted-text" />
            Import papers
          </button>
          <button className="w-full flex items-center gap-2 px-3 py-2.5 bg-white border border-border-warm/30 rounded-[10px] text-[13px] text-espresso hover:bg-card-surface/50 transition-colors">
            <ExternalLink size={14} className="text-muted-text" />
            Export project
          </button>
        </div>
      </div>
    </div>
  );
}
