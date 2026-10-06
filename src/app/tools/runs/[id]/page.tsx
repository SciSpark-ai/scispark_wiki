import { notFound } from "next/navigation"
import { UuidSchema } from "@/lib/extensions/contracts"
import { ToolRunView } from "@/components/tools/ToolRunView"
export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UuidSchema.safeParse(id).success) notFound()
  return <main className="mx-auto w-full max-w-4xl p-5 sm:p-7"><ToolRunView runId={id} /></main>
}
