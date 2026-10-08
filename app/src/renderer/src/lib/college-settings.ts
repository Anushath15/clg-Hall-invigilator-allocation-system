import { api } from "./api"

/**
 * The saved Settings, read at the moment a PDF is exported. A page that read them when it opened
 * would print an older college name if Settings were changed afterwards, so every export asks again.
 */
export async function currentSettings(): Promise<Record<string, string>> {
  try { return (await api.getSettings()) ?? {} } catch { return {} }
}
