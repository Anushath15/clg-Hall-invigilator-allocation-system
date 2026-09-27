// True in the offline Electron desktop app (the preload script exposes window.api),
// false in the browser/Firebase web build. The desktop app has no login: it always
// runs as the local admin, and destructive actions use a typed confirmation instead
// of a password.
export const IS_DESKTOP = typeof window !== "undefined" && !!(window as any).api
