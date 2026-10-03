// Loaded explicitly by the disposable E2E server, never by the product runtime.
if (!process.env.SCISPARK_VAULT?.includes("scispark-e2e-") || process.env.SCISPARK_E2E_FEED_FIXTURE !== "1") {
  throw new Error("Feed source fixtures require a disposable E2E vault")
}
const realFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url)
  if (url.hostname !== "export.arxiv.org") return realFetch(input, init)
  if (!url.searchParams.get("search_query")?.includes("SCISPARK_FEED_FIXTURE")) throw new Error("Unexpected public search in feed fixture test")
  const date = new Date().toISOString()
  const entries = [1, 2].map(index => `<entry>
    <id>https://arxiv.org/abs/2609.9900${index}</id>
    <title>Background feed fixture paper ${index}</title>
    <summary>Sparse attention methods improve auditory decoding in this fictional test.</summary>
    <published>${date}</published><updated>${date}</updated>
    <author><name>Fixture Author</name></author><category term="q-bio.NC" />
  </entry>`).join("")
  return new Response(`<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">${entries}</feed>`, { headers: { "content-type": "application/atom+xml" } })
}
