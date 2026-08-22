/** Strict relative path accepted at public vault and archive boundaries. */
export function isSafeVaultRelativePath(path: string): boolean {
  if (
    path.length === 0 ||
    path.length > 1024 ||
    path.trim() !== path ||
    path.startsWith("/") ||
    path.includes("\\") ||
    /^[A-Za-z]:[\\/]/.test(path) ||
    /[\u0000-\u001F\u007F]/.test(path)
  ) {
    return false
  }
  const segments = path.split("/")
  return segments.every((segment) => segment !== "" && segment !== "." && segment !== "..")
}
