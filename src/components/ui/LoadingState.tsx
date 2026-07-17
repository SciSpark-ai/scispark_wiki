export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return <div className="px-1 py-6 text-[14px] text-muted-text tracking-body">{label}</div>
}
