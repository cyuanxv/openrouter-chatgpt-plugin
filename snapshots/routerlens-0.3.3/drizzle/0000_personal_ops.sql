CREATE TABLE reports (id TEXT PRIMARY KEY NOT NULL, kind TEXT NOT NULL, created_at TEXT NOT NULL, payload TEXT NOT NULL, delivery_state TEXT NOT NULL DEFAULT 'pending', message_id TEXT);
--> statement-breakpoint
CREATE TABLE experiments (id TEXT PRIMARY KEY NOT NULL, created_at TEXT NOT NULL, plan TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE observations (experiment_id TEXT NOT NULL REFERENCES experiments(id), case_id TEXT NOT NULL, variant TEXT NOT NULL, generation_id TEXT, cost_usd REAL NOT NULL, latency_ms REAL, quality_pass INTEGER NOT NULL, success INTEGER NOT NULL, source TEXT NOT NULL, PRIMARY KEY (experiment_id,case_id,variant));
