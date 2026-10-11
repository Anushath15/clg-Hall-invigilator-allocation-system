import type { UnallocatedRow } from "../lib/export-seating-pdf"

const rollOrder = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" })

/** Students left without a seat, by roll number, with the reason for each. */
export default function UnallocatedTable({ rows }: { rows: UnallocatedRow[] }) {
  const sorted = [...rows].sort((a, b) => rollOrder.compare(a.roll_no, b.roll_no))
  return (
    <div className="overflow-x-auto border border-brand-border rounded-lg">
      <table className="w-full text-xs">
        <thead className="bg-gray-50 border-b border-brand-border">
          <tr>{["Roll No", "Name", "Category", "Gender", "Reason"].map(h => <th key={h} className="text-left px-3 py-2 font-semibold text-brand-textsec uppercase tracking-wider">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-brand-border">
          {sorted.map(u => (
            <tr key={u.roll_no} className="align-top">
              <td className="px-3 py-1.5 font-mono font-semibold whitespace-nowrap">{u.roll_no}</td>
              <td className="px-3 py-1.5">{u.name ?? ""}</td>
              <td className="px-3 py-1.5 whitespace-nowrap">{u.category}</td>
              <td className="px-3 py-1.5">{u.gender === "M" ? "Male" : "Female"}</td>
              <td className="px-3 py-1.5 text-brand-textsec">{u.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
