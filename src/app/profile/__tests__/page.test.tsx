// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useUserStore } from "@/stores/user-store"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const PROFILE = {
  name: "Ada",
  role: "Research fellow",
  fields: "Neuroscience",
  topics: "Auditory attention",
  feedPrefs: "Methods papers",
  avatarDataUrl: null,
  revision: "a".repeat(64),
}

const { loadProfileMock, updateProfileMock } = vi.hoisted(() => ({
  loadProfileMock: vi.fn(),
  updateProfileMock: vi.fn(),
}))

vi.mock("@/lib/usermodel/profile-client", () => ({
  loadUserProfile: loadProfileMock,
  updateUserProfileRemote: updateProfileMock,
}))

vi.mock("@/components/ui/PageHeader", () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}))

import ProfilePage from "../page"

function mount(): { host: HTMLDivElement; root: Root } {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  return { host, root }
}

function changeField(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = field instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set
  act(() => {
    setter?.call(field, value)
    field.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

describe("ProfilePage", () => {
  beforeEach(() => {
    loadProfileMock.mockReset().mockResolvedValue(PROFILE)
    updateProfileMock.mockReset().mockImplementation(async (input) => ({
      result: { ...input, revision: "b".repeat(64) },
      changesetId: "cs-profile",
      warnings: [],
    }))
    useUserStore.setState({ user: null, onboardingComplete: true })
  })

  it("edits the name and every onboarding answer with explicit Save and Cancel controls", async () => {
    const { host, root } = mount()
    await act(async () => root.render(<ProfilePage />))

    expect(host.textContent).toContain("Ada")
    expect(host.textContent).toContain("Research context")
    expect(host.querySelectorAll("textarea")).toHaveLength(0)

    const edit = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("Edit profile"))
    act(() => edit?.click())
    expect(host.querySelectorAll("textarea")).toHaveLength(4)
    expect(host.textContent).toContain("Add photo")
    expect(host.textContent).toContain("Cancel")
    expect(host.textContent).toContain("Save changes")

    changeField(host.querySelector("#profile-name") as HTMLInputElement, "Ada Lovelace")
    changeField(host.querySelector("#profile-role") as HTMLTextAreaElement, "Principal investigator")

    const save = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("Save changes"))
    await act(async () => save?.click())

    expect(updateProfileMock).toHaveBeenCalledWith(expect.objectContaining({
      name: "Ada Lovelace",
      role: "Principal investigator",
      fields: "Neuroscience",
      topics: "Auditory attention",
      feedPrefs: "Methods papers",
      revision: PROFILE.revision,
    }))
    expect(useUserStore.getState().user?.name).toBe("Ada Lovelace")

    act(() => root.unmount())
    host.remove()
  })
})
