"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useUserStore } from "@/stores/user-store";
import { getOpenVault } from "@/lib/vault/get-vault";
import { readUserModel } from "@/lib/usermodel/pages";
import { effectiveTrackedFields, slugify, MAX_TRACKED_FIELDS } from "@/lib/trending/fields";
import type { Cadence } from "@/lib/trending/settings";
import { loadTrendingSettingsRemote, saveTrendingSettingsRemote } from "@/lib/trending/settings-client";

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

  // Trending fields + cadence — read/written through /api/settings, seeded from
  // interests.md's Active topics when no settings are saved yet.
  const [trendingLoading, setTrendingLoading] = useState(true);
  const [fieldLabels, setFieldLabels] = useState<string[]>([]);
  const [cadence, setCadence] = useState<Cadence>("weekly");
  const [trendingStatus, setTrendingStatus] = useState<string | null>(null);
  const [trendingError, setTrendingError] = useState<string | null>(null);
  const [trendingSaving, setTrendingSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // The read-only profile card reads the plain user-model pages, which are
      // always reachable. Load it independently of the trending settings so a
      // settings-load failure can't blank the profile card too.
      let interests: string | null = null;
      try {
        const vault = await getOpenVault();
        const userModel = await readUserModel(vault);
        if (!cancelled) setProfileText(userModel.profile);
        interests = userModel.interests;
      } catch (e) {
        if (!cancelled) setTrendingError(e instanceof Error ? e.message : String(e));
      }

      try {
        const settings = await loadTrendingSettingsRemote();
        if (cancelled) return;
        const fields = effectiveTrackedFields(settings.fields, interests);
        setFieldLabels(fields.map((f) => f.label));
        setCadence(settings.cadence);
      } catch (e) {
        if (!cancelled) setTrendingError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setTrendingLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function handleFieldLabelChange(index: number, value: string) {
    setFieldLabels((prev) => prev.map((label, i) => (i === index ? value : label)));
  }

  function handleAddField() {
    setFieldLabels((prev) => (prev.length >= MAX_TRACKED_FIELDS ? prev : [...prev, ""]));
  }

  function handleRemoveField(index: number) {
    setFieldLabels((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSaveTrendingFields() {
    setTrendingSaving(true);
    setTrendingError(null);
    try {
      const fields = fieldLabels
        .map((label) => label.trim())
        .filter((label) => label.length > 0)
        .map((label) => ({ slug: slugify(label), label }))
        .filter((f) => f.slug.length > 0)
        .slice(0, MAX_TRACKED_FIELDS);
      await saveTrendingSettingsRemote({ fields, cadence });
      setFieldLabels(fields.map((f) => f.label));
      setTrendingStatus("Saved");
      setTimeout(() => setTrendingStatus(null), 2000);
    } catch (e) {
      setTrendingError(e instanceof Error ? e.message : String(e));
    } finally {
      setTrendingSaving(false);
    }
  }

  const avatarInitial = user?.name?.charAt(0)?.toUpperCase() ?? "?";
  const profileSections = profileText ? parseProfileSections(profileText) : [];

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

      {/* Section 2: Research profile (real user-model page, read-only) */}
      <div className="bg-white rounded-[14px] border border-border-warm/30 p-6 mt-4">
        <h2 className="font-heading text-[18px] text-espresso mb-1">
          Research profile
        </h2>
        <p className="text-[13px] text-muted-text mb-4">
          Seeded from onboarding and maintained by SciSpark&rsquo;s agents from
          your activity.
        </p>
        {trendingLoading ? (
          <p className="text-[14px] text-muted-text">Loading…</p>
        ) : profileSections.length === 0 ? (
          <p className="text-[14px] text-muted-text">
            No profile yet.{" "}
            <Link href="/onboarding" className="text-orange hover:underline">
              Complete onboarding
            </Link>{" "}
            to build one.
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

      {/* Section 2.5: Trending fields */}
      <div className="bg-white rounded-[14px] border border-border-warm/30 p-6 mt-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-heading text-[18px] text-espresso">
            Trending fields
          </h2>
          <div className="flex items-center gap-3">
            {trendingStatus && (
              <span className="text-[13px] text-orange">{trendingStatus}</span>
            )}
            {trendingError && (
              <span className="text-[13px] text-red-600">{trendingError}</span>
            )}
            <button
              onClick={handleSaveTrendingFields}
              disabled={trendingLoading || trendingSaving}
              className="text-[13px] text-white bg-orange hover:bg-orange/90 disabled:opacity-50 rounded-pill px-4 py-1.5 font-medium transition-colors"
            >
              {trendingSaving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>

        {trendingLoading ? (
          <p className="text-[14px] text-muted-text">Loading…</p>
        ) : (
          <div className="space-y-5">
            <div>
              <label className="block text-[13px] text-muted-text font-medium uppercase tracking-[0.06em] mb-1.5">
                Tracked fields
              </label>
              <div className="space-y-2">
                {fieldLabels.map((label, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={label}
                      onChange={(e) => handleFieldLabelChange(index, e.target.value)}
                      placeholder="e.g. Retrieval-Augmented Generation"
                      className="flex-1 bg-light-surface border border-border-warm/30 rounded-[10px] px-3 py-2.5 text-[14px] text-espresso focus:outline-none focus:border-orange/50"
                    />
                    <button
                      onClick={() => handleRemoveField(index)}
                      className="text-[13px] text-muted-text hover:text-red-600 rounded-pill border border-border-warm px-3 py-1.5 transition-colors"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
              {fieldLabels.length < MAX_TRACKED_FIELDS && (
                <button
                  onClick={handleAddField}
                  className="mt-2 text-[13px] text-orange hover:underline"
                >
                  + Add field
                </button>
              )}
            </div>

            <div className="flex items-center justify-between py-2">
              <span className="text-[14px] text-espresso">Refresh cadence</span>
              <div className="flex">
                <button
                  onClick={() => setCadence("daily")}
                  className={`px-3 py-1.5 text-[13px] font-medium first:rounded-l-[8px] last:rounded-r-[8px] ${
                    cadence === "daily"
                      ? "bg-orange text-white"
                      : "bg-card-surface text-muted-text"
                  }`}
                >
                  Daily
                </button>
                <button
                  onClick={() => setCadence("weekly")}
                  className={`px-3 py-1.5 text-[13px] font-medium first:rounded-l-[8px] last:rounded-r-[8px] ${
                    cadence === "weekly"
                      ? "bg-orange text-white"
                      : "bg-card-surface text-muted-text"
                  }`}
                >
                  Weekly
                </button>
              </div>
            </div>
          </div>
        )}
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
