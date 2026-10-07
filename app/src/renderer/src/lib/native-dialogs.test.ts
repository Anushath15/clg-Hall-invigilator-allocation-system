/**
 * After a native confirm()/alert() the page must be handed its keyboard focus back, with the
 * pop-up's answer untouched. Tested with a stand-in window (no real pop-up is shown).
 */
import { describe, it, expect } from "vitest"
import { keepKeyboardFocusAfterNativeDialogs } from "./native-dialogs"

function fakeWindow(answer: boolean, withApi = true) {
  const calls: string[] = []
  const win: any = {
    confirm: (m?: string) => { calls.push("confirm:" + m); return answer },
    alert: (m?: any) => { calls.push("alert:" + m) },
    api: withApi ? { refocusWindow: () => { calls.push("refocus") } } : undefined,
  }
  keepKeyboardFocusAfterNativeDialogs(win)
  return { win, calls }
}

describe("keyboard focus after native dialogs", () => {
  it("confirm returns the user's answer unchanged, then refocuses", () => {
    for (const answer of [true, false]) {
      const { win, calls } = fakeWindow(answer)
      expect(win.confirm("Delete hall H1?")).toBe(answer)
      expect(calls).toEqual(["confirm:Delete hall H1?", "refocus"])
    }
  })
  it("alert refocuses after it closes", () => {
    const { win, calls } = fakeWindow(true)
    win.alert("Done")
    expect(calls).toEqual(["alert:Done", "refocus"])
  })
  it("without the desktop bridge (browser) nothing breaks", () => {
    const { win, calls } = fakeWindow(true, false)
    expect(win.confirm("x")).toBe(true)
    win.alert("y")
    expect(calls).toEqual(["confirm:x", "alert:y"])
  })
})
