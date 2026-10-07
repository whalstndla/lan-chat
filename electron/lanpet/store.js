const { DETAIL_RETENTION_MS, TOMBSTONE_RETENTION_MS, migrateLanpetDatabase } = require('./migrations')

function parseJson(value, fallback) {
  if (typeof value !== 'string') return fallback
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function toBoolean(value) {
  return value === 1 || value === true
}

function mapSettings(row) {
  return {
    enabled: toBoolean(row.enabled),
    sharingEnabled: toBoolean(row.sharing_enabled),
    allowVisit: toBoolean(row.allow_visit),
    allowCooperativePlay: toBoolean(row.allow_cooperative_play),
    allowGift: toBoolean(row.allow_gift),
    allowBattle: toBoolean(row.allow_battle),
    blockedPeerIds: parseJson(row.blocked_peer_ids_json, []),
    workHours: {
      startHour: row.work_start_hour,
      endHour: row.work_end_hour,
      weekdays: parseJson(row.weekdays_json, [1, 2, 3, 4, 5]),
    },
    notificationsEnabled: false,
    updatedAt: row.updated_at,
  }
}

function mapPet(row) {
  if (!row) return null
  return {
    petId: row.pet_id,
    generationId: row.generation_id,
    ownerInstallationId: row.owner_installation_id,
    name: row.name,
    temperament: row.temperament,
    stage: row.stage,
    appearanceId: row.appearance_id,
    care: row.care,
    joy: row.joy,
    energy: row.energy,
    bond: row.bond,
    growthPoints: row.growth_points,
    careBias: row.care_bias,
    socialBias: row.social_bias,
    lifecycleState: row.lifecycle_state,
    bornAt: row.born_at,
    stageChangedAt: row.stage_changed_at,
    lastEvaluatedAt: row.last_evaluated_at,
    lastPetInteractionAt: row.last_pet_interaction_at,
    careRemainderMinutes: row.care_remainder_minutes,
    joyRemainderMinutes: row.joy_remainder_minutes,
    energyRemainderMinutes: row.energy_remainder_minutes,
    growthAgeMinutes: row.growth_age_minutes,
    napEndsAt: row.nap_ends_at,
    stateRevision: row.state_revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapEvent(row) {
  return {
    eventId: row.event_id,
    petId: row.pet_id,
    generationId: row.generation_id,
    sessionId: row.session_id,
    sequence: row.sequence,
    type: row.event_type,
    payload: parseJson(row.payload_json, {}),
    createdAt: row.created_at,
    appliedRevision: row.applied_revision,
  }
}

class LanpetStore {
  constructor(db, options = {}) {
    if (!db || typeof db.prepare !== 'function') throw new Error('DATABASE_UNAVAILABLE')
    this.db = db
    this.now = options.now || (() => Date.now())
    migrateLanpetDatabase(db, this.now())
  }

  assertOpen() {
    if (!this.db || this.db.open === false) throw new Error('DATABASE_CLOSED')
  }

  transaction(callback) {
    this.assertOpen()
    return this.db.transaction(() => callback(this))()
  }

  getSettings() {
    this.assertOpen()
    return mapSettings(this.db.prepare('SELECT * FROM lanpet_settings WHERE singleton_id = 1').get())
  }

  updateSettings(changes, now = this.now()) {
    const current = this.getSettings()
    const enabled = changes.enabled === undefined ? current.enabled : Boolean(changes.enabled)
    let sharingEnabled = changes.sharingEnabled === undefined
      ? current.sharingEnabled
      : Boolean(changes.sharingEnabled)
    if (!enabled) sharingEnabled = false
    const allowVisit = changes.allowVisit === undefined ? current.allowVisit : Boolean(changes.allowVisit)
    const allowCooperativePlay = changes.allowCooperativePlay === undefined
      ? current.allowCooperativePlay
      : Boolean(changes.allowCooperativePlay)
    const allowGift = changes.allowGift === undefined ? current.allowGift : Boolean(changes.allowGift)
    const allowBattle = changes.allowBattle === undefined ? current.allowBattle : Boolean(changes.allowBattle)
    const blockedPeerIds = changes.blockedPeerIds === undefined ? current.blockedPeerIds : changes.blockedPeerIds
    this.db.prepare(`
      UPDATE lanpet_settings
      SET enabled = ?, sharing_enabled = ?, allow_visit = ?, allow_cooperative_play = ?,
          allow_gift = ?, allow_battle = ?, blocked_peer_ids_json = ?,
          notifications_enabled = 0, updated_at = ?
      WHERE singleton_id = 1
    `).run(
      enabled ? 1 : 0,
      sharingEnabled ? 1 : 0,
      allowVisit ? 1 : 0,
      allowCooperativePlay ? 1 : 0,
      allowGift ? 1 : 0,
      allowBattle ? 1 : 0,
      JSON.stringify(blockedPeerIds),
      now
    )
    return this.getSettings()
  }

  createGeneration(generationId, now = this.now()) {
    this.assertOpen()
    this.db.prepare(`
      INSERT INTO lanpet_generations (generation_id, status, created_at, deleted_at, tombstone_until)
      VALUES (?, 'active', ?, NULL, ?)
    `).run(generationId, now, now + TOMBSTONE_RETENTION_MS)
  }

  deleteGeneration(generationId, now = this.now()) {
    this.assertOpen()
    this.db.prepare(`
      UPDATE lanpet_generations
      SET status = 'deleted', deleted_at = ?, tombstone_until = ?
      WHERE generation_id = ? AND status = 'active'
    `).run(now, now + TOMBSTONE_RETENTION_MS, generationId)
  }

  getGeneration(generationId) {
    this.assertOpen()
    const row = this.db.prepare('SELECT * FROM lanpet_generations WHERE generation_id = ?').get(generationId)
    if (!row) return null
    return {
      generationId: row.generation_id,
      status: row.status,
      createdAt: row.created_at,
      deletedAt: row.deleted_at,
      tombstoneUntil: row.tombstone_until,
    }
  }

  getPet() {
    this.assertOpen()
    return mapPet(this.db.prepare(`
      SELECT pet.* FROM lanpet_pets pet
      JOIN lanpet_generations generation ON generation.generation_id = pet.generation_id
      WHERE generation.status = 'active'
      LIMIT 1
    `).get())
  }

  createPet(pet) {
    this.assertOpen()
    this.db.prepare(`
      INSERT INTO lanpet_pets (
        pet_id, generation_id, owner_installation_id, name, temperament, stage,
        appearance_id, care, joy, energy, bond, growth_points, care_bias, social_bias,
        lifecycle_state, born_at, stage_changed_at, last_evaluated_at,
        last_pet_interaction_at, care_remainder_minutes, joy_remainder_minutes,
        energy_remainder_minutes, growth_age_minutes, nap_ends_at, state_revision, created_at, updated_at
      ) VALUES (
        @petId, @generationId, @ownerInstallationId, @name, @temperament, @stage,
        @appearanceId, @care, @joy, @energy, @bond, @growthPoints, @careBias, @socialBias,
        @lifecycleState, @bornAt, @stageChangedAt, @lastEvaluatedAt,
        @lastPetInteractionAt, @careRemainderMinutes, @joyRemainderMinutes,
        @energyRemainderMinutes, @growthAgeMinutes, @napEndsAt, @stateRevision, @createdAt, @updatedAt
      )
    `).run(pet)
    return this.getPet()
  }

  savePet(pet) {
    this.assertOpen()
    const result = this.db.prepare(`
      UPDATE lanpet_pets SET
        name = @name,
        temperament = @temperament,
        stage = @stage,
        appearance_id = @appearanceId,
        care = @care,
        joy = @joy,
        energy = @energy,
        bond = @bond,
        growth_points = @growthPoints,
        care_bias = @careBias,
        social_bias = @socialBias,
        lifecycle_state = @lifecycleState,
        stage_changed_at = @stageChangedAt,
        last_evaluated_at = @lastEvaluatedAt,
        last_pet_interaction_at = @lastPetInteractionAt,
        care_remainder_minutes = @careRemainderMinutes,
        joy_remainder_minutes = @joyRemainderMinutes,
        energy_remainder_minutes = @energyRemainderMinutes,
        growth_age_minutes = @growthAgeMinutes,
        nap_ends_at = @napEndsAt,
        state_revision = @stateRevision,
        updated_at = @updatedAt
      WHERE pet_id = @petId AND generation_id = @generationId
    `).run(pet)
    if (result.changes !== 1) throw new Error('PET_NOT_FOUND')
    return this.getPet()
  }

  removePet(petId) {
    this.assertOpen()
    this.db.prepare('DELETE FROM lanpet_inventory WHERE pet_id = ?').run(petId)
    this.db.prepare('DELETE FROM lanpet_reward_ledger WHERE pet_id = ?').run(petId)
    this.db.prepare('DELETE FROM lanpet_events WHERE pet_id = ?').run(petId)
    this.db.prepare('DELETE FROM lanpet_pets WHERE pet_id = ?').run(petId)
  }

  appendEvent(event) {
    this.assertOpen()
    this.db.prepare(`
      INSERT INTO lanpet_events (
        event_id, pet_id, generation_id, session_id, sequence, event_type,
        payload_json, created_at, applied_revision
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.eventId,
      event.petId,
      event.generationId,
      event.sessionId || null,
      event.sequence ?? null,
      event.type,
      JSON.stringify(event.payload || {}),
      event.createdAt,
      event.appliedRevision
    )
  }

  getLatestEvent(type, petId) {
    this.assertOpen()
    const row = this.db.prepare(`
      SELECT * FROM lanpet_events
      WHERE pet_id = ? AND event_type = ?
      ORDER BY created_at DESC LIMIT 1
    `).get(petId, type)
    return row ? mapEvent(row) : null
  }

  getRecentEventCount(type, petId, now = this.now()) {
    this.assertOpen()
    return this.db.prepare(`
      SELECT COUNT(*) AS total FROM lanpet_events
      WHERE pet_id = ? AND event_type = ? AND created_at > ? AND created_at <= ?
    `).get(petId, type, now - 24 * 60 * 60 * 1000, now).total
  }

  listHistory(limit = 50, now = this.now()) {
    this.assertOpen()
    const safeLimit = Math.max(1, Math.min(200, Number.isInteger(limit) ? limit : 50))
    return this.db.prepare(`
      SELECT * FROM lanpet_events
      WHERE created_at >= ?
      ORDER BY created_at DESC, event_id DESC
      LIMIT ?
    `).all(now - DETAIL_RETENTION_MS, safeLimit).map(mapEvent)
  }

  addReward(entry) {
    this.assertOpen()
    const result = this.db.prepare(`
      INSERT INTO lanpet_reward_ledger (
        ledger_id, pet_id, event_id, reward_type, amount, source_type, peer_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(pet_id, event_id, reward_type) DO NOTHING
    `).run(
      entry.ledgerId,
      entry.petId,
      entry.eventId,
      entry.rewardType,
      entry.amount,
      entry.sourceType,
      entry.peerId || null,
      entry.createdAt
    )
    return result.changes === 1
  }

  hasRewardEvent(petId, eventId) {
    this.assertOpen()
    return Boolean(this.db.prepare(`
      SELECT 1 FROM lanpet_reward_ledger WHERE pet_id = ? AND event_id = ? LIMIT 1
    `).get(petId, eventId))
  }

  getRollingEarned(petId, now = this.now()) {
    this.assertOpen()
    const rows = this.db.prepare(`
      SELECT reward_type, source_type, SUM(amount) AS total, SUM(ABS(amount)) AS magnitude
      FROM lanpet_reward_ledger
      WHERE pet_id = ? AND created_at > ? AND created_at <= ?
      GROUP BY reward_type, source_type
    `).all(petId, now - 24 * 60 * 60 * 1000, now)
    const result = {
      bond: 0,
      growthPoints: 0,
      socialBond: 0,
      socialGrowthPoints: 0,
      biasMagnitude: 0,
      decorationProgress: 0,
    }
    for (const row of rows) {
      if (row.reward_type === 'bond') {
        result.bond += row.total || 0
        if (row.source_type === 'social') result.socialBond += row.total || 0
      }
      if (row.reward_type === 'growthPoints') {
        result.growthPoints += row.total || 0
        if (row.source_type === 'social') result.socialGrowthPoints += row.total || 0
      }
      if (row.reward_type === 'careBias' || row.reward_type === 'socialBias') {
        result.biasMagnitude += row.magnitude || 0
      }
      if (row.reward_type === 'decorationProgress') result.decorationProgress += row.total || 0
    }
    return result
  }

  addInventory(petId, itemType, quantity = 1, now = this.now()) {
    this.assertOpen()
    if (!Number.isInteger(quantity) || quantity < 1) throw new Error('INVALID_QUANTITY')
    this.db.prepare(`
      INSERT INTO lanpet_inventory (pet_id, item_type, quantity, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(pet_id, item_type) DO UPDATE SET
        quantity = lanpet_inventory.quantity + excluded.quantity,
        updated_at = excluded.updated_at
    `).run(petId, itemType, quantity, now)
  }

  listInventory(petId) {
    this.assertOpen()
    if (!petId) return []
    return this.db.prepare(`
      SELECT item_type, quantity, updated_at FROM lanpet_inventory
      WHERE pet_id = ? AND quantity > 0 ORDER BY item_type
    `).all(petId).map(row => ({ itemType: row.item_type, quantity: row.quantity, updatedAt: row.updated_at }))
  }

  countRecentGifts(direction, peerId, now = this.now()) {
    this.assertOpen()
    const row = this.db.prepare(`
      SELECT COUNT(*) AS total FROM lanpet_gift_ledger
      WHERE direction = ? AND created_at > ? AND created_at <= ?
        AND (? IS NULL OR peer_id = ?)
        AND status IN ('issued', 'capped')
    `).get(direction, now - 24 * 60 * 60 * 1000, now, peerId || null, peerId || null)
    return row.total
  }

  addGiftRecord(entry) {
    this.assertOpen()
    const result = this.db.prepare(`
      INSERT INTO lanpet_gift_ledger (
        gift_event_id, direction, peer_id, item_type, quantity, status,
        expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)
      ON CONFLICT(gift_event_id) DO NOTHING
    `).run(
      entry.eventId,
      entry.direction,
      entry.peerId,
      entry.itemType,
      entry.status || 'issued',
      entry.expiresAt,
      entry.createdAt,
      entry.createdAt
    )
    return result.changes === 1
  }

  getProtocolRecord(namespace, recordId) {
    this.assertOpen()
    const row = this.db.prepare(`
      SELECT value_json, expires_at, created_at, updated_at
      FROM lanpet_protocol_records WHERE namespace = ? AND record_id = ?
    `).get(namespace, recordId)
    if (!row) return null
    return {
      ...parseJson(row.value_json, {}),
      recordId,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  setProtocolRecord(namespace, recordId, value, options = {}) {
    this.assertOpen()
    const now = options.now || this.now()
    const expiresAt = options.expiresAt ?? value.expiresAt ?? null
    this.db.prepare(`
      INSERT INTO lanpet_protocol_records (
        namespace, record_id, value_json, expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(namespace, record_id) DO UPDATE SET
        value_json = excluded.value_json,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at
    `).run(namespace, recordId, JSON.stringify(value), expiresAt, now, now)
    return this.getProtocolRecord(namespace, recordId)
  }

  listProtocolRecords(namespace) {
    this.assertOpen()
    return this.db.prepare(`
      SELECT record_id, value_json, expires_at, created_at, updated_at
      FROM lanpet_protocol_records WHERE namespace = ? ORDER BY updated_at DESC
    `).all(namespace).map(row => ({
      ...parseJson(row.value_json, {}),
      recordId: row.record_id,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
  }

  removeProtocolRecord(namespace, recordId) {
    this.assertOpen()
    return this.db.prepare(`
      DELETE FROM lanpet_protocol_records WHERE namespace = ? AND record_id = ?
    `).run(namespace, recordId).changes === 1
  }

  cleanupRetention(now = this.now()) {
    this.assertOpen()
    const cleanup = this.db.transaction(() => {
      const events = this.db.prepare('DELETE FROM lanpet_events WHERE created_at < ?').run(now - DETAIL_RETENTION_MS).changes
      const rewards = this.db.prepare('DELETE FROM lanpet_reward_ledger WHERE created_at < ?').run(now - DETAIL_RETENTION_MS).changes
      const gifts = this.db.prepare(`
        DELETE FROM lanpet_gift_ledger WHERE expires_at < ? OR updated_at < ?
      `).run(now, now - TOMBSTONE_RETENTION_MS).changes
      const inbox = this.db.prepare('DELETE FROM lanpet_inbox WHERE tombstone_until < ?').run(now).changes
      const outbox = this.db.prepare(`
        DELETE FROM lanpet_outbox WHERE expires_at < ? AND updated_at < ?
      `).run(now, now - TOMBSTONE_RETENTION_MS).changes
      const invitations = this.db.prepare(`
        DELETE FROM lanpet_invitations WHERE expires_at < ? AND updated_at < ?
      `).run(now, now - DETAIL_RETENTION_MS).changes
      const sessions = this.db.prepare(`
        DELETE FROM lanpet_sessions WHERE expires_at < ? AND updated_at < ?
      `).run(now, now - TOMBSTONE_RETENTION_MS).changes
      const protocol = this.cleanupProtocolRetention(now)
      const generations = this.db.prepare(`
        DELETE FROM lanpet_generations
        WHERE status = 'deleted' AND tombstone_until < ?
      `).run(now).changes
      return { events, rewards, gifts, inbox, outbox, invitations, sessions, protocol, generations }
    })
    return cleanup()
  }

  cleanupProtocolRetention(now) {
    const terminalStatuses = new Set(['completed', 'declined', 'canceled', 'expired', 'deleted'])
    const sessions = new Map(this.listProtocolRecords('sessions').map(session => [session.sessionId, session]))
    const unresolved = new Set([...sessions.values()].filter(session =>
      !terminalStatuses.has(session.status) || session.energyReserved > 0 ||
      (session.role === 'host' && session.certificate && !session.remoteAcknowledged)
    ).map(session => session.sessionId))
    let changed = 0
    for (const session of sessions.values()) {
      // 미확정 정산과 예약은 시간 경과만으로 버리거나 환불하지 않는다.
      if (unresolved.has(session.sessionId)) continue
      const settledAt = session.settledAt || session.updatedAt
      const retainUntil = session.retainUntil || settledAt + TOMBSTONE_RETENTION_MS
      if (retainUntil <= now) {
        changed += Number(this.removeProtocolRecord('sessions', session.sessionId))
      } else if (!session.tombstone && settledAt + DETAIL_RETENTION_MS <= now) {
        this.setProtocolRecord('sessions', session.sessionId, {
          sessionId: session.sessionId, peerId: session.peerId, activity: session.activity,
          role: session.role, generations: session.generations, fingerprints: session.fingerprints,
          status: session.status, energyReserved: 0, remoteAcknowledged: session.remoteAcknowledged,
          certificateEventId: session.certificate?.eventId, settledAt, retainUntil, tombstone: true,
        }, { now, expiresAt: retainUntil })
        changed += 1
      }
    }
    for (const entry of this.listProtocolRecords('outbox')) {
      const envelope = entry.envelope
      if (unresolved.has(envelope?.sessionId)) continue
      const session = sessions.get(envelope?.sessionId)
      const settledSession = session && session.status !== 'deleted' && terminalStatuses.has(session.status)
      const settledAt = entry.settledAt || session?.settledAt || entry.updatedAt
      const retainUntil = entry.retainUntil || settledAt + TOMBSTONE_RETENTION_MS
      if (retainUntil <= now) {
        changed += Number(this.removeProtocolRecord('outbox', entry.recordId))
      } else if (!entry.tombstone && (entry.status !== 'pending' || settledSession) && settledAt + DETAIL_RETENTION_MS <= now) {
        this.setProtocolRecord('outbox', entry.recordId, {
          peerId: entry.peerId, status: entry.status === 'pending' ? 'settled' : entry.status, settledAt, retainUntil, tombstone: true,
          envelope: {
            eventId: envelope.eventId, requestId: envelope.requestId, sessionId: envelope.sessionId,
            senderGeneration: envelope.senderGeneration, recipientGeneration: envelope.recipientGeneration,
            messageType: envelope.messageType,
          },
        }, { now, expiresAt: retainUntil })
        changed += 1
      }
    }
    const rows = this.db.prepare(`
      SELECT namespace, record_id, expires_at, updated_at FROM lanpet_protocol_records
      WHERE namespace NOT IN ('sessions', 'outbox')
    `).all()
    for (const row of rows) {
      // 요청 중복 확인용 해시는 마지막 유효 재전송 기간까지 유지한다.
      const retainUntil = Math.max(row.expires_at || 0, row.updated_at + TOMBSTONE_RETENTION_MS)
      if (retainUntil <= now) changed += Number(this.removeProtocolRecord(row.namespace, row.record_id))
    }
    return changed
  }
}

function createLanpetStore(db, options) {
  return new LanpetStore(db, options)
}

module.exports = {
  LanpetStore,
  createLanpetStore,
  mapPet,
  mapSettings,
}
