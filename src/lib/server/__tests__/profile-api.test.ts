import { afterEach, beforeEach, describe, expect, it } from "vitest"
import * as profileRoute from "@/app/api/profile/route"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { setServerVaultForTests } from "../vault"

const ANSWERS = {
  name: "Ada",
  role: "Research fellow",
  fields: "Neuroscience",
  topics: "Auditory attention",
  feedPrefs: "Methods papers",
}

describe("profile API", () => {
  let storage: MemoryVaultStorage

  beforeEach(() => {
    storage = new MemoryVaultStorage()
    setServerVaultForTests(storage)
  })

  afterEach(() => setServerVaultForTests(null))

  it("returns 404 before onboarding and strictly validates creation", async () => {
    expect((await profileRoute.GET()).status).toBe(404)

    const invalid = await profileRoute.POST(
      new Request("http://x/api/profile", {
        method: "POST",
        body: JSON.stringify({ ...ANSWERS, injected: true }),
      }),
    )
    expect(invalid.status).toBe(400)

    const created = await profileRoute.POST(
      new Request("http://x/api/profile", {
        method: "POST",
        body: JSON.stringify(ANSWERS),
      }),
    )
    expect(created.status).toBe(201)
    expect(await created.json()).toMatchObject({
      result: { ...ANSWERS, avatarDataUrl: null, revision: expect.stringMatching(/^[a-f0-9]{64}$/) },
      changesetId: expect.stringMatching(/^cs-/),
      warnings: [],
    })
  })

  it("updates identity and answers with a revision conflict boundary", async () => {
    const created = await profileRoute.POST(
      new Request("http://x/api/profile", {
        method: "POST",
        body: JSON.stringify(ANSWERS),
      }),
    )
    const original = (await created.json()).result

    const updated = await profileRoute.PATCH(
      new Request("http://x/api/profile", {
        method: "PATCH",
        body: JSON.stringify({
          ...ANSWERS,
          name: "Ada Lovelace",
          avatarDataUrl: "data:image/webp;base64,aGVsbG8=",
          revision: original.revision,
        }),
      }),
    )
    expect(updated.status).toBe(200)
    expect((await updated.json()).result).toMatchObject({
      name: "Ada Lovelace",
      avatarDataUrl: "data:image/webp;base64,aGVsbG8=",
    })

    const stale = await profileRoute.PATCH(
      new Request("http://x/api/profile", {
        method: "PATCH",
        body: JSON.stringify({
          ...ANSWERS,
          name: "Stale edit",
          avatarDataUrl: null,
          revision: original.revision,
        }),
      }),
    )
    expect(stale.status).toBe(409)
  })
})
