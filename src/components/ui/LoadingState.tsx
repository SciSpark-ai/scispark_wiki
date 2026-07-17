export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return <div className="px-1 py-6 text-[13px] text-muted-text">{label}</div>
}
