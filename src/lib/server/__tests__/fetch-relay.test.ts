import { describe, it, expect, vi } from "vitest"
import { handleFetchRelay, RELAY_ALLOWED_HOSTS } from "../fetch-relay"
import { TokenBucket } from "../rate-limit"

function freshBucket(capacity = 100, refillPerSec = 100) {
  return new TokenBucket({ capacity, refillPerSec })
}

function textStreamResponse(
  chunks: string[],
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  const headers = new Headers({ "content-type": "text/html", ...(init.headers ?? {}) })
  return new Response(stream, { status: init.status ?? 200, headers })
}

function redirectResponse(location: string): Response {
  return new Response(null, { status: 302, headers: { location } })
}

async function readAll(body: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!body) return ""
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let out = ""
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    out += decoder.decode(value, { stream: true })
  }
  return out
}

describe("RELAY_ALLOWED_HOSTS", () => {
  it("lists the six allowed publisher/OA domains", () => {
    expect(RELAY_ALLOWED_HOSTS).toEqual([
      "arxiv.org",
      "europepmc.org",
      "ncbi.nlm.nih.gov",
      "biorxiv.org",
      "medrxiv.org",
      "openalex.org",
    ])
  })
})

describe("handleFetchRelay", () => {
  it("passes through an allowlisted https URL with the body intact", async () => {
    const fetchFn = vi.fn(async () => textStreamResponse(["hello ", "world"]))
    const res = await handleFetchRelay("https://arxiv.org/abs/1234.5678", "ip1", {
      fetchFn,
      ipBuckets: freshBucket(),
    })
    expect(res.status).toBe(200)
    expect(await readAll(res.body)).toBe("hello world")
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(fetchFn).toHaveBeenCalledWith("https://arxiv.org/abs/1234.5678", { redirect: "manual", signal: expect.any(AbortSignal) })
  })

  it("allows a subdomain of an allowlisted host", async () => {
    const fetchFn = vi.fn(async () => textStreamResponse(["ok"]))
    const res = await handleFetchRelay("https://www.arxiv.org/abs/1234.5678", "ip2", {
      fetchFn,
      ipBuckets: freshBucket(),
    })
    expect(res.status).toBe(200)
  })

  it("rejects a lookalike host (evil-arxiv.org) with 403", async () => {
    const fetchFn = vi.fn(async () => textStreamResponse(["nope"]))
    const res = await handleFetchRelay("https://evil-arxiv.org/x", "ip3", {
      fetchFn,
      ipBuckets: freshBucket(),
    })
    expect(res.status).toBe(403)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it("rejects a suffix-attack host (arxiv.org.evil.com) with 403", async () => {
    const fetchFn = vi.fn(async () => textStreamResponse(["nope"]))
    const res = await handleFetchRelay("https://arxiv.org.evil.com/x", "ip4", {
      fetchFn,
      ipBuckets: freshBucket(),
    })
    expect(res.status).toBe(403)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it("rejects a URL with userinfo (403)", async () => {
    const fetchFn = vi.fn(async () => textStreamResponse(["nope"]))
    const res = await handleFetchRelay("https://user:pass@arxiv.org/x", "ip5", {
      fetchFn,
      ipBuckets: freshBucket(),
    })
    expect(res.status).toBe(403)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it("rejects http for a non-export.arxiv.org host (403)", async () => {
    const fetchFn = vi.fn(async () => textStreamResponse(["nope"]))
    const res = await handleFetchRelay("http://arxiv.org/x", "ip6", {
      fetchFn,
      ipBuckets: freshBucket(),
    })
    expect(res.status).toBe(403)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it("allows http specifically for export.arxiv.org", async () => {
    const fetchFn = vi.fn(async () => textStreamResponse(["ok"]))
    const res = await handleFetchRelay("http://export.arxiv.org/api/query", "ip7", {
      fetchFn,
      ipBuckets: freshBucket(),
    })
    expect(res.status).toBe(200)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it("rejects null url with 400", async () => {
    const fetchFn = vi.fn(async () => textStreamResponse(["nope"]))
    const res = await handleFetchRelay(null, "ip8", { fetchFn, ipBuckets: freshBucket() })
    expect(res.status).toBe(400)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it("rejects an unparseable url with 400", async () => {
    const fetchFn = vi.fn(async () => textStreamResponse(["nope"]))
    const res = await handleFetchRelay("not a url", "ip9", { fetchFn, ipBuckets: freshBucket() })
    expect(res.status).toBe(400)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it("follows a redirect to a non-allowlisted host and rejects with 403", async () => {
    const fetchFn = vi.fn(async () => redirectResponse("https://evil.com/steal"))
    const res = await handleFetchRelay("https://arxiv.org/abs/1", "ip10", {
      fetchFn,
      ipBuckets: freshBucket(),
    })
    expect(res.status).toBe(403)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it("rejects after more than 3 redirect hops with 403", async () => {
    const fetchFn = vi.fn(async () => redirectResponse("https://arxiv.org/next"))
    const res = await handleFetchRelay("https://arxiv.org/start", "ip11", {
      fetchFn,
      ipBuckets: freshBucket(),
    })
    expect(res.status).toBe(403)
    // Initial fetch + 3 followed hops = 4 calls; the 4th response is itself
    // a redirect, which exceeds the hop budget and is rejected without a
    // 5th network call.
    expect(fetchFn).toHaveBeenCalledTimes(4)
  })

  it("follows up to 3 valid redirect hops and returns the final response", async () => {
    let call = 0
    const fetchFn = vi.fn(async () => {
      call += 1
      if (call <= 3) return redirectResponse("https://arxiv.org/next" + call)
      return textStreamResponse(["final"])
    })
    const res = await handleFetchRelay("https://arxiv.org/start", "ip12", {
      fetchFn,
      ipBuckets: freshBucket(),
    })
    expect(res.status).toBe(200)
    expect(await readAll(res.body)).toBe("final")
    expect(fetchFn).toHaveBeenCalledTimes(4)
  })

  it("rejects an unsupported content-type with 415", async () => {
    const fetchFn = vi.fn(async () =>
      textStreamResponse(["alert(1)"], { headers: { "content-type": "text/javascript" } }),
    )
    const res = await handleFetchRelay("https://arxiv.org/x.js", "ip13", {
      fetchFn,
      ipBuckets: freshBucket(),
    })
    expect(res.status).toBe(415)
  })

  it("passes through paper figure image types (png/jpeg/gif/webp)", async () => {
    for (const type of ["image/png", "image/jpeg", "image/gif", "image/webp"]) {
      const fetchFn = vi.fn(async () => textStreamResponse(["binary-ish"], { headers: { "content-type": type } }))
      const res = await handleFetchRelay("https://arxiv.org/html/2409.08710v1/extracted/F2.jpg", "ip-img-" + type, {
        fetchFn,
        ipBuckets: freshBucket(),
      })
      expect(res.status).toBe(200)
      expect(res.headers.get("content-type")).toBe(type)
    }
  })

  it("still rejects svg (scriptable image type) with 415", async () => {
    const fetchFn = vi.fn(async () =>
      textStreamResponse(["<svg onload=evil()/>"], { headers: { "content-type": "image/svg+xml" } }),
    )
    const res = await handleFetchRelay("https://arxiv.org/x.svg", "ip-svg", {
      fetchFn,
      ipBuckets: freshBucket(),
    })
    expect(res.status).toBe(415)
  })

  it("sets X-Content-Type-Options: nosniff on relayed responses", async () => {
    const fetchFn = vi.fn(async () => textStreamResponse(["x"], { headers: { "content-type": "image/png" } }))
    const res = await handleFetchRelay("https://arxiv.org/y.png", "ip-nosniff", {
      fetchFn,
      ipBuckets: freshBucket(),
    })
    expect(res.headers.get("x-content-type-options")).toBe("nosniff")
  })

  it("strips upstream Set-Cookie from the response", async () => {
    const fetchFn = vi.fn(async () =>
      textStreamResponse(["hi"], { headers: { "set-cookie": "sess=abc123; HttpOnly" } }),
    )
    const res = await handleFetchRelay("https://arxiv.org/x", "ip14", {
      fetchFn,
      ipBuckets: freshBucket(),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get("set-cookie")).toBeNull()
  })

  it("sets Cache-Control and passes through content-type on success", async () => {
    const fetchFn = vi.fn(async () => textStreamResponse(["hi"], { headers: { "content-type": "application/pdf" } }))
    const res = await handleFetchRelay("https://arxiv.org/x.pdf", "ip15", {
      fetchFn,
      ipBuckets: freshBucket(),
    })
    expect(res.headers.get("cache-control")).toBe("public, s-maxage=3600")
    expect(res.headers.get("content-type")).toBe("application/pdf")
  })

  it("returns 429 with Retry-After once the IP bucket is drained", async () => {
    const fetchFn = vi.fn(async () => textStreamResponse(["ok"]))
    const bucket = new TokenBucket({ capacity: 1, refillPerSec: 0 })
    const first = await handleFetchRelay("https://arxiv.org/x", "shared-ip", { fetchFn, ipBuckets: bucket })
    expect(first.status).toBe(200)

    const second = await handleFetchRelay("https://arxiv.org/x", "shared-ip", { fetchFn, ipBuckets: bucket })
    expect(second.status).toBe(429)
    expect(second.headers.get("retry-after")).toBe("5")
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it("isolates the rate limit per clientKey", async () => {
    const fetchFn = vi.fn(async () => textStreamResponse(["ok"]))
    const bucket = new TokenBucket({ capacity: 1, refillPerSec: 0 })
    const a = await handleFetchRelay("https://arxiv.org/x", "ip-a", { fetchFn, ipBuckets: bucket })
    const b = await handleFetchRelay("https://arxiv.org/x", "ip-b", { fetchFn, ipBuckets: bucket })
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
  })

  it("terminates the stream once the byte cap is exceeded", async () => {
    const bigChunk = "x".repeat(40)
    const fetchFn = vi.fn(async () => textStreamResponse([bigChunk, bigChunk, bigChunk]))
    const res = await handleFetchRelay("https://arxiv.org/big", "ip16", {
      fetchFn,
      ipBuckets: freshBucket(),
      maxBytes: 50,
    })
    expect(res.status).toBe(200)
    await expect(readAll(res.body)).rejects.toBeTruthy()
  })

  it("does not exceed the cap when the body is under it", async () => {
    const fetchFn = vi.fn(async () => textStreamResponse(["short"]))
    const res = await handleFetchRelay("https://arxiv.org/small", "ip17", {
      fetchFn,
      ipBuckets: freshBucket(),
      maxBytes: 50,
    })
    expect(res.status).toBe(200)
    expect(await readAll(res.body)).toBe("short")
  })

  it("never echoes the input URL in rejection bodies (400)", async () => {
    const fetchFn = vi.fn(async () => textStreamResponse(["nope"]))
    const res = await handleFetchRelay("not a url with secret-marker-xyz", "ip18", {
      fetchFn,
      ipBuckets: freshBucket(),
    })
    const text = await res.text()
    expect(text).not.toContain("secret-marker-xyz")
  })

  it("never echoes the input URL in rejection bodies (403 host)", async () => {
    const fetchFn = vi.fn(async () => textStreamResponse(["nope"]))
    const res = await handleFetchRelay("https://evil-arxiv-secret-marker-xyz.org/x", "ip19", {
      fetchFn,
      ipBuckets: freshBucket(),
    })
    const text = await res.text()
    expect(text).not.toContain("secret-marker-xyz")
  })

  it("never echoes the input URL in rejection bodies (403 userinfo)", async () => {
    const fetchFn = vi.fn(async () => textStreamResponse(["nope"]))
    const res = await handleFetchRelay("https://secret-marker-xyz:pw@arxiv.org/x", "ip20", {
      fetchFn,
      ipBuckets: freshBucket(),
    })
    const text = await res.text()
    expect(text).not.toContain("secret-marker-xyz")
  })

  it("never echoes the input URL in rejection bodies (415)", async () => {
    const fetchFn = vi.fn(async () =>
      textStreamResponse(["nope"], { headers: { "content-type": "text/javascript" } }),
    )
    const res = await handleFetchRelay("https://arxiv.org/secret-marker-xyz.js", "ip21", {
      fetchFn,
      ipBuckets: freshBucket(),
    })
    const text = await res.text()
    expect(text).not.toContain("secret-marker-xyz")
  })

  it("returns a generic 502 when the upstream fetch itself throws", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("ECONNRESET")
    })
    const res = await handleFetchRelay("https://arxiv.org/x", "ip22", {
      fetchFn,
      ipBuckets: freshBucket(),
    })
    expect(res.status).toBe(502)
    const text = await res.text()
    expect(text).not.toContain("ECONNRESET")
  })

  it("uses the module-level default bucket when none is injected", async () => {
    const fetchFn = vi.fn(async () => textStreamResponse(["ok"]))
    const res = await handleFetchRelay("https://arxiv.org/default-bucket-check", "unique-default-ip", { fetchFn })
    expect(res.status).toBe(200)
  })

  it("does not copy the upstream Content-Length onto the relayed response", async () => {
    const fetchFn = vi.fn(async () =>
      textStreamResponse(["hi"], { headers: { "content-length": "2" } }),
    )
    const res = await handleFetchRelay("https://arxiv.org/x", "ip-cl", {
      fetchFn,
      ipBuckets: freshBucket(),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get("content-length")).toBeNull()
  })
})

// Pinned regression tests for SSRF vectors that the M3 Task 9 security
// review probe-verified as SAFE but were not part of the committed suite
// (see "## Review" in .superpowers/sdd/m3-task-9-report.md). These lock the
// behavior in so a future change (e.g. swapping WHATWG `new URL` for a
// hand-rolled parser, or adding header passthrough) can't silently reopen
// the hole with a green suite.
describe("handleFetchRelay - SSRF regression vectors", () => {
  it("rejects a punycode lookalike host (403)", async () => {
    const fetchFn = vi.fn(async () => textStreamResponse(["nope"]))
    const res = await handleFetchRelay("https://xn--arxv-4qa.org/x", "ssrf1", {
      fetchFn,
      ipBuckets: freshBucket(),
    })
    expect(res.status).toBe(403)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it("rejects a Cyrillic homoglyph host (403 - WHATWG punycode-encodes it, no allowlist match)", async () => {
    // The host below uses Cyrillic "а" (U+0430), not Latin "a" - it looks
    // like "arxiv.org" but WHATWG URL parsing punycode-encodes it to
    // "xn--rxiv-43d.org", which does not match the allowlist.
    const fetchFn = vi.fn(async () => textStreamResponse(["nope"]))
    const res = await handleFetchRelay("https://аrxiv.org/x", "ssrf2", {
      fetchFn,
      ipBuckets: freshBucket(),
    })
    expect(res.status).toBe(403)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it("rejects the IPv4 loopback literal over http and https (403)", async () => {
    const fetchFn = vi.fn(async () => textStreamResponse(["nope"]))
    const httpRes = await handleFetchRelay("http://127.0.0.1/", "ssrf3a", {
      fetchFn,
      ipBuckets: freshBucket(),
    })
    const httpsRes = await handleFetchRelay("https://127.0.0.1/", "ssrf3b", {
      fetchFn,
      ipBuckets: freshBucket(),
    })
    expect(httpRes.status).toBe(403)
    expect(httpsRes.status).toBe(403)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it("rejects the cloud metadata IP literal (169.254.169.254) with 403", async () => {
    const fetchFn = vi.fn(async () => textStreamResponse(["nope"]))
    const res = await handleFetchRelay("https://169.254.169.254/", "ssrf4", {
      fetchFn,
      ipBuckets: freshBucket(),
    })
    expect(res.status).toBe(403)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it("rejects the IPv6 loopback literal ([::1]) with 403", async () => {
    const fetchFn = vi.fn(async () => textStreamResponse(["nope"]))
    const res = await handleFetchRelay("https://[::1]/", "ssrf5", {
      fetchFn,
      ipBuckets: freshBucket(),
    })
    expect(res.status).toBe(403)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it("rejects a protocol-relative redirect Location (//evil.com/x) with 403", async () => {
    const fetchFn = vi.fn(async () => redirectResponse("//evil.com/x"))
    const res = await handleFetchRelay("https://arxiv.org/start", "ssrf6", {
      fetchFn,
      ipBuckets: freshBucket(),
    })
    expect(res.status).toBe(403)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it("rejects an https-to-http downgrade redirect Location with 403 (http only allowed for export.arxiv.org)", async () => {
    const fetchFn = vi.fn(async () => redirectResponse("http://arxiv.org/x"))
    const res = await handleFetchRelay("https://arxiv.org/start", "ssrf7", {
      fetchFn,
      ipBuckets: freshBucket(),
    })
    expect(res.status).toBe(403)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it("SAFE: allows an uppercase host (ARXIV.ORG) - WHATWG lowercases it", async () => {
    const fetchFn = vi.fn(async () => textStreamResponse(["ok"]))
    const res = await handleFetchRelay("https://ARXIV.ORG/x", "ssrf8", {
      fetchFn,
      ipBuckets: freshBucket(),
    })
    expect(res.status).toBe(200)
    expect(fetchFn).toHaveBeenCalledWith("https://arxiv.org/x", { redirect: "manual", signal: expect.any(AbortSignal) })
  })

  it("SAFE: rejects real userinfo pointed at a non-allowlisted host (arxiv.org@evil.com) with 403", async () => {
    const fetchFn = vi.fn(async () => textStreamResponse(["nope"]))
    const res = await handleFetchRelay("https://arxiv.org@evil.com/x", "ssrf9", {
      fetchFn,
      ipBuckets: freshBucket(),
    })
    expect(res.status).toBe(403)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it("SAFE: sends no headers to the upstream fetch (no client cookie/authorization forwarding)", async () => {
    let capturedInit: RequestInit | undefined
    const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedInit = init
      return textStreamResponse(["ok"])
    })
    const res = await handleFetchRelay("https://arxiv.org/x", "ssrf10", {
      fetchFn,
      ipBuckets: freshBucket(),
    })
    expect(res.status).toBe(200)
    // No headers property at all, or an empty header set - either way,
    // nothing from the inbound request (cookies, auth) is forwarded upstream.
    const headers = capturedInit?.headers
    if (headers === undefined) {
      expect(headers).toBeUndefined()
    } else {
      expect([...new Headers(headers).keys()]).toHaveLength(0)
    }
  })

  it("SAFE: a lying Content-Length (5) on an oversized streamed body still errors at the byte cap", async () => {
    const bigChunk = "x".repeat(40)
    const fetchFn = vi.fn(async () =>
      textStreamResponse([bigChunk, bigChunk, bigChunk], { headers: { "content-length": "5" } }),
    )
    const res = await handleFetchRelay("https://arxiv.org/big", "ssrf11", {
      fetchFn,
      ipBuckets: freshBucket(),
      maxBytes: 50,
    })
    expect(res.status).toBe(200)
    await expect(readAll(res.body)).rejects.toBeTruthy()
  })

  it("rejects a non-default port (8443) with 403", async () => {
    const fetchFn = vi.fn(async () => textStreamResponse(["nope"]))
    const res = await handleFetchRelay("https://arxiv.org:8443/x", "port1", {
      fetchFn,
      ipBuckets: freshBucket(),
    })
    expect(res.status).toBe(403)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it("rejects a redirect to a non-default port with 403", async () => {
    const fetchFn = vi.fn(async () => redirectResponse("https://arxiv.org:8443/y"))
    const res = await handleFetchRelay("https://arxiv.org/start", "port2", {
      fetchFn,
      ipBuckets: freshBucket(),
    })
    expect(res.status).toBe(403)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it("allows default HTTPS port (443) which WHATWG normalizes to empty string", async () => {
    const fetchFn = vi.fn(async () => textStreamResponse(["ok"]))
    const res = await handleFetchRelay("https://arxiv.org:443/x", "port3", {
      fetchFn,
      ipBuckets: freshBucket(),
    })
    expect(res.status).toBe(200)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it("allows implicit default HTTPS port (no explicit port specified)", async () => {
    const fetchFn = vi.fn(async () => textStreamResponse(["ok"]))
    const res = await handleFetchRelay("https://arxiv.org/x", "port4", {
      fetchFn,
      ipBuckets: freshBucket(),
    })
    expect(res.status).toBe(200)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })
})

it("aborts a stalled upstream request at the configured timeout", async () => {
  const fetchFn: typeof fetch = async (_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new Error("timed out")), { once: true })
  })
  const result = await handleFetchRelay("https://arxiv.org/abs/fixture", "timeout-fixture", { fetchFn, timeoutMs: 5 })
  expect(result.status).toBe(502)
})
