CREATE TABLE IF NOT EXISTS pings (
  timestamp INTEGER NOT NULL,
  ip TEXT,
  playerCount INTEGER
);

CREATE TABLE IF NOT EXISTS players_record (
  timestamp INTEGER,
  ip TEXT NOT NULL PRIMARY KEY,
  playerCount INTEGER
);

CREATE INDEX IF NOT EXISTS ip_index ON pings (ip, playerCount);
CREATE INDEX IF NOT EXISTS timestamp_index ON pings (timestamp);
