import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { ROOT } from "./lib/paths"

export { ROOT }
export const DB_PATH = process.env.KZ_DB ?? `${ROOT}/data/kommandozentrale.db`

mkdirSync(dirname(DB_PATH), { recursive: true })
mkdirSync(`${ROOT}/data/cache`, { recursive: true })

export const db = new Database(DB_PATH, { create: true })

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS card (
    oracle_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    mana_cost TEXT,
    cmc REAL DEFAULT 0,
    type_line TEXT,
    oracle_text TEXT,
    oracle_text_all TEXT,
    colors TEXT DEFAULT '[]',
    color_identity TEXT DEFAULT '[]',
    keywords TEXT DEFAULT '[]',
    legalities TEXT DEFAULT '{}',
    edhrec_rank INTEGER,
    image_uris TEXT,
    card_faces TEXT,
    layout TEXT,
    set_code TEXT,
    collector_number TEXT,
    rarity TEXT,
    power TEXT,
    toughness TEXT,
    loyalty TEXT,
    defense TEXT,
    produced_mana TEXT,
    is_game_changer INTEGER DEFAULT 0,
    is_one_win INTEGER DEFAULT 0,
    is_land INTEGER DEFAULT 0,
    is_creature INTEGER DEFAULT 0,
    is_legendary INTEGER DEFAULT 0,
    updated_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_card_name ON card(name COLLATE NOCASE);
  CREATE INDEX IF NOT EXISTS idx_card_edhrec ON card(edhrec_rank);
  CREATE INDEX IF NOT EXISTS idx_card_type ON card(type_line);

  CREATE VIRTUAL TABLE IF NOT EXISTS card_fts USING fts5(
    oracle_id UNINDEXED,
    name,
    type_line,
    oracle_text_all,
    tokenize = 'unicode61 remove_diacritics 2'
  );

  CREATE TABLE IF NOT EXISTS card_tag (
    oracle_id TEXT NOT NULL,
    tag TEXT NOT NULL,
    weight TEXT,
    PRIMARY KEY (oracle_id, tag)
  );
  CREATE INDEX IF NOT EXISTS idx_card_tag_tag ON card_tag(tag);

  CREATE TABLE IF NOT EXISTS card_query_cache (
    key TEXT PRIMARY KEY,
    result_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS printing (
    scryfall_id TEXT PRIMARY KEY,
    oracle_id TEXT,
    name TEXT,
    set_code TEXT,
    set_name TEXT,
    collector_number TEXT,
    lang TEXT,
    released_at TEXT,
    image_uris TEXT,
    art_crop TEXT,
    artist TEXT,
    frame TEXT,
    border_color TEXT,
    full_art INTEGER DEFAULT 0,
    textless INTEGER DEFAULT 0,
    promo INTEGER DEFAULT 0,
    variation INTEGER DEFAULT 0,
    fetched_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_printing_oracle ON printing(oracle_id);

  CREATE TABLE IF NOT EXISTS ruling (
    oracle_id TEXT NOT NULL,
    source TEXT,
    published_at TEXT,
    comment TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_ruling_oracle ON ruling(oracle_id);

  CREATE TABLE IF NOT EXISTS cr_version (
    version TEXT PRIMARY KEY,
    effective_date TEXT,
    source_url TEXT,
    imported_at TEXT
  );

  CREATE TABLE IF NOT EXISTS cr_rule (
    version TEXT NOT NULL,
    number TEXT NOT NULL,
    parent TEXT,
    depth INTEGER DEFAULT 0,
    text TEXT NOT NULL,
    is_example INTEGER DEFAULT 0,
    PRIMARY KEY (version, number)
  );
  CREATE INDEX IF NOT EXISTS idx_cr_parent ON cr_rule(parent);

  CREATE VIRTUAL TABLE IF NOT EXISTS cr_fts USING fts5(
    version UNINDEXED,
    number UNINDEXED,
    text,
    tokenize = 'unicode61 remove_diacritics 2'
  );

  CREATE TABLE IF NOT EXISTS cr_glossary (
    version TEXT NOT NULL,
    term TEXT NOT NULL,
    definition TEXT NOT NULL,
    PRIMARY KEY (version, term)
  );

  CREATE TABLE IF NOT EXISTS format_rule (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    citation TEXT,
    sort INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS bracket (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    tagline TEXT,
    description TEXT,
    gc_limit INTEGER,
    expected_turns TEXT,
    quota_json TEXT
  );

  CREATE TABLE IF NOT EXISTS deck (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    commander_oracle_id TEXT,
    commander_name TEXT,
    bracket INTEGER DEFAULT 3,
    pod_size INTEGER DEFAULT 4,
    settings_json TEXT DEFAULT '{}',
    brief TEXT NOT NULL DEFAULT '',
    primer TEXT,
    status TEXT DEFAULT 'draft',
    created_at TEXT,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS deck_card (
    deck_id TEXT NOT NULL,
    oracle_id TEXT NOT NULL,
    quantity INTEGER DEFAULT 1,
    category TEXT,
    role TEXT,
    reason TEXT,
    printing_id TEXT,
    art_url TEXT,
    artist TEXT,
    sort_order INTEGER DEFAULT 0,
    is_commander INTEGER DEFAULT 0,
    board TEXT NOT NULL DEFAULT 'main',
    PRIMARY KEY (deck_id, oracle_id),
    FOREIGN KEY (deck_id) REFERENCES deck(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_deck_card_deck ON deck_card(deck_id);

  CREATE TABLE IF NOT EXISTS deck_revision (
    id TEXT PRIMARY KEY,
    deck_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    label TEXT NOT NULL,
    cards_json TEXT NOT NULL,
    FOREIGN KEY (deck_id) REFERENCES deck(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_deck_revision_deck ON deck_revision(deck_id, created_at);

  CREATE TABLE IF NOT EXISTS build_run (
    id TEXT PRIMARY KEY,
    deck_id TEXT NOT NULL,
    provider TEXT,
    model TEXT,
    status TEXT DEFAULT 'queued',
    message TEXT,
    error TEXT,
    raw_output TEXT,
    started_at TEXT,
    finished_at TEXT
  );

  CREATE TABLE IF NOT EXISTS game (
    id TEXT PRIMARY KEY,
    played_at TEXT,
    pod_size INTEGER,
    winner_deck_id TEXT,
    turns INTEGER,
    notes TEXT,
    fun INTEGER,
    salt INTEGER
  );

  CREATE TABLE IF NOT EXISTS app_state (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    avatar_color TEXT NOT NULL DEFAULT '#a4552f',
    created_at TEXT NOT NULL,
    last_login_at TEXT
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    user_agent TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, expires_at);

  CREATE TABLE IF NOT EXISTS invites (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    label TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT,
    max_uses INTEGER NOT NULL DEFAULT 1,
    uses INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS pod_session (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT,
    host_user_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    version INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    finished_at TEXT,
    game_id TEXT,
    FOREIGN KEY (host_user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_pod_session_status ON pod_session(status, updated_at);

  CREATE TABLE IF NOT EXISTS pod_player (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    deck_id TEXT,
    seat INTEGER NOT NULL,
    life INTEGER NOT NULL DEFAULT 40,
    poison INTEGER NOT NULL DEFAULT 0,
    commander_damage_json TEXT NOT NULL DEFAULT '{}',
    counters_json TEXT NOT NULL DEFAULT '{}',
    statuses_json TEXT NOT NULL DEFAULT '{}',
    eliminated INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES pod_session(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_pod_player_user ON pod_player(session_id, user_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_pod_player_seat ON pod_player(session_id, seat);

  CREATE TABLE IF NOT EXISTS pod_event (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    actor_user_id TEXT,
    kind TEXT NOT NULL,
    before_json TEXT NOT NULL,
    after_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES pod_session(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_pod_event_session ON pod_event(session_id, created_at);

  CREATE TABLE IF NOT EXISTS deck_explanation (
    id TEXT PRIMARY KEY,
    deck_id TEXT NOT NULL,
    deck_updated_at TEXT NOT NULL,
    proposal_hash TEXT NOT NULL,
    model TEXT,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(deck_id, deck_updated_at, proposal_hash),
    FOREIGN KEY (deck_id) REFERENCES deck(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS explain_run (
    id TEXT PRIMARY KEY,
    deck_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    message TEXT,
    error TEXT,
    explanation_id TEXT,
    started_at TEXT,
    finished_at TEXT,
    FOREIGN KEY (deck_id) REFERENCES deck(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_explain_run_deck ON explain_run(deck_id, started_at);

  CREATE TABLE IF NOT EXISTS combo_cache (
    deck_id TEXT NOT NULL,
    deck_updated_at TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    PRIMARY KEY (deck_id, deck_updated_at),
    FOREIGN KEY (deck_id) REFERENCES deck(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS combo_translation (
    variant_id TEXT PRIMARY KEY,
    payload_json TEXT NOT NULL,
    fetched_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS game_participant (
    id TEXT PRIMARY KEY,
    game_id TEXT NOT NULL,
    user_id TEXT,
    deck_id TEXT,
    seat INTEGER,
    starting_life INTEGER,
    ending_life INTEGER,
    eliminated INTEGER NOT NULL DEFAULT 0,
    is_winner INTEGER NOT NULL DEFAULT 0,
    commander_damage_json TEXT NOT NULL DEFAULT '{}',
    poison INTEGER NOT NULL DEFAULT 0,
    counters_json TEXT NOT NULL DEFAULT '{}',
    statuses_json TEXT NOT NULL DEFAULT '{}',
    fun INTEGER,
    salt INTEGER,
    FOREIGN KEY (game_id) REFERENCES game(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_game_participant_game ON game_participant(game_id);
  CREATE INDEX IF NOT EXISTS idx_game_participant_user ON game_participant(user_id, game_id);
`)

function hasColumn(table: string, column: string): boolean {
  const rows = db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return rows.some((row) => row.name === column)
}

function addColumn(table: string, column: string, definition: string) {
  if (!hasColumn(table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
}

// Additive Migrations for the single-user database. Existing rows stay valid.
addColumn("pod_player", "counters_json", "TEXT NOT NULL DEFAULT '{}'")
addColumn("pod_player", "statuses_json", "TEXT NOT NULL DEFAULT '{}'")
addColumn("game_participant", "counters_json", "TEXT NOT NULL DEFAULT '{}'")
addColumn("game_participant", "statuses_json", "TEXT NOT NULL DEFAULT '{}'")
addColumn("deck", "owner_user_id", "TEXT")
addColumn("deck", "visibility", "TEXT NOT NULL DEFAULT 'group'")
addColumn("deck", "brief", "TEXT NOT NULL DEFAULT ''")
addColumn("deck", "commander_printing_id", "TEXT")
addColumn("deck", "commander_art_url", "TEXT")
addColumn("deck", "commander_artist", "TEXT")
addColumn("deck_card", "board", "TEXT NOT NULL DEFAULT 'main'")
db.exec("CREATE INDEX IF NOT EXISTS idx_deck_card_board ON deck_card(deck_id, board)")
const hadDeckSavedAt = hasColumn("deck", "saved_at")
addColumn("deck", "saved_at", "TEXT")
if (!hadDeckSavedAt) {
  // Existing decks were saved implicitly. Only new drafts stay NULL.
  db.exec("UPDATE deck SET saved_at = COALESCE(updated_at, created_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) WHERE saved_at IS NULL")
}
db.exec("CREATE INDEX IF NOT EXISTS idx_deck_saved ON deck(saved_at)")
db.exec(
  `DELETE FROM deck WHERE saved_at IS NULL AND COALESCE(updated_at, created_at) < datetime('now', '-30 days')`,
)
addColumn("game", "created_by", "TEXT")
addColumn("game", "pod_session_id", "TEXT")
addColumn("build_run", "session_id", "TEXT")
addColumn("build_run", "candidate_count", "INTEGER")
addColumn("build_run", "card_count", "INTEGER")
addColumn("build_run", "prompt_tokens_estimate", "INTEGER")
addColumn("build_run", "prompt_tokens", "INTEGER")
addColumn("build_run", "output_tokens", "INTEGER")
addColumn("build_run", "cache_read_tokens", "INTEGER")
addColumn("build_run", "cost_usd", "REAL")
addColumn("explain_run", "session_id", "TEXT")
addColumn("explain_run", "prompt_tokens", "INTEGER")
addColumn("explain_run", "output_tokens", "INTEGER")
addColumn("explain_run", "cache_read_tokens", "INTEGER")
addColumn("explain_run", "cost_usd", "REAL")
db.exec("CREATE INDEX IF NOT EXISTS idx_deck_owner ON deck(owner_user_id)")
db.exec("CREATE INDEX IF NOT EXISTS idx_game_creator ON game(created_by)")

// Backfill the winner of old manual games into the participant table, so the
// personal stats include those entries. Live pods already write participants.
db.exec(`
  INSERT INTO game_participant(id,game_id,user_id,deck_id,seat,starting_life,ending_life,eliminated,is_winner,commander_damage_json,poison,fun,salt)
  SELECT lower(hex(randomblob(16))), g.id, d.owner_user_id, g.winner_deck_id, 1, 40, NULL, 0, 1, '{}', 0, g.fun, g.salt
  FROM game g JOIN deck d ON d.id = g.winner_deck_id
  WHERE g.pod_session_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM game_participant p WHERE p.game_id = g.id)
`)

export function stateGet(key: string): string | null {
  const row = db.query("SELECT value FROM app_state WHERE key = ?").get(key) as { value: string } | null
  return row?.value ?? null
}

export function stateSet(key: string, value: string) {
  db.query("INSERT INTO app_state(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value)
}

export function json<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}
