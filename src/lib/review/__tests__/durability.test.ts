import { afterEach, describe, expect, it } from "vitest"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { NodeFsVaultStorage } from "@/lib/vault/node-fs-storage"
import { extractReviewPdf } from "../pdf"
import { setServerVaultForTests } from "@/lib/server/vault"
import { MemoryVaultStorage } from "@/lib/vault/memory-storage"
import { PUT, DELETE } from "@/app/api/vault/file/route"
import { parseChangeset } from "@/lib/vault/changesets"
const dirs: string[] = []
afterEach(async () => { setServerVaultForTests(null); for (const path of dirs.splice(0)) await rm(path, { recursive: true, force: true }) })
describe("review process boundaries", () => {
  it.each([".SCISPARK/reviews/review/run.json", ".SciSpark/usage/review-attempts.json", ".SCISPARK/settings.json"])("rejects case-insensitive changeset aliases: %s", (path) => {
    expect(() => parseChangeset({ id: "fixture", timestamp: new Date().toISOString(), skill: "ingest", model: "fixture", changes: [{ path, before: null, after: "{}" }] })).toThrow("protected")
  })
  it("serializes separate processes on the same vault and ignores dead contenders", async () => {
    const root = await mkdtemp(join(tmpdir(), "scispark-review-lock-")); dirs.push(root)
    const storage = new NodeFsVaultStorage(root)
    await storage.write("counter.txt", "0")
    await storage.write(".scispark/locks/fixture/2147483647-dead.json", JSON.stringify({ pid: 2147483647, ticket: 0, choosing: true }))
    const script = `import { NodeFsVaultStorage } from ${JSON.stringify(pathToFileURL(resolve("src/lib/vault/node-fs-storage.ts")).href)};
      const storage = new NodeFsVaultStorage(${JSON.stringify(root)});
      for (let i = 0; i < 4; i++) await storage.exclusive("fixture", async () => {
        const current = Number(await storage.read("counter.txt"));
        await new Promise(r => setTimeout(r, 5)); await storage.write("counter.txt", String(current + 1));
      });`
    await Promise.all(Array.from({ length: 3 }, () => promisify(execFile)(process.execPath, ["--experimental-transform-types", "--input-type=module", "-e", script], { timeout: 15_000 })))
    expect(await storage.read("counter.txt")).toBe("12")
    expect(new NodeFsVaultStorage(root).coordinationKey).toBe(storage.coordinationKey)
  }, 20_000)
  it("fails closed for corrupt ownership records", async () => {
    const root = await mkdtemp(join(tmpdir(), "scispark-review-lock-")); dirs.push(root)
    const storage = new NodeFsVaultStorage(root)
    await storage.write(".scispark/locks/fixture/corrupt.json", "not-json")
    await expect(storage.exclusive("fixture", async () => "must not run")).rejects.toThrow()
  })
  it.each([".scispark/reviews/run/run.json", ".scispark/usage/review-attempts.json", ".scispark/locks/review-control/lock.json"])("protects server-owned %s from generic mutation", async (path) => {
    setServerVaultForTests(new MemoryVaultStorage())
    const url = `http://x/api/vault/file?path=${encodeURIComponent(path)}`
    expect((await PUT(new Request(url, { method: "PUT", body: "overwrite" }))).status).toBe(403)
    expect((await DELETE(new Request(url, { method: "DELETE" }))).status).toBe(403)
  })
  it("extracts a real text PDF in a bounded child process; rejects fake/oversize files", async () => {
    const title = "Adult decoding methods test document"
    const sentence = "This is a fictional PDF extraction test with readable adult decoding methods, results and limitations. No scientific claim is made."
    const stream = `BT /F1 12 Tf 50 700 Td (${title}) Tj 0 -20 Td (${sentence}) Tj ET`
    const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`]
    let pdf = "%PDF-1.4\n", offsets = "0000000000 65535 f \n"
    objects.forEach((body, i) => { offsets += `${String(Buffer.byteLength(pdf)).padStart(10, "0")} 00000 n \n`; pdf += `${i + 1} 0 obj\n${body}\nendobj\n` })
    const xref = Buffer.byteLength(pdf)
    pdf += `xref\n0 6\n${offsets}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
    const result = await extractReviewPdf(Buffer.from(pdf))
    expect(result.text).toContain(title); expect(result.text).toContain("fictional PDF")
    expect(result.pagesRead).toBe(1)
    await expect(extractReviewPdf(Buffer.from("fake"))).rejects.toThrow("Choose a PDF")
    await expect(extractReviewPdf(new Uint8Array(5_000_001))).rejects.toThrow("Choose a PDF")
  }, 25_000)
})
