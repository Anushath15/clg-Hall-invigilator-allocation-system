/**
 * confirm() and alert() open a native Windows pop-up. When it closes the window stays active
 * but the page loses keyboard focus, so text fields show no cursor until the user switches to
 * another app and back. After each pop-up the desktop app is asked (main/focus.ts) to hand
 * the page its keyboard focus again. The question, its wording and its answer are unchanged.
 */
export function keepKeyboardFocusAfterNativeDialogs(win: Window = window): void {
  const refocus = () => { try { (win as any).api?.refocusWindow?.() } catch { /* not the desktop app */ } }
  const confirmNative = win.confirm.bind(win)
  const alertNative = win.alert.bind(win)
  win.confirm = (message?: string) => { const answer = confirmNative(message); refocus(); return answer }
  win.alert = (message?: any) => { alertNative(message); refocus() }
}
