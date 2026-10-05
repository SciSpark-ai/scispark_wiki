"""Reviewed OpenCite 0.5.4 bridge. Executed only by SciSpark's command worker.
The original CLI is broader. This bridge exposes only S2 search, observed public
PDFs, local conversion and citation formatting. No key or arbitrary URL input.
"""
import asyncio
import base64
import json
import os
from pathlib import Path
import sys
from urllib.parse import urlencode

import httpx
from opencite.config import Config
from opencite.clients.semantic_scholar import SemanticScholarClient
from opencite.formatters.json_fmt import JsonFormatter
from opencite.formatters.bibtex_fmt import BibtexFormatter
from opencite.convert import convert_pdf


async def main():
    value = json.loads(sys.argv[1])
    if set(value) != {"query", "limit", "fullText"} or not isinstance(value["query"], str) or not 1 <= len(value["query"]) <= 1000 or type(value["limit"]) is not int or not 1 <= value["limit"] <= 20 or type(value["fullText"]) is not bool:
        raise ValueError("Invalid reviewed input")
    handles = json.loads(os.environ["SCISPARK_CONNECTION_HANDLES"])
    if len(handles) != 1 or handles[0]["origin"] != "http://semantic-scholar.scispark.invalid":
        raise ValueError("Missing captured Semantic Scholar connection")
    connection = handles[0]
    # The sandbox owns HTTP_PROXY; this is virtual HTTP, never HTTPS CONNECT.
    proxy = os.environ.get("HTTP_PROXY") or os.environ.get("http_proxy")
    if not proxy:
        raise ValueError("Missing isolated broker transport")
    config = Config()  # Deliberately never Config.from_env()/dotenv/user config.
    config.max_retries = 1
    config.timeout = 30
    config.semantic_scholar_api_key = ""
    config.mistral_api_key = ""
    client = SemanticScholarClient(config)
    result = {"schemaVersion": 1, "packageVersion": "0.5.4", "sourceStatus": "ok", "papers": [], "bibtex": "", "documents": []}
    async with httpx.AsyncClient(base_url=connection["origin"] + "/graph/v1", proxy=httpx.Proxy(proxy, headers={"Proxy-Authorization": "Bearer " + connection["handle"]}), trust_env=False, follow_redirects=False, timeout=30) as transport:
        # Inject the exact library's HTTP client; all egress still hits the broker.
        client._client = transport
        try:
            response = await transport.get("/paper/search", params={"query": value["query"], "limit": value["limit"], "fields": "paperId,title,abstract,year,url,openAccessPdf,citationCount,externalIds,authors,journal,citationStyles,isOpenAccess"})
            if response.status_code != 200:
                result["sourceStatus"] = "rate-limited" if response.status_code == 429 else "unavailable"
                print(json.dumps(result)); return
            papers = [client._parse_paper(p) for p in response.json()["data"] if p.get("title")][:value["limit"]]
            result["papers"] = json.loads(JsonFormatter().format_papers(papers, verbose=True))
            result["bibtex"] = BibtexFormatter().format_papers(papers)
            if value["fullText"]:
                for index, paper in enumerate(papers[:2]):
                    if not paper.pdf_locations:
                        continue
                    url = paper.pdf_locations[0].url
                    document = {"paperIndex": index, "url": url, "status": "unavailable"}
                    try:
                        response = await transport.get(connection["origin"] + "/document?" + urlencode({"url": url}))
                        if response.status_code == 200 and len(response.content) <= 524288 and response.content.startswith(b"%PDF-"):
                            path = Path(f"paper-{index}.pdf")
                            path.write_bytes(response.content)
                            document.update(status="ok", pdfBase64=base64.b64encode(response.content).decode("ascii"))
                            try:
                                document["markdown"] = convert_pdf(path, converter="markitdown", mistral_api_key="")[:32000]
                            except Exception:
                                pass  # PDF remains valid; do not invent converted full text.
                    except Exception:
                        pass
                    result["documents"].append(document)
            print(json.dumps(result, ensure_ascii=False))
        finally:
            client._client = None


if __name__ == "__main__":
    asyncio.run(main())
