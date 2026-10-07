import { BrowserWindow } from "electron"

/**
 * Gives keyboard focus back to the page. On Windows, after a native dialog (an "Are you sure?"
 * question, or the Save / Open file window) closes, the window can stay active while the page
 * inside it has lost keyboard focus: clicking a field shows no cursor until the user switches
 * to another app and back. Focusing the window and its page again fixes that.
 */
export function restoreKeyboardFocus(win?: BrowserWindow | null): void {
  const w = win ?? BrowserWindow.getAllWindows()[0]
  if (!w || w.isDestroyed() || w.isMinimized() || !w.isVisible()) return
  w.blur()
  w.focus()
  w.webContents.focus()
}
