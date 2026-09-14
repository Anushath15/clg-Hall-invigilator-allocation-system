/**
 * Migration 002: Add global_order to rotation_history for cross-cycle chronological ordering.
 * Note: Runtime migrations are applied via database.ts inline runner.
 * This file is maintained for schema documentation and migration history.
 */

export async function up(db: any): Promise<void> {
  const cols = db.query("PRAGMA table_info(rotation_history)")
  const hasCol = cols.some((c: any) => c.name === "global_order")
  if (!hasCol) {
    db.run("ALTER TABLE rotation_history ADD COLUMN global_order INTEGER")
  }

  db.run("CREATE INDEX IF NOT EXISTS idx_rotation_history_user_order ON rotation_history(user_id, global_order DESC)")

  const rows = db.query("SELECT id FROM rotation_history ORDER BY datetime(recorded_at) ASC, id ASC")
  let order = 1
  for (const r of rows) {
    db.run("UPDATE rotation_history SET global_order = ? WHERE id = ?", [order++, r.id])
  }
}