const LANPET_SCHEMA_VERSION = 1
const DETAIL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const TOMBSTONE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000

function migrateLanpetDatabase(db, now = Date.now()) {
  if (!db || typeof db.exec !== 'function') throw new Error('DATABASE_UNAVAILABLE')

  const migrate = db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS lanpet_schema (
        singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
        version INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS lanpet_settings (
        singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
        enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
        sharing_enabled INTEGER NOT NULL DEFAULT 0 CHECK (sharing_enabled IN (0, 1)),
        allow_visit INTEGER NOT NULL DEFAULT 1 CHECK (allow_visit IN (0, 1)),
        allow_cooperative_play INTEGER NOT NULL DEFAULT 1 CHECK (allow_cooperative_play IN (0, 1)),
        allow_gift INTEGER NOT NULL DEFAULT 1 CHECK (allow_gift IN (0, 1)),
        allow_battle INTEGER NOT NULL DEFAULT 1 CHECK (allow_battle IN (0, 1)),
        blocked_peer_ids_json TEXT NOT NULL DEFAULT '[]',
        work_start_hour INTEGER NOT NULL DEFAULT 9,
        work_end_hour INTEGER NOT NULL DEFAULT 18,
        weekdays_json TEXT NOT NULL DEFAULT '[1,2,3,4,5]',
        notifications_enabled INTEGER NOT NULL DEFAULT 0 CHECK (notifications_enabled = 0),
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS lanpet_generations (
        generation_id TEXT PRIMARY KEY,
        status TEXT NOT NULL CHECK (status IN ('active', 'deleted')),
        created_at INTEGER NOT NULL,
        deleted_at INTEGER,
        tombstone_until INTEGER NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS lanpet_one_active_generation
        ON lanpet_generations(status) WHERE status = 'active';

      CREATE TABLE IF NOT EXISTS lanpet_pets (
        pet_id TEXT PRIMARY KEY,
        generation_id TEXT NOT NULL UNIQUE,
        owner_installation_id TEXT NOT NULL,
        name TEXT NOT NULL,
        temperament TEXT NOT NULL,
        stage TEXT NOT NULL CHECK (stage IN ('seed', 'young', 'grown')),
        appearance_id TEXT NOT NULL,
        care INTEGER NOT NULL CHECK (care BETWEEN 0 AND 100),
        joy INTEGER NOT NULL CHECK (joy BETWEEN 0 AND 100),
        energy INTEGER NOT NULL CHECK (energy BETWEEN 0 AND 100),
        bond INTEGER NOT NULL CHECK (bond BETWEEN 0 AND 100),
        growth_points INTEGER NOT NULL CHECK (growth_points >= 0),
        care_bias INTEGER NOT NULL CHECK (care_bias BETWEEN -100 AND 100),
        social_bias INTEGER NOT NULL CHECK (social_bias BETWEEN -100 AND 100),
        lifecycle_state TEXT NOT NULL,
        born_at INTEGER NOT NULL,
        stage_changed_at INTEGER NOT NULL,
        last_evaluated_at INTEGER NOT NULL,
        last_pet_interaction_at INTEGER NOT NULL,
        care_remainder_minutes REAL NOT NULL DEFAULT 0,
        joy_remainder_minutes REAL NOT NULL DEFAULT 0,
        energy_remainder_minutes REAL NOT NULL DEFAULT 0,
        growth_age_minutes REAL NOT NULL DEFAULT 0,
        nap_ends_at INTEGER,
        state_revision INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (generation_id) REFERENCES lanpet_generations(generation_id)
      );

      CREATE TABLE IF NOT EXISTS lanpet_events (
        event_id TEXT PRIMARY KEY,
        pet_id TEXT NOT NULL,
        generation_id TEXT NOT NULL,
        session_id TEXT,
        sequence INTEGER,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        applied_revision INTEGER NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS lanpet_event_session_sequence
        ON lanpet_events(session_id, sequence) WHERE session_id IS NOT NULL AND sequence IS NOT NULL;
      CREATE INDEX IF NOT EXISTS lanpet_events_created_at ON lanpet_events(created_at DESC);

      CREATE TABLE IF NOT EXISTS lanpet_inventory (
        pet_id TEXT NOT NULL,
        item_type TEXT NOT NULL,
        quantity INTEGER NOT NULL CHECK (quantity >= 0),
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (pet_id, item_type)
      );

      CREATE TABLE IF NOT EXISTS lanpet_reward_ledger (
        ledger_id TEXT PRIMARY KEY,
        pet_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        reward_type TEXT NOT NULL,
        amount INTEGER NOT NULL,
        source_type TEXT NOT NULL,
        peer_id TEXT,
        created_at INTEGER NOT NULL,
        UNIQUE (pet_id, event_id, reward_type)
      );

      CREATE INDEX IF NOT EXISTS lanpet_rewards_window
        ON lanpet_reward_ledger(pet_id, created_at, reward_type, source_type);

      CREATE TABLE IF NOT EXISTS lanpet_invitations (
        invite_id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL UNIQUE,
        peer_id TEXT NOT NULL,
        direction TEXT NOT NULL,
        activity_type TEXT NOT NULL,
        status TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS lanpet_sessions (
        session_id TEXT PRIMARY KEY,
        peer_id TEXT NOT NULL,
        activity_type TEXT NOT NULL,
        role TEXT NOT NULL,
        status TEXT NOT NULL,
        protocol_version INTEGER NOT NULL DEFAULT 1,
        canonical_sequence INTEGER NOT NULL DEFAULT 0,
        result_json TEXT,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS lanpet_inbox (
        sender_fingerprint TEXT NOT NULL,
        request_id TEXT NOT NULL,
        event_id TEXT,
        session_id TEXT,
        sequence INTEGER,
        generation_id TEXT NOT NULL,
        message_type TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        terminal_response_json TEXT,
        status TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        tombstone_until INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (sender_fingerprint, request_id)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS lanpet_inbox_session_sequence
        ON lanpet_inbox(session_id, sequence) WHERE session_id IS NOT NULL AND sequence IS NOT NULL;

      CREATE TABLE IF NOT EXISTS lanpet_outbox (
        message_id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL,
        event_id TEXT,
        session_id TEXT,
        recipient_fingerprint TEXT NOT NULL,
        message_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS lanpet_outbox_pending
        ON lanpet_outbox(status, next_attempt_at, expires_at);

      CREATE TABLE IF NOT EXISTS lanpet_gift_ledger (
        gift_event_id TEXT PRIMARY KEY,
        direction TEXT NOT NULL,
        peer_id TEXT NOT NULL,
        item_type TEXT NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity = 1),
        status TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS lanpet_gifts_window
        ON lanpet_gift_ledger(direction, peer_id, created_at);

      CREATE TABLE IF NOT EXISTS lanpet_protocol_records (
        namespace TEXT NOT NULL,
        record_id TEXT NOT NULL,
        value_json TEXT NOT NULL,
        expires_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (namespace, record_id)
      );

      CREATE INDEX IF NOT EXISTS lanpet_protocol_expiry
        ON lanpet_protocol_records(namespace, expires_at);
    `)

    db.prepare(`
      INSERT INTO lanpet_settings (
        singleton_id, enabled, sharing_enabled, allow_visit, allow_cooperative_play,
        allow_gift, allow_battle, blocked_peer_ids_json, work_start_hour, work_end_hour,
        weekdays_json, notifications_enabled, updated_at
      ) VALUES (1, 0, 0, 1, 1, 1, 1, '[]', 9, 18, '[1,2,3,4,5]', 0, ?)
      ON CONFLICT(singleton_id) DO NOTHING
    `).run(now)

    db.prepare(`
      INSERT INTO lanpet_schema (singleton_id, version, updated_at)
      VALUES (1, ?, ?)
      ON CONFLICT(singleton_id) DO UPDATE SET
        version = CASE WHEN version < excluded.version THEN excluded.version ELSE version END,
        updated_at = CASE WHEN version < excluded.version THEN excluded.updated_at ELSE updated_at END
    `).run(LANPET_SCHEMA_VERSION, now)
  })

  migrate()
  return LANPET_SCHEMA_VERSION
}

module.exports = {
  LANPET_SCHEMA_VERSION,
  DETAIL_RETENTION_MS,
  TOMBSTONE_RETENTION_MS,
  migrateLanpetDatabase,
}
