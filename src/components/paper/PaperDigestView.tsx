import type { DigestResult } from "@/lib/skills/digest"
import { Card } from "@/components/ui/Card"
import styles from "./PaperLayout.module.css"
import type { PaperTextInfo } from "@/lib/papers/text-contract"

function digestSections(digest: DigestResult) {
  return [
    { id: "digest-summary", label: "Overview", present: true },
    { id: "digest-key-points", label: "Key points", present: digest.keyPoints.length > 0 },
    { id: "digest-plain-language", label: "In plain language", present: Boolean(digest.laySummary) },
    { id: "digest-methods", label: "Methods", present: Boolean(digest.methods) },
    { id: "digest-limitations", label: "Limitations", present: Boolean(digest.limitations) },
    { id: "digest-field-context", label: "Field context", present: Boolean(digest.fieldContext) },
  ].filter(section => section.present)
}

export function PaperDigestNavigation({ digest, compact = false }: { digest: DigestResult; compact?: boolean }) {
  const links = (
    <nav aria-label="Digest sections" className={styles.contents}>
      {digestSections(digest).map(section => <a key={section.id} href={`#${section.id}`}>{section.label}</a>)}
    </nav>
  )
  return compact ? (
    <details className={styles.mobileContents}>
      <summary>On this page</summary>
      {links}
    </details>
  ) : (
    <div className={styles.railNavigation}>
      <p className="mb-2 text-[13px] font-medium text-espresso">On this page</p>
      {links}
    </div>
  )
}

/** A single reading measure for every section, including long methods/caveats. */
export function PaperDigestView({ digest, fromCache, source }: { digest: DigestResult; fromCache: boolean; source?: PaperTextInfo }) {
  const sections = [
    { id: "digest-plain-language", title: "In plain language", text: digest.laySummary },
    { id: "digest-methods", title: "Methods", text: digest.methods },
    { id: "digest-limitations", title: "Limitations", text: digest.limitations },
    { id: "digest-field-context", title: "Field context", text: digest.fieldContext },
  ]

  return (
    <section aria-labelledby="digest-title">
      <section id="digest-summary" tabIndex={-1} className={styles.section}>
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="digest-title" className="font-heading text-[28px] leading-tight text-espresso">Paper digest</h2>
          {source && <span className="text-[12px] text-muted-text">{fromCache ? "Saved" : "Generated"} · {source.access === "full-text" ? source.truncated ? "Full-text excerpt" : "Full text" : "Abstract only"}</span>}
        </div>
        <p className="whitespace-pre-wrap text-[17px] leading-[1.8] text-espresso">{digest.summary}</p>
      </section>

      {digest.keyPoints.length > 0 && (
        <section id="digest-key-points" tabIndex={-1} className={styles.section}>
          <Card className="p-5 sm:p-6">
            <h3>Key points</h3>
            <ul className="list-outside list-disc space-y-3 pl-5 text-[15px] leading-[1.75] text-espresso marker:text-accent-ink">
              {digest.keyPoints.map((point, i) => <li key={i}>{point}</li>)}
            </ul>
          </Card>
        </section>
      )}

      {sections.filter(section => section.text).map(section => (
        <section key={section.id} id={section.id} tabIndex={-1} className={`${styles.section} border-t border-border-warm pt-6`}>
          <h3>{section.title}</h3>
          <p className={styles.prose}>{section.text}</p>
        </section>
      ))}
    </section>
  )
}
