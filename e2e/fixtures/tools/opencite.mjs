// DETERMINISTIC CLI fixture only. Not the OpenCite library or source transport.
import { readFileSync } from "node:fs"
const fixtures = JSON.parse(readFileSync(new URL("../../../src/lib/extensions/__tests__/fixtures/opencite-output.json", import.meta.url)))
const scenario = process.argv[2] ?? "search"
if (scenario === "schema-change") fixtures.packageVersion = "0.6.0"
if (scenario === "no-results" || scenario === "rate-limited") { fixtures.papers = []; fixtures.bibtex = "" }
if (scenario === "rate-limited") fixtures.sourceStatus = "rate-limited"
if (scenario === "bundle") fixtures.documents = [{ paperIndex: 0, url: fixtures.papers[0].pdf_locations[0].url, status: "ok", pdfBase64: Buffer.from("%PDF-1.4\nfixture").toString("base64"), markdown: "# Fixture full text" }]
if (scenario === "no-pdf") fixtures.documents = [{ paperIndex: 0, url: fixtures.papers[0].pdf_locations[0].url, status: "unavailable" }]
process.stdout.write(JSON.stringify(fixtures))
