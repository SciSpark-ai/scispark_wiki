"use client"

import { useEffect, useState } from "react"
import { getVault } from "@/lib/vault/get-vault"
import { createVault, VaultExistsError } from "@/lib/vault/scaffold"
import { exportVaultZip } from "@/lib/vault/export"

export default function VaultDebugPage() {
  const [files, setFiles] = useState<string[]>([])
  const [selfTest, setSelfTest] = useState("running…")

  useEffect(() => {
    ;(async () => {
      const vault = await getVault()
      try {
        await createVault(vault, { purpose: "Debug vault.", today: new Date().toISOString().slice(0, 10) })
      } catch (e) {
        if (!(e instanceof VaultExistsError)) throw e
      }
      // contract self-test (mirrors storage-contract.ts assertions)
      const probe = `debug/probe-${Date.now()}.md`
      const results: string[] = []
      results.push((await vault.read("debug/missing.md")) === null ? "read-missing ok" : "read-missing FAIL")
      await vault.write(probe, "hello")
      results.push((await vault.read(probe)) === "hello" ? "write-read ok" : "write-read FAIL")
      await vault.delete(probe)
      results.push((await vault.read(probe)) === null ? "delete ok" : "delete FAIL")
      setSelfTest(results.join(" · "))
      setFiles(await vault.list())
    })()
  }, [])

  const download = async () => {
    const vault = await getVault()
    const zip = await exportVaultZip(vault)
    const url = URL.createObjectURL(new Blob([zip as Uint8Array<ArrayBuffer>], { type: "application/zip" }))
    const a = Object.assign(document.createElement("a"), { href: url, download: "scispark-vault.zip" })
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={{ padding: 24, fontFamily: "monospace" }}>
      <h1>Vault debug</h1>
      <p>Self-test: {selfTest}</p>
      <button onClick={download}>Export zip</button>
      <ul>{files.map((f) => <li key={f}>{f}</li>)}</ul>
    </div>
  )
}
