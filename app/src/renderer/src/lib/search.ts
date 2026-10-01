/**
 * The search used in the "Select Invigilators & Halls" dialog, for staff (name, Staff ID) and
 * halls (hall code, block) alike: ignores case and surrounding spaces, matches anywhere in any
 * of the given fields, and an empty search matches everything.
 */
export function matchesSearch(query: string, ...fields: (string | number | null | undefined)[]): boolean {
  const q = query.trim().toLowerCase()
  return !q || fields.some(f => String(f ?? "").toLowerCase().includes(q))
}
