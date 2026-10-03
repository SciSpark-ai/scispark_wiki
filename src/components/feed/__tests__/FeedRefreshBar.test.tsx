// @vitest-environment jsdom
import { act, StrictMode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { FeedResult } from "@/lib/skills/feed"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { consolidateMock, refreshFeedMock, resumeFeedRefreshMock } = vi.hoisted(() => ({
  consolidateMock: vi.fn(),
  refreshFeedMock: vi.fn(),
  resumeFeedRefreshMock: vi.fn(),
}))

vi.mock("@/lib/skills/feed-client", () => ({
  consolidate: consolidateMock,
  refreshFeed: refreshFeedMock,
  resumeFeedRefresh: resumeFeedRefreshMock,
}))

import { FeedRefreshBar } from "../FeedRefreshBar"

const FEED = {
  generatedAt: "2026-09-04T12:00:00.000Z",
  items: [],
  strategy: { queries: [] },
  stats: { retrieved: 0, ranked: 0 },
  costUsd: 0.02,
} as unknown as FeedResult

function mount(): { host: HTMLDivElement; root: Root } {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  return { host, root }
}

async function flushRefresh() {
  // Flush the read-only reconnect before the auto-start effect schedules work.
  await act(async () => { await Promise.resolve() })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
}

describe("FeedRefreshBar first-run initialization", () => {
  it("labels degraded Codex results as subscription usage rather than missing API pricing", async () => {
    refreshFeedMock.mockResolvedValue({ ...FEED, costUsd: null, billingMode: "subscription", engine: "codex", recommendation: { status: "unranked" } })
    const { host, root } = mount()
    await act(async () => root.render(<FeedRefreshBar autoStart onUpdated={vi.fn()} />))
    await flushRefresh()
    expect(host.textContent).toContain("unranked results")
    expect(host.textContent).toContain("Codex plan usage")
    expect(host.textContent).not.toContain("cost unavailable")
    act(() => root.unmount())
    host.remove()
  })
  it("does not describe an unpriced refresh as zero dollars", async () => {
    refreshFeedMock.mockResolvedValue({ ...FEED, costUsd: null })
    const { host, root } = mount()
    await act(async () => root.render(<FeedRefreshBar autoStart onUpdated={vi.fn()} />))
    await flushRefresh()
    expect(host.textContent).toContain("cost unavailable")
    expect(host.textContent).not.toContain("$0.00")
    act(() => root.unmount())
    host.remove()
  })
  beforeEach(() => {
    resumeFeedRefreshMock.mockReset().mockResolvedValue(null)
    consolidateMock.mockReset().mockResolvedValue({ status: "skipped", costUsd: 0 })
    refreshFeedMock.mockReset().mockImplementation(async (onStage: (stage: string) => void) => {
      onStage("strategy")
      onStage("retrieval")
      onStage("rank")
      onStage("rerank")
      return FEED
    })
  })

  it("reattaches on return and updates the new page without another POST or stale callbacks", async () => {
    let completeOriginal!: (feed: FeedResult) => void
    refreshFeedMock.mockReturnValue(new Promise<FeedResult>((resolve) => { completeOriginal = resolve }))
    const oldUpdated = vi.fn()
    const first = mount()
    await act(async () => first.root.render(<FeedRefreshBar autoStart onUpdated={oldUpdated} />))
    await flushRefresh()
    expect(refreshFeedMock).toHaveBeenCalledTimes(1)
    const signal = refreshFeedMock.mock.calls[0][2] as AbortSignal
    act(() => first.root.unmount()); first.host.remove()
    expect(signal.aborted).toBe(true)

    let completeObserver!: (feed: FeedResult) => void
    resumeFeedRefreshMock.mockImplementationOnce((progress: (stage: string, startedAt: number) => void) => {
      progress("rank", Date.now() - 30_000)
      return new Promise<FeedResult>((resolve) => { completeObserver = resolve })
    })
    const newUpdated = vi.fn()
    const second = mount()
    await act(async () => second.root.render(<FeedRefreshBar onUpdated={newUpdated} />))
    expect(second.host.textContent).toContain("Ranking candidates")
    expect(second.host.textContent).toContain("30s")
    expect(second.host.querySelector("button")!.disabled).toBe(true)
    await act(async () => { completeOriginal(FEED); completeObserver(FEED) })
    expect(oldUpdated).not.toHaveBeenCalled()
    expect(newUpdated).toHaveBeenCalledWith(FEED)
    expect(refreshFeedMock).toHaveBeenCalledTimes(1)
    act(() => second.root.unmount()); second.host.remove()
  })

  it("first-run setup joins existing work instead of auto-starting a second refresh", async () => {
    resumeFeedRefreshMock.mockResolvedValue(FEED)
    const onComplete = vi.fn()
    const { host, root } = mount()
    await act(async () => root.render(<FeedRefreshBar autoStart onUpdated={vi.fn()} onComplete={onComplete} />))
    await flushRefresh()
    expect(onComplete).toHaveBeenCalledWith(FEED)
    expect(refreshFeedMock).not.toHaveBeenCalled()
    act(() => root.unmount()); host.remove()
  })

  it("does not start paid work if checking for an existing refresh fails", async () => {
    resumeFeedRefreshMock.mockRejectedValue(new Error("Could not reconnect"))
    const { host, root } = mount()
    await act(async () => root.render(<FeedRefreshBar autoStart onUpdated={vi.fn()} />))
    await flushRefresh()
    expect(host.textContent).toContain("Could not reconnect")
    expect(refreshFeedMock).not.toHaveBeenCalled()
    act(() => root.unmount()); host.remove()
  })

  it.each(["compact", "initialization"] as const)("uses neutral preparation copy in the %s view", async (variant) => {
    let finish!: (feed: FeedResult) => void
    refreshFeedMock.mockImplementation((onStage: (stage: string) => void) => {
      onStage("rerank")
      return new Promise<FeedResult>((resolve) => { finish = resolve })
    })
    const { host, root } = mount()
    try {
      act(() => root.render(<FeedRefreshBar autoStart variant={variant} onUpdated={vi.fn()} />))
      await flushRefresh()
      expect(host.querySelector('[role="status"]')?.textContent).toContain("Preparing your feed")
      expect(host.textContent).not.toContain("Writing why")
      expect(host.textContent).not.toContain("Writing explanations")
      await act(async () => finish(FEED))
    } finally {
      act(() => root.unmount())
      host.remove()
    }
  })

  it.each([1, 2])("starts once after StrictMode effect replay (reproduction %i)", async () => {
    const onUpdated = vi.fn()
    const { host, root } = mount()
    try {
      act(() => root.render(
        <StrictMode>
          <FeedRefreshBar autoStart variant="initialization" onUpdated={onUpdated} />
        </StrictMode>,
      ))
      await flushRefresh()

      expect(consolidateMock).not.toHaveBeenCalled()
      expect(refreshFeedMock).toHaveBeenCalledTimes(1)
      expect(onUpdated).toHaveBeenCalledWith(FEED)
      expect(host.textContent).toContain("Your research radar is ready")
    } finally {
      act(() => root.unmount())
      host.remove()
    }
  })

  it("still starts if a parent changes callbacks before the scheduled start", async () => {
    const firstUpdate = vi.fn()
    const latestUpdate = vi.fn()
    const { host, root } = mount()
    try {
      act(() => root.render(<FeedRefreshBar autoStart onUpdated={firstUpdate} />))
      act(() => root.render(<FeedRefreshBar autoStart onUpdated={latestUpdate} />))
      await flushRefresh()
      expect(refreshFeedMock).toHaveBeenCalledTimes(1)
      expect(latestUpdate).toHaveBeenCalledWith(FEED)
      expect(firstUpdate).not.toHaveBeenCalled()
    } finally {
      act(() => root.unmount())
      host.remove()
    }
  })

  it("does not start another request when callbacks change during a running refresh", async () => {
    let finish!: (feed: FeedResult) => void
    refreshFeedMock.mockReturnValue(new Promise<FeedResult>((resolve) => { finish = resolve }))
    const { host, root } = mount()
    try {
      act(() => root.render(<StrictMode><FeedRefreshBar autoStart onUpdated={vi.fn()} /></StrictMode>))
      await flushRefresh()
      act(() => root.render(<StrictMode><FeedRefreshBar autoStart onUpdated={vi.fn()} /></StrictMode>))
      await flushRefresh()
      expect(consolidateMock).not.toHaveBeenCalled()
      expect(refreshFeedMock).toHaveBeenCalledTimes(1)
      await act(async () => finish(FEED))
    } finally {
      act(() => root.unmount())
      host.remove()
    }
  })

  it("cancels a scheduled auto-start when unmounted before the timer fires", async () => {
    const { host, root } = mount()
    act(() => root.render(<FeedRefreshBar autoStart onUpdated={vi.fn()} />))
    act(() => root.unmount())
    await flushRefresh()
    expect(consolidateMock).not.toHaveBeenCalled()
    expect(refreshFeedMock).not.toHaveBeenCalled()
    host.remove()
  })

  it("starts automatically and reports completion to the setup flow", async () => {
    const onUpdated = vi.fn()
    const onComplete = vi.fn()
    const { host, root } = mount()

    act(() => {
      root.render(
        <FeedRefreshBar
          autoStart
          variant="initialization"
          onUpdated={onUpdated}
          onComplete={onComplete}
        />,
      )
    })
    await flushRefresh()

    expect(consolidateMock).not.toHaveBeenCalled()
    expect(refreshFeedMock).toHaveBeenCalledTimes(1)
    expect(onUpdated).toHaveBeenCalledWith(FEED)
    expect(onComplete).toHaveBeenCalledWith(FEED)
    expect(host.textContent).toContain("Your research radar is ready")

    act(() => root.unmount())
    host.remove()
  })
})
