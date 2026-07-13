import Link from "next/link"

/**
 * Renders an error message from the digest/ingest flow. When the message
 * matches MissingKeyError's text (see src/lib/llm/settings.ts), adds a link
 * to /debug/llm so the user can configure API keys instead of just seeing a
 * dead end.
 */
export function LlmErrorMessage({ message }: { message: string }) {
  const isMissingKey = message.includes("Missing API key for provider")

  return (
    <div className="mt-3 border border-border-warm rounded-card px-3 py-2 bg-light-surface">
      <div className="text-[13px]/[14px] text-espresso">{message}</div>
      {isMissingKey && (
        <Link
          href="/debug/llm"
          className="mt-1.5 inline-block text-[13px] text-orange font-medium tracking-body hover:text-orange-light transition-colors"
        >
          Configure API keys →
        </Link>
      )}
    </div>
  )
}
