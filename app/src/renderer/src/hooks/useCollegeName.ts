import { useEffect, useState } from "react"
import { api } from "../lib/api"

export const DEFAULT_COLLEGE_NAME = "St. Xavier's Catholic College of Engineering (Autonomous), Nagercoil"

// Settings → College Profile → College Name; refreshed when the settings are saved.
export function useCollegeName() {
  const [name, setName] = useState(DEFAULT_COLLEGE_NAME)
  useEffect(() => {
    const load = () => api.getSettings()
      .then((s: any) => setName(s?.["college.name"] ?? DEFAULT_COLLEGE_NAME))
      .catch(() => {})
    load()
    window.addEventListener("hias:settings-changed", load)
    return () => window.removeEventListener("hias:settings-changed", load)
  }, [])
  return name
}
