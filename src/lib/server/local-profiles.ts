import { createHash, randomBytes, randomUUID } from "node:crypto"
import { mkdir, realpath } from "node:fs/promises"
import { dirname, join, resolve, sep } from "node:path"
import { z } from "zod"
import { NodeFsVaultStorage } from "../vault/node-fs-storage"
import { resolveVaultRoot } from "../vault/vault-path"
import { openVault } from "../vault/scaffold"
import { getUserProfile, UserProfileNotFoundError } from "../usermodel/profile"
import { PROFILE_SESSION_SECONDS, type LocalProfile } from "../local-profile-contract"

const profileSchema = z.object({ id: z.string().min(1), name: z.string().min(1), vaultPath: z.string().min(1) }).strict()
const registrySchema = z.object({ version: z.literal(1), profiles: z.array(profileSchema).min(1) }).strict()
const sessionSchema = z.object({ profileId: z.string(), expires: z.number() }).strict()
const hash = (value: string) => createHash("sha256").update(value).digest("hex")

/** Separate from every vault, so exports and generic vault APIs cannot expose sessions. */
function registryRoot(env: NodeJS.ProcessEnv): string {
  const vault = resolve(resolveVaultRoot(env))
  // User-owned runtime files must never be traced into a Next.js deployment bundle.
  const root = resolve(/* turbopackIgnore: true */ env.SCISPARK_PROFILES_DIR?.trim() || join(dirname(vault), ".scispark-profiles"))
  if (root === vault || root.startsWith(vault + sep)) throw new Error("Profile registry must be outside the research vault")
  return root
}

async function registryStorage(env: NodeJS.ProcessEnv): Promise<NodeFsVaultStorage> {
  const vault = resolve(resolveVaultRoot(env))
  // Resolve aliases before comparing ownership boundaries (e.g. /var vs /private/var).
  await mkdir(vault, { recursive: true })
  await mkdir(registryRoot(env), { recursive: true, mode: 0o700 })
  const [root, canonicalVault] = await Promise.all([realpath(/* turbopackIgnore: true */ registryRoot(env)), realpath(/* turbopackIgnore: true */ vault)])
  if (root === canonicalVault || root.startsWith(canonicalVault + sep)) throw new Error("Profile registry must be outside the research vault")
  return new NodeFsVaultStorage(root)
}

async function readRegistry(storage: NodeFsVaultStorage): Promise<LocalProfile[]> {
  const raw = await storage.read("profiles.json")
  if (raw !== null) {
    const { profiles } = registrySchema.parse(JSON.parse(raw))
    if (new Set(profiles.map((p) => p.id)).size !== profiles.length || new Set(profiles.map((p) => p.vaultPath)).size !== profiles.length) {
      throw new Error("Invalid profile registry: each profile must own a separate vault")
    }
    return profiles
  }
  return []
}

/** Adopt an explicitly configured existing vault once, including after a restart
 * with a different SCISPARK_VAULT. Aliases resolve to the same owning profile. */
async function registerConfiguredVault(storage: NodeFsVaultStorage, env: NodeJS.ProcessEnv): Promise<LocalProfile[]> {
  const profiles = await readRegistry(storage)
  const configured = resolve(resolveVaultRoot(env))
  await mkdir(configured, { recursive: true })
  const vaultPath = await realpath(/* turbopackIgnore: true */ configured)
  if (profiles.some((p) => p.vaultPath === vaultPath)) return profiles
  if (profiles.some((p) => vaultPath.startsWith(p.vaultPath + sep) || p.vaultPath.startsWith(vaultPath + sep))) {
    throw new Error("Profile vault folders must not contain one another")
  }
  profiles.push({ id: hash(vaultPath).slice(0, 32), name: "My profile", vaultPath })
  await storage.write("profiles.json", JSON.stringify({ version: 1, profiles }, null, 2))
  return profiles
}

async function displayProfile(profile: LocalProfile): Promise<LocalProfile> {
  try {
    const research = await getUserProfile(new NodeFsVaultStorage(profile.vaultPath))
    return { ...profile, name: research.name }
  } catch (error) {
    if (error instanceof UserProfileNotFoundError) return profile
    throw error
  }
}

export async function listLocalProfiles(env: NodeJS.ProcessEnv = process.env): Promise<LocalProfile[]> {
  const storage = await registryStorage(env)
  const profiles = await storage.exclusive("profiles", () => registerConfiguredVault(storage, env))
  return Promise.all(profiles.map(displayProfile))
}

export async function createLocalProfile(name: string, env: NodeJS.ProcessEnv = process.env): Promise<LocalProfile> {
  name = name.trim()
  if (!name || name.length > 80 || /[\u0000-\u001f]/.test(name)) throw new Error("Enter a profile name of 1–80 characters")
  const storage = await registryStorage(env)
  return storage.exclusive("profiles", async () => {
    const profiles = await registerConfiguredVault(storage, env)
    const displayed = await Promise.all(profiles.map(displayProfile))
    if (displayed.some((p) => p.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error("A profile with this name already exists")
    const id = randomUUID()
    const profile = { id, name, vaultPath: join(await realpath(/* turbopackIgnore: true */ registryRoot(env)), "vaults", id) }
    await openVault(new NodeFsVaultStorage(profile.vaultPath))
    await storage.write("profiles.json", JSON.stringify({ version: 1, profiles: [...profiles, profile] }, null, 2))
    return profile
  })
}

export async function createProfileSession(profileId: string, env: NodeJS.ProcessEnv = process.env): Promise<{ token: string; profile: LocalProfile }> {
  const profile = (await listLocalProfiles(env)).find((p) => p.id === profileId)
  if (!profile) throw new Error("Profile not found")
  const token = randomBytes(32).toString("hex")
  await (await registryStorage(env)).write(`sessions/${hash(token)}.json`, JSON.stringify({ profileId, expires: Date.now() + PROFILE_SESSION_SECONDS * 1000 }))
  return { token, profile }
}

export async function getProfileSession(token: string | undefined, env: NodeJS.ProcessEnv = process.env): Promise<LocalProfile | null> {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null
  const storage = await registryStorage(env)
  const raw = await storage.read(`sessions/${hash(token)}.json`)
  if (raw === null) return null
  let session: z.infer<typeof sessionSchema>
  try { session = sessionSchema.parse(JSON.parse(raw)) } catch { return null }
  if (session.expires <= Date.now()) return null
  // Read only immutable ownership here; do not re-read research or take a lock on every API call.
  const profiles = await readRegistry(storage)
  return profiles.find((p) => p.id === session.profileId) ?? null
}

export async function revokeProfileSession(token: string | undefined, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (token && /^[a-f0-9]{64}$/.test(token)) await (await registryStorage(env)).delete(`sessions/${hash(token)}.json`)
}
