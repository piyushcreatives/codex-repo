import Database from "better-sqlite3";

// Nextcloud's Activity API is an append-only log with no per-user read flag, so
// CloudSpace tracks "read" state itself: a high-water-mark timestamp (everything
// at or before it is read) plus a set of individually-read activity ids that are
// newer than the marker. This is per Nextcloud username and persists across restarts.

const DB_PATH = process.env.ACTIVITY_DB_PATH || "activity-state.db";
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS activity_read (
    username  TEXT PRIMARY KEY,
    marker_ts TEXT,
    read_ids  TEXT NOT NULL DEFAULT '[]'
  )
`);

const selectStmt = db.prepare("SELECT marker_ts, read_ids FROM activity_read WHERE username = ?");
const upsertStmt = db.prepare(`
  INSERT INTO activity_read (username, marker_ts, read_ids)
  VALUES (@username, @marker_ts, @read_ids)
  ON CONFLICT(username) DO UPDATE SET
    marker_ts = excluded.marker_ts,
    read_ids  = excluded.read_ids
`);

export type ActivityReadState = { markerTs: string | null; readIds: Set<number> };

function load(username: string): ActivityReadState {
  const row = selectStmt.get(username) as { marker_ts: string | null; read_ids: string } | undefined;
  if (!row) return { markerTs: null, readIds: new Set() };
  let ids: number[] = [];
  try { ids = JSON.parse(row.read_ids); } catch { /* corrupt — treat as empty */ }
  return { markerTs: row.marker_ts, readIds: new Set(ids) };
}

function save(username: string, state: ActivityReadState) {
  // Cap the explicit-id set so it can't grow unbounded; the marker covers the rest.
  const ids = [...state.readIds].slice(-500);
  upsertStmt.run({ username, marker_ts: state.markerTs, read_ids: JSON.stringify(ids) });
}

export function getActivityReadState(username: string): ActivityReadState {
  return load(username);
}

/** A specific activity is read if explicitly marked, or at/older than the marker. */
export function isActivityRead(state: ActivityReadState, id: number, timestamp: string): boolean {
  if (state.readIds.has(id)) return true;
  if (state.markerTs && timestamp) {
    const t = Date.parse(timestamp);
    const m = Date.parse(state.markerTs);
    if (!Number.isNaN(t) && !Number.isNaN(m) && t <= m) return true;
  }
  return false;
}

export function markActivityRead(username: string, id: number) {
  const state = load(username);
  state.readIds.add(id);
  save(username, state);
}

/** Mark everything up to `nowTs` read; explicit ids become redundant, so clear them. */
export function markAllActivitiesReadFor(username: string, nowTs: string) {
  save(username, { markerTs: nowTs, readIds: new Set() });
}
