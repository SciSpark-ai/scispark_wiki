"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useUserStore } from "@/stores/user-store";
import { getOpenVault } from "@/lib/vault/get-vault";
import { readUserModel } from "@/lib/usermodel/pages";
import { PageHeader } from "@/components/ui/PageHeader";

/**
 * Parses a user-model markdown page (e.g. profile.md) into its `## ` sections
 * for read-only display, skipping the top-level `# ` title and any preamble
 * note before the first section. Only sections with body text are returned.
 */
function parseProfileSections(md: string): { heading: string; body: string }[] {
  const sections: { heading: string; body: string }[] = [];
  let current: { heading: string; body: string[] } | null = null;
  for (const line of md.split("\n")) {
    const h = line.match(/^##\s+(.*\S)\s*$/);
    if (h) {
      if (current)
        sections.push({ heading: current.heading, body: current.body.join("\n").trim() });
      current = { heading: h[1].trim(), body: [] };
    } else if (current) {
      current.body.push(line);
    }
  }
  if (current)
    sections.push({ heading: current.heading, body: current.body.join("\n").trim() });
  return sections.filter((s) => s.body.length > 0);
}

export default function ProfilePage() {
  const { user } = useUserStore();

  const [language, setLanguage] = useState<"EN" | "ZH">("EN");

  // The real profile.md content (seeded by onboarding, agent-maintained),
  // shown read-only in place of the old fork-mock clinical preferences card.
  const [profileText, setProfileText] = useState<string | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const vault = await getOpenVault();
        const userModel = await readUserModel(vault);
        if (!cancelled) setProfileText(userModel.profile);
      } catch (e) {
        if (!cancelled) setProfileError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setProfileLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const avatarInitial = user?.name?.charAt(0)?.toUpperCase() ?? "?";
  const profileSections = profileText ? parseProfileSections(profileText) : [];

  return (
    <div className="p-7">
      <PageHeader title="Profile" />

      {/* Section 1: User Info */}
      <div className="bg-light-surface rounded-[14px] border border-border-warm/30 p-6 mt-6">
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

      {/* Section 2: Research profile (real user-model page, read-only) */}
      <div className="bg-light-surface rounded-[14px] border border-border-warm/30 p-6 mt-4">
        <h2 className="font-heading text-[18px] text-espresso mb-1">
          Research profile
        </h2>
        <p className="text-[13px] text-muted-text mb-4">
          Seeded from onboarding and maintained by SciSpark&rsquo;s agents from
          your activity.
        </p>
        {profileLoading ? (
          <p className="text-[14px] text-muted-text">Loading…</p>
        ) : profileSections.length === 0 ? (
          <p className="text-[14px] text-muted-text">
            {profileError
              ? profileError
              : (
                <>
                  No profile yet.{" "}
                  <Link href="/onboarding" className="text-orange hover:underline">
                    Complete onboarding
                  </Link>{" "}
                  to build one.
                </>
              )}
          </p>
        ) : (
          <div className="space-y-5">
            {profileSections.map((section) => (
              <div key={section.heading}>
                <label className="block text-[13px] text-muted-text font-medium uppercase tracking-[0.06em] mb-1.5">
                  {section.heading}
                </label>
                <p className="text-[14px] text-espresso whitespace-pre-line leading-[1.55]">
                  {section.body}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Section 3: Settings */}
      <div className="bg-light-surface rounded-[14px] border border-border-warm/30 p-6 mt-4">
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
