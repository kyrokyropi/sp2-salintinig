import * as SQLite from 'expo-sqlite';

// ─── types ────────────────────────────────────────────────────────────────────

export type Album = {
  id: number;
  name: string;
  created_at: string;
};

export type Scan = {
  id: number;
  album_id: number;
  name: string;
  original_text: string;
  translated_text: string;
  language: string;
  audio_en_path: string | null;
  audio_tl_path: string | null;
  created_at: string;
};

// ─── db singleton ─────────────────────────────────────────────────────────────

let _db: SQLite.SQLiteDatabase | null = null;

function getDb(): SQLite.SQLiteDatabase {
  if (!_db) {
    _db = SQLite.openDatabaseSync('salintinig.db');
  }
  return _db;
}

// ─── init ─────────────────────────────────────────────────────────────────────

export function initDb(): void {
  const db = getDb();
  db.execSync(`
    CREATE TABLE IF NOT EXISTS albums (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS scans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      original_text TEXT NOT NULL,
      translated_text TEXT NOT NULL,
      language TEXT NOT NULL,
      audio_en_path TEXT,
      audio_tl_path TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

// ─── albums ───────────────────────────────────────────────────────────────────

export function getAlbums(): Album[] {
  return getDb().getAllSync<Album>(
    'SELECT * FROM albums ORDER BY created_at DESC'
  );
}

export function createAlbum(name: string): Album {
  const db = getDb();
  const result = db.runSync('INSERT INTO albums (name) VALUES (?)', [name]);
  return db.getFirstSync<Album>('SELECT * FROM albums WHERE id = ?', [result.lastInsertRowId])!;
}

export function renameAlbum(id: number, name: string): void {
  getDb().runSync('UPDATE albums SET name = ? WHERE id = ?', [name, id]);
}

export function deleteAlbum(id: number): void {
  getDb().runSync('DELETE FROM albums WHERE id = ?', [id]);
}

export function getAlbumScanCount(albumId: number): number {
  const row = getDb().getFirstSync<{ count: number }>(
    'SELECT COUNT(*) as count FROM scans WHERE album_id = ?',
    [albumId]
  );
  return row?.count ?? 0;
}

// ─── scans ────────────────────────────────────────────────────────────────────

export function getScans(albumId: number): Scan[] {
  return getDb().getAllSync<Scan>(
    'SELECT * FROM scans WHERE album_id = ? ORDER BY created_at DESC',
    [albumId]
  );
}

export function createScan(
  albumId: number,
  name: string,
  originalText: string,
  translatedText: string,
  language: string,
  audioEnPath: string | null = null,
  audioTlPath: string | null = null,
): Scan {
  const db = getDb();
  const result = db.runSync(
    `INSERT INTO scans
       (album_id, name, original_text, translated_text, language, audio_en_path, audio_tl_path)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [albumId, name, originalText, translatedText, language, audioEnPath, audioTlPath]
  );
  return db.getFirstSync<Scan>('SELECT * FROM scans WHERE id = ?', [result.lastInsertRowId])!;
}

export function renameScan(id: number, name: string): void {
  getDb().runSync('UPDATE scans SET name = ? WHERE id = ?', [name, id]);
}

export function updateScanText(id: number, text: string): void {
  getDb().runSync('UPDATE scans SET original_text = ? WHERE id = ?', [text, id]);
}

export function deleteScan(id: number): void {
  getDb().runSync('DELETE FROM scans WHERE id = ?', [id]);
}
