import Link from "next/link"

/**
 * Renders an error message from the digest/ingest flow. When the message
 * matches MissingKeyError's text (see src/lib/llm/settings.ts), adds a link
 * to /settings so the user can connect a provider instead of just seeing a
 * dead end.
 */
export function LlmErrorMessage({ message }: { message: string }) {
  const isMissingKey = message.includes("Missing API key for provider")

  return (
    <div className="mt-3 border border-border-warm rounded-card px-3 py-2 bg-light-surface">
      <div className="text-[13px]/[14px] text-espresso">{message}</div>
      {isMissingKey && (
        <Link
          href="/settings"
          className="mt-1.5 inline-block text-[13px] text-accent-ink font-medium tracking-body hover:text-accent-ink-hover transition-colors"
        >
          Connect a provider →
        </Link>
      )}
    </div>
  )
}
