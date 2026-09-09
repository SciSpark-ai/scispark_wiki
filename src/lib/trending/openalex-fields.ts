/**
 * Complete OpenAlex /fields catalog, verified 2026-09-06:
 * https://api.openalex.org/fields?per_page=100
 * Bundled for offline selection. Update from the source, not AI-generated names.
 */
export const OPENALEX_FIELD_CATALOG_DATE = "2026-09-06"
const FIELD_ROWS = [
  [11, "Agricultural and Biological Sciences", "Life Sciences"],
  [12, "Arts and Humanities", "Social Sciences"],
  [13, "Biochemistry, Genetics and Molecular Biology", "Life Sciences"],
  [14, "Business, Management and Accounting", "Social Sciences"],
  [15, "Chemical Engineering", "Physical Sciences"],
  [16, "Chemistry", "Physical Sciences"],
  [17, "Computer Science", "Physical Sciences"],
  [18, "Decision Sciences", "Social Sciences"],
  [19, "Earth and Planetary Sciences", "Physical Sciences"],
  [20, "Economics, Econometrics and Finance", "Social Sciences"],
  [21, "Energy", "Physical Sciences"],
  [22, "Engineering", "Physical Sciences"],
  [23, "Environmental Science", "Physical Sciences"],
  [24, "Immunology and Microbiology", "Life Sciences"],
  [25, "Materials Science", "Physical Sciences"],
  [26, "Mathematics", "Physical Sciences"],
  [27, "Medicine", "Health Sciences"],
  [28, "Neuroscience", "Life Sciences"],
  [29, "Nursing", "Health Sciences"],
  [30, "Pharmacology, Toxicology and Pharmaceutics", "Life Sciences"],
  [31, "Physics and Astronomy", "Physical Sciences"],
  [32, "Psychology", "Social Sciences"],
  [33, "Social Sciences", "Social Sciences"],
  [34, "Veterinary", "Health Sciences"],
  [35, "Dentistry", "Health Sciences"],
  [36, "Health Professions", "Health Sciences"],
] as const

export const OPENALEX_FIELDS = FIELD_ROWS.map(([id, label, domain]) => ({
  id: `https://openalex.org/fields/${id}`, label, domain,
})).sort((a, b) => a.label.localeCompare(b.label))

/** Only real field IDs qualify; labels and custom IDs never imply membership. */
export function openAlexField(id: string) {
  const match = /^(?:https?:\/\/openalex\.org\/)?(?:fields\/)?(\d+)$/i.exec(id.trim())
  return match ? OPENALEX_FIELDS.find((field) => field.id === `https://openalex.org/fields/${match[1]}`) : undefined
}

export function canonicalAnchor(id: string): { id: string; label: string } | undefined {
  const field = openAlexField(id)
  return field ? { id: field.id, label: field.label } : undefined
}
