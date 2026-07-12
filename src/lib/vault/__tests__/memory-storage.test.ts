import { describe } from "vitest"
import { MemoryVaultStorage } from "../memory-storage"
import { storageContractTests } from "../storage-contract"

describe("MemoryVaultStorage", () => {
  storageContractTests("memory", async () => new MemoryVaultStorage())
})
