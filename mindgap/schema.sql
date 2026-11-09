
CREATE TABLE IF NOT EXISTS nodes(
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'concept',
  body TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  urls TEXT NOT NULL DEFAULT '[]',
  confidence REAL NOT NULL DEFAULT 1.0,
  created_by TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS edges(
  src TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  dst TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  rel TEXT NOT NULL DEFAULT 'relates_to',
  weight REAL NOT NULL DEFAULT 1.0,
  created_by TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL,
  PRIMARY KEY (src,dst,rel));
-- Full-text index (BM25) over id/title/body/tags. Its own copy of the text, keyed
-- by node id (not rowid: VACUUM may renumber an implicit rowid). Kept in sync by
-- the triggers below; db.connect() rebuilds it when it is out of step with nodes
-- (e.g. first open of a DB made before the index existed).
CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(id, title, body, tags);
CREATE TRIGGER IF NOT EXISTS nodes_fts_ai AFTER INSERT ON nodes BEGIN
  INSERT INTO nodes_fts(id, title, body, tags) VALUES (new.id, new.title, new.body, new.tags);
END;
CREATE TRIGGER IF NOT EXISTS nodes_fts_ad AFTER DELETE ON nodes BEGIN
  DELETE FROM nodes_fts WHERE id = old.id;
END;
CREATE TRIGGER IF NOT EXISTS nodes_fts_au AFTER UPDATE OF id, title, body, tags ON nodes
WHEN old.id IS NOT new.id OR old.title IS NOT new.title OR old.body IS NOT new.body
  OR old.tags IS NOT new.tags BEGIN
  DELETE FROM nodes_fts WHERE id = old.id;
  INSERT INTO nodes_fts(id, title, body, tags) VALUES (new.id, new.title, new.body, new.tags);
END;
CREATE TABLE IF NOT EXISTS supersede_state(
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS supersede_runs(
  run_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL,
  candidates TEXT NOT NULL DEFAULT '[]',
  written TEXT NOT NULL DEFAULT '[]');
