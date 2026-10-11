CREATE TABLE routing_presets (
  id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  config TEXT NOT NULL,
  PRIMARY KEY(id, revision)
);
