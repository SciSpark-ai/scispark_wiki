import { redirect } from "next/navigation"

export default function LibraryPage() {
  redirect("/wiki?shelf=saved")
}
