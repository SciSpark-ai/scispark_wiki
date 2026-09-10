import styles from "./SparkyBadge.module.css";

export type SparkyState = "idle" | "thinking" | "responding";

/** Decorative identity; the enclosing reply or control supplies its accessible name. */
export function SparkyBadge({ state = "idle", size = "reply" }: {
  state?: SparkyState;
  size?: "reply" | "header" | "companion";
}) {
  return (
    <span aria-hidden="true" data-sparky-badge data-state={state} data-size={size} className={styles.badge}>
      <svg viewBox="0 0 32 32" focusable="false">
        <path d="M16 2C17.2 12.4 19.4 14.6 28 16C19.4 17.4 17.2 19.6 16 30C14.8 19.6 12.6 17.4 4 16C12.6 14.6 14.8 12.4 16 2Z" />
      </svg>
    </span>
  );
}
