"use client";
import { useState } from "react";
import { useUserStore } from "@/stores/user-store";

export default function ProfilePage() {
  const { user, preferences, setPreferences } = useUserStore();

  const [specialty, setSpecialty] = useState(preferences.specialty);
  const [role, setRole] = useState(preferences.role);
  const [literatureHabits, setLiteratureHabits] = useState(
    preferences.literatureHabits
  );
  const [language, setLanguage] = useState<"EN" | "ZH">("EN");

  const avatarInitial = user?.name?.charAt(0)?.toUpperCase() ?? "?";

  function handleSpecialtyChange(value: string) {
    setSpecialty(value);
    setPreferences({ specialty: value });
  }

  function handleRoleChange(value: string) {
    setRole(value);
    setPreferences({ role: value });
  }

  function handleLiteratureHabitsChange(value: string) {
    setLiteratureHabits(value);
    setPreferences({ literatureHabits: value });
  }

  return (
    <div className="p-7">
      <h1 className="font-heading text-[28px] text-espresso tracking-heading">
        Profile
      </h1>

      {/* Section 1: User Info */}
      <div className="bg-white rounded-[14px] border border-border-warm/30 p-6 mt-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-orange text-white text-[20px] font-medium rounded-full flex items-center justify-center shrink-0">
            {avatarInitial}
          </div>
          <div>
            <p className="text-[16px] text-espresso font-medium">
              {user?.name ?? "—"}
            </p>
            <p className="text-[14px] text-muted-text">{user?.email ?? "—"}</p>
          </div>
        </div>
      </div>

      {/* Section 2: Preferences */}
      <div className="bg-white rounded-[14px] border border-border-warm/30 p-6 mt-4">
        <h2 className="font-heading text-[18px] text-espresso mb-4">
          Preferences
        </h2>
        <div className="space-y-5">
          {/* Specialty */}
          <div>
            <label className="block text-[13px] text-muted-text font-medium uppercase tracking-[0.06em] mb-1.5">
              Specialty
            </label>
            <select
              value={specialty}
              onChange={(e) => handleSpecialtyChange(e.target.value)}
              className="w-full bg-light-surface border border-border-warm/30 rounded-[10px] px-3 py-2.5 text-[14px] text-espresso focus:outline-none focus:border-orange/50"
            >
              {[
                "Psychiatry",
                "Neurology",
                "Cardiology",
                "Oncology",
                "Pediatrics",
                "Internal Medicine",
                "Other",
              ].map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>

          {/* Role */}
          <div>
            <label className="block text-[13px] text-muted-text font-medium uppercase tracking-[0.06em] mb-1.5">
              Role
            </label>
            <select
              value={role}
              onChange={(e) => handleRoleChange(e.target.value)}
              className="w-full bg-light-surface border border-border-warm/30 rounded-[10px] px-3 py-2.5 text-[14px] text-espresso focus:outline-none focus:border-orange/50"
            >
              {[
                "Attending Physician",
                "Researcher",
                "Resident",
                "Fellow",
                "NP/PA",
              ].map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>

          {/* Interests */}
          <div>
            <label className="block text-[13px] text-muted-text font-medium uppercase tracking-[0.06em] mb-1.5">
              Interests
            </label>
            <div className="flex flex-wrap gap-2">
              {preferences.interests.map((interest) => (
                <span
                  key={interest}
                  className="px-3 py-1 rounded-pill text-[13px] bg-card-surface text-espresso border border-border-warm/30"
                >
                  {interest}
                </span>
              ))}
            </div>
          </div>

          {/* Literature Habits */}
          <div>
            <label className="block text-[13px] text-muted-text font-medium uppercase tracking-[0.06em] mb-1.5">
              Literature Habits
            </label>
            <select
              value={literatureHabits}
              onChange={(e) => handleLiteratureHabitsChange(e.target.value)}
              className="w-full bg-light-surface border border-border-warm/30 rounded-[10px] px-3 py-2.5 text-[14px] text-espresso focus:outline-none focus:border-orange/50"
            >
              {[
                "PubMed alerts",
                "Journal subscriptions",
                "Colleague recommendations",
                "Twitter/X",
                "I don't (that's why I'm here)",
              ].map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Section 3: Settings */}
      <div className="bg-white rounded-[14px] border border-border-warm/30 p-6 mt-4">
        <h2 className="font-heading text-[18px] text-espresso mb-4">
          Settings
        </h2>
        <div className="flex items-center justify-between py-2">
          <span className="text-[14px] text-espresso">Language</span>
          <div className="flex">
            <button
              onClick={() => setLanguage("EN")}
              className={`px-3 py-1.5 text-[13px] font-medium first:rounded-l-[8px] last:rounded-r-[8px] ${
                language === "EN"
                  ? "bg-orange text-white"
                  : "bg-card-surface text-muted-text"
              }`}
            >
              EN
            </button>
            <button
              onClick={() => setLanguage("ZH")}
              className={`px-3 py-1.5 text-[13px] font-medium first:rounded-l-[8px] last:rounded-r-[8px] ${
                language === "ZH"
                  ? "bg-orange text-white"
                  : "bg-card-surface text-muted-text"
              }`}
            >
              ZH
            </button>
          </div>
        </div>
      </div>

      {/* Section 4: Sign Out */}
      <div className="mt-6 mb-8">
        <button className="px-6 py-2.5 border border-espresso/20 rounded-pill text-[14px] text-espresso hover:bg-card-surface transition-colors">
          Sign Out
        </button>
      </div>
    </div>
  );
}
