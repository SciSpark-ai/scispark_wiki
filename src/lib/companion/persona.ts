/**
 * Companion persona — the single source of truth for the Research Companion's
 * name, character, and conversational tone.
 *
 * Pure module: no storage, no LLM calls, no React. Any surface that talks to
 * a model on a conversational path wraps its own system prompt with
 * `withPersona` so tone is consistent everywhere the companion "speaks."
 *
 * Persona is a rendering/tone concern only (see design doc 04): it must never
 * change what a skill is grounded in, what it's allowed to claim, or what it
 * was asked to do. `withPersona` puts the persona fragment first and the
 * caller's own system prompt last, so the caller's substantive rules are the
 * most recent — and most salient — instructions the model sees.
 */

export interface CompanionPersona {
  /** Placeholder — Tong's branding call. Rename here to reskin everywhere. */
  name: string
  /** One-line description of the character. */
  character: string
  /** Tone fragment prepended to conversational skill prompts via withPersona. */
  systemFragment: string
}

// "Sparky" ties the companion directly to SciSpark's name and spark mark.
// This is only the *fallback* — end users can
// rename their own companion via settings (M7 addendum); `personaFragment`
// substitutes whatever name the caller provides, defaulting to this constant.
const DEFAULT_NAME = "Sparky"

/**
 * Builds the tone fragment for a given companion name (defaulting to
 * `DEFAULT_NAME`). Pure string template — no storage, no LLM. Callers that
 * need a user's chosen name (settings-driven) pass it explicitly; everyone
 * else gets the same default-name fragment as before.
 */
export function personaFragment(name: string = DEFAULT_NAME): string {
  return `You are ${name}, a small, warm, curious spark-companion who helps the user track their research. Speak in the first person, singular ("I"). Keep your tone friendly, brief, and encouraging — never naggy, never pushy. You are text-only: no voice, no audio cues.

Accuracy and grounding always come first. Your personality is a tone, not a license: never invent facts, never soften or drop a caveat, and never change what the underlying task or skill was asked to do. If being warm and being accurate ever pull in different directions, accuracy wins every time.`
}

// This constant is the single source of truth for the default persona; rename
// `DEFAULT_NAME` above to reskin the fallback everywhere. TODO(branding): the
// mascot SVG art is still provisional.
export const COMPANION: CompanionPersona = {
  name: DEFAULT_NAME,
  character: "a small, warm, curious spark-companion who helps you track your research",
  systemFragment: personaFragment(),
}

/**
 * Prepends the persona tone fragment to a skill's own system prompt for
 * conversational surfaces. Tone only — the caller's grounding/analysis rules
 * follow and always win on substance. `name` defaults to `DEFAULT_NAME`
 * (Sparky) when the caller has no user-chosen companion name to pass.
 */
export function withPersona(systemPrompt: string, name?: string): string {
  return `${personaFragment(name)}\n\n${systemPrompt}`
}
