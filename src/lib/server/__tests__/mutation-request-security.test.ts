import { describe, expect, it } from "vitest"
import { NextRequest } from "next/server"
import { proxy } from "@/proxy"
import { mutationRequestRejection } from "../mutation-request-security"

function request(
  method: string,
  {
    url = "http://127.0.0.1:3000/api/projects",
    host = "127.0.0.1:3000",
    origin,
    fetchSite,
  }: { url?: string; host?: string; origin?: string; fetchSite?: string } = {},
): Request {
  return new Request(url, {
    method,
    headers: {
      host,
      ...(origin === undefined ? {} : { origin }),
      ...(fetchSite === undefined ? {} : { "sec-fetch-site": fetchSite }),
    },
  })
}

describe("mutation request security", () => {
  it("allows read-only APIs regardless of Host", () => {
    expect(mutationRequestRejection(request("GET", { host: "attacker.example" }))).toBeNull()
  })

  it.each([
    ["localhost:3000", "http://localhost:3000"],
    ["127.0.0.1:3000", "http://127.0.0.1:3000"],
    ["[::1]:3000", "http://[::1]:3000"],
  ])("allows a same-origin loopback mutation through %s", (host, origin) => {
    expect(
      mutationRequestRejection(
        request("POST", {
          url: `${origin}/api/projects`,
          host,
          origin,
          fetchSite: "same-origin",
        }),
      ),
    ).toBeNull()
  })

  it("allows an Origin-less loopback request from a local CLI", () => {
    expect(mutationRequestRejection(request("PATCH"))).toBeNull()
  })

  it.each([
    "attacker.example",
    "localhost.attacker.example:3000",
    "evil.example@127.0.0.1:3000",
    "127.0.0.1:3000/path",
    "",
  ])("rejects the unsafe Host %j", (host) => {
    expect(mutationRequestRejection(request("POST", { host }))).not.toBeNull()
  })

  it.each([
    "https://attacker.example",
    "http://localhost:3000",
    "http://127.0.0.1:4000",
    "null",
    "not a URL",
  ])("rejects the unsafe Origin %j", (origin) => {
    expect(mutationRequestRejection(request("DELETE", { origin }))).not.toBeNull()
  })

  it("rejects a cross-site browser signal even if Origin is absent", () => {
    expect(mutationRequestRejection(request("POST", { fetchSite: "cross-site" }))).not.toBeNull()
  })

  it("returns a 403 JSON response from the Next.js proxy", async () => {
    const response = proxy(
      new NextRequest("http://127.0.0.1:3000/api/projects", {
        method: "POST",
        headers: { host: "attacker.example", origin: "https://attacker.example" },
      }),
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: "Mutating APIs are available only from the loopback SciSpark app origin.",
    })
  })
})
