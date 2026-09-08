const crypto = require('crypto')
const { createLanpetStore } = require('./store')
const {
  WORK_HOURS,
  ROLLING_LIMITS,
  clamp,
  isWorkingHours,
  workingMinutesBetween,
  addWorkingMinutes,
  evaluatePetState,
  applyLocalAction,
  getGrowthChoices,
  applyGrowth,
  deriveMood,
  getLowStateMultiplier,
} = require('./engine')
const { TOMBSTONE_RETENTION_MS } = require('./migrations')

const serviceCache = new WeakMap()
const NETWORK_COMMANDS = new Set(['invite', 'respond', 'action', 'end'])
const ERROR_MESSAGES = Object.freeze({
  DATABASE_UNAVAILABLE: '랜펫 저장소를 사용할 수 없어요.',
  SESSION_STALE: '로그인 정보가 바뀌었어요. 랜펫을 다시 열어 주세요.',
  FEATURE_DISABLED: '랜펫이 꺼져 있어요.',
  PET_ALREADY_EXISTS: '이미 함께하는 랜펫이 있어요.',
  PET_NOT_FOUND: '먼저 랜펫 친구를 맞이해 주세요.',
  INVALID_COMMAND: '이 요청은 처리할 수 없어요. 화면을 새로고침한 뒤 다시 시도해 주세요.',
  INVALID_NAME: '이름을 1자 이상 24자 이하로 입력해 주세요.',
  INVALID_ACTION: '지원하지 않는 돌봄 활동이에요.',
  OUTSIDE_WORK_HOURS: '랜펫 활동은 월요일부터 금요일, 오전 9시부터 오후 6시까지 할 수 있어요.',
  PET_UNAVAILABLE: '지금은 랜펫 활동을 시작할 수 없어요.',
  PET_RESTING_AWAY: '새 활동을 시작하기 전에 내 펫 화면에서 다시 만나기를 눌러 주세요.',
  WELCOME_BACK_UNAVAILABLE: '다시 만나기는 오랫동안 자리를 비운 뒤에 사용할 수 있어요.',
  REST_ALREADY_ACTIVE: '랜펫이 이미 쉬고 있어요.',
  INSUFFICIENT_ENERGY: '이 활동을 하려면 에너지가 더 필요해요.',
  GROWTH_NOT_AVAILABLE: '아직 이 모습으로 성장할 수 없어요.',
  CLOCK_ROLLBACK: '기기 시간이 이전 기록과 맞지 않아 활동을 잠시 멈췄어요. 기기 시간을 확인해 주세요.',
  IDEMPOTENCY_CONFLICT: '이미 처리한 요청과 내용이 달라요. 화면을 새로고침한 뒤 다시 시도해 주세요.',
  PROTOCOL_UNAVAILABLE: '친구와의 랜펫 활동을 잠시 사용할 수 없어요.',
  INVALID_SOCIAL_REWARD: '친구와 함께한 활동의 결과를 확인할 수 없어요.',
  GIFT_LIMIT_REACHED: '최근 24시간 동안 보낼 수 있는 기념품 수를 모두 사용했어요.',
  INVALID_REQUEST: '친구와의 활동 요청을 처리할 수 없어요.',
  PET_SHARING_DISABLED: '내 펫 공개가 꺼져 있어요.',
  ACTIVITY_DISABLED: '이 활동은 허용되어 있지 않아요.',
  PEER_UNAVAILABLE: '친구의 랜펫이 지금은 함께 놀 수 없는 상태예요.',
  PEER_OFFLINE: '친구가 접속하지 않았어요.',
  SESSION_CONFLICT: '이미 다른 랜펫 활동이 진행 중이에요.',
  INVITE_RATE_LIMITED: '잠시 기다린 뒤 다시 초대해 주세요.',
  PEER_KEY_CHANGED: '랜챗에서 친구의 변경된 신원 정보를 확인한 뒤 다시 시도해 주세요.',
  NOT_ENOUGH_ENERGY: '이 활동을 하려면 에너지가 더 필요해요.',
  SESSION_NOT_FOUND: '해당 랜펫 활동을 찾을 수 없어요.',
  INVALID_STATE_TRANSITION: '활동 상태가 바뀌었어요. 화면을 새로고침해 주세요.',
  TURN_EXPIRED: '이번 판의 선택 시간이 끝났어요.',
  INPUT_ALREADY_SUBMITTED: '이번 판의 행동을 이미 선택했어요.',
})

const SOCIAL_REWARDS = Object.freeze({
  visit: Object.freeze({ joy: 4, bond: 1, growthPoints: 1, socialBias: 2, energyCost: 0, decorationProgress: 0 }),
  cooperativePlay: Object.freeze({ joy: 6, bond: 2, growthPoints: 2, socialBias: 2, energyCost: 6, decorationProgress: 0 }),
  battle: Object.freeze({ joy: 0, bond: 0, growthPoints: 0, socialBias: 0, energyCost: 6, decorationProgress: 1 }),
  gift: Object.freeze({ joy: 0, bond: 0, growthPoints: 0, socialBias: 0, energyCost: 0, decorationProgress: 0 }),
})

function commandHash(input) {
  return crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex')
}

function normalizeError(error) {
  const code = error && ERROR_MESSAGES[error.code || error.message]
    ? (error.code || error.message)
    : 'INVALID_COMMAND'
  return { ok: false, code, message: ERROR_MESSAGES[code] }
}

function validateName(name) {
  if (typeof name !== 'string') return null
  const normalized = name.trim()
  if (normalized.length < 1 || normalized.length > 24) return null
  return normalized
}

function capSocialReward(rule, rollingEarned) {
  const bondAvailable = Math.min(
    Math.max(0, ROLLING_LIMITS.bond - rollingEarned.bond),
    Math.max(0, ROLLING_LIMITS.socialBond - rollingEarned.socialBond)
  )
  const growthAvailable = Math.min(
    Math.max(0, ROLLING_LIMITS.growthPoints - rollingEarned.growthPoints),
    Math.max(0, ROLLING_LIMITS.socialGrowthPoints - rollingEarned.socialGrowthPoints)
  )
  const biasAvailable = Math.max(0, ROLLING_LIMITS.biasMagnitude - rollingEarned.biasMagnitude)
  return {
    bond: Math.min(rule.bond, bondAvailable),
    growthPoints: Math.min(rule.growthPoints, growthAvailable),
    socialBias: Math.min(rule.socialBias, biasAvailable),
    decorationProgress: Math.min(rule.decorationProgress || 0, Math.max(0, 3 - (rollingEarned.decorationProgress || 0))),
  }
}

class LanpetService {
  constructor(ctx, options = {}) {
    const db = ctx && ctx.state && ctx.state.database
    if (!db) throw new Error('DATABASE_UNAVAILABLE')
    this.ctx = ctx
    this.db = db
    this.now = options.now || (() => Date.now())
    this.randomId = options.randomId || (prefix => `${prefix}_${crypto.randomUUID()}`)
    this.store = createLanpetStore(db, { now: this.now })
    this.protocolFactory = options.protocolFactory || null
    this.protocol = null
    this.protocolInitAttempted = false
    this.protocolInitError = null
    this.listeners = new Set()
    this.disposed = false
    this.store.cleanupRetention(this.now())
  }

  assertCurrentSession() {
    if (this.disposed || !this.ctx || !this.ctx.state || this.ctx.state.database !== this.db || this.db.open === false) {
      const error = new Error('SESSION_STALE')
      error.code = 'SESSION_STALE'
      throw error
    }
  }

  getSettings() {
    this.assertCurrentSession()
    return this.store.getSettings()
  }

  getLocalPet() {
    this.assertCurrentSession()
    return this.store.getPet()
  }

  getProtocol() {
    this.assertCurrentSession()
    if (this.protocol) return this.protocol
    if (this.protocolInitAttempted) return null
    this.protocolInitAttempted = true
    try {
      const factory = this.protocolFactory || require('./protocol').createLanpetProtocol
      this.protocol = factory({ ctx: this.ctx, service: this, now: this.now })
      return this.protocol
    } catch (error) {
      this.protocolInitError = error
      return null
    }
  }

  subscribe(listener) {
    if (typeof listener !== 'function') return () => {}
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emitChanged() {
    if (this.disposed) return
    for (const listener of this.listeners) {
      try {
        listener()
      } catch {
        // 한 렌더러 구독 오류가 다른 구독자 갱신을 막지 않게 한다.
      }
    }
  }

  evaluateAndSave(now = this.now()) {
    const pet = this.store.getPet()
    if (!pet) return null
    const settings = this.store.getSettings()
    if (!settings.enabled) return pet
    const evaluated = evaluatePetState(pet, now, settings.workHours)
    const shouldSave = evaluated.lastEvaluatedAt !== pet.lastEvaluatedAt ||
      evaluated.lifecycleState !== pet.lifecycleState ||
      evaluated.stateRevision !== pet.stateRevision
    return shouldSave ? this.store.savePet(evaluated) : evaluated
  }

  getSnapshot() {
    this.assertCurrentSession()
    const now = this.now()
    const settings = this.store.getSettings()
    const pet = settings.enabled ? this.store.transaction(() => this.evaluateAndSave(now)) : this.store.getPet()
    const decoratedPet = pet
      ? { ...pet, mood: deriveMood(pet), growthChoices: getGrowthChoices(pet, now) }
      : null
    const protocol = this.getProtocol()
    let protocolSnapshot = {}
    if (protocol && typeof protocol.getSnapshot === 'function') {
      try {
        protocolSnapshot = protocol.getSnapshot() || {}
      } catch {
        protocolSnapshot = {}
      }
    }
    const localHistory = this.store.listHistory(50, now)
    const protocolHistory = Array.isArray(protocolSnapshot.history) ? protocolSnapshot.history : []
    const history = [...localHistory, ...protocolHistory]
      .sort((first, second) => (second.createdAt || 0) - (first.createdAt || 0))
      .slice(0, 50)
    return {
      enabled: settings.enabled,
      sharingEnabled: settings.sharingEnabled,
      allowVisit: settings.allowVisit,
      allowCooperativePlay: settings.allowCooperativePlay,
      allowGift: settings.allowGift,
      allowBattle: settings.allowBattle,
      blockedPeerIds: settings.blockedPeerIds,
      workHours: settings.workHours,
      isWorkingTime: isWorkingHours(now, settings.workHours),
      pet: decoratedPet,
      peers: Array.isArray(protocolSnapshot.peers) ? protocolSnapshot.peers : [],
      invitations: Array.isArray(protocolSnapshot.invitations) ? protocolSnapshot.invitations : [],
      sessions: Array.isArray(protocolSnapshot.sessions) ? protocolSnapshot.sessions : [],
      history,
      inventory: this.store.listInventory(pet && pet.petId),
    }
  }

  readIdempotentCommand(input) {
    if (!input.requestId) return null
    const record = this.store.getProtocolRecord('localCommands', input.requestId)
    if (!record) return null
    if (record.inputHash !== commandHash(input)) {
      const error = new Error('IDEMPOTENCY_CONFLICT')
      error.code = 'IDEMPOTENCY_CONFLICT'
      throw error
    }
    return record
  }

  rememberCommand(input, now) {
    if (!input.requestId) return
    this.store.setProtocolRecord('localCommands', input.requestId, {
      inputHash: commandHash(input),
      status: 'completed',
    }, { now, expiresAt: now + TOMBSTONE_RETENTION_MS })
  }

  command(input) {
    try {
      this.assertCurrentSession()
      if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.type !== 'string') {
        throw new Error('INVALID_COMMAND')
      }
      const duplicate = this.readIdempotentCommand(input)
      if (duplicate) return { ok: true, snapshot: this.getSnapshot(), duplicate: true }

      if (NETWORK_COMMANDS.has(input.type)) {
        const protocol = this.getProtocol()
        if (!protocol || typeof protocol.command !== 'function') throw new Error('PROTOCOL_UNAVAILABLE')
        return Promise.resolve(protocol.command(input)).then(result => {
          if (!result || result.ok === false) return result || normalizeError(new Error('PROTOCOL_UNAVAILABLE'))
          this.rememberCommand(input, this.now())
          this.emitChanged()
          return { ok: true, snapshot: this.getSnapshot() }
        }).catch(normalizeError)
      }

      const now = this.now()
      let postCommitAction = null
      this.store.transaction(() => {
        if (input.type === 'create') this.create(input, now)
        else if (input.type === 'care') this.care(input, now)
        else if (input.type === 'grow') this.grow(input, now)
        else if (input.type === 'settings') {
          this.settings(input, now)
          postCommitAction = 'refreshVisibility'
        } else if (input.type === 'delete') {
          this.delete(now)
          postCommitAction = 'flush'
        }
        else throw new Error('INVALID_COMMAND')
        this.rememberCommand(input, now)
      })
      const protocol = this.getProtocol()
      if (postCommitAction === 'refreshVisibility' && protocol && typeof protocol.refreshVisibility === 'function') {
        protocol.refreshVisibility()
      }
      if (postCommitAction === 'flush' && protocol && typeof protocol.flush === 'function') protocol.flush()
      this.emitChanged()
      return { ok: true, snapshot: this.getSnapshot() }
    } catch (error) {
      return normalizeError(error)
    }
  }

  create(input, now) {
    if (this.store.getPet()) throw new Error('PET_ALREADY_EXISTS')
    const name = validateName(input.name)
    if (!name) throw new Error('INVALID_NAME')
    const generationId = this.randomId('generation')
    const petId = this.randomId('pet')
    this.store.createGeneration(generationId, now)
    this.store.createPet({
      petId,
      generationId,
      ownerInstallationId: this.ctx.state.peerId || 'local-installation',
      name,
      temperament: 'balanced',
      stage: 'seed',
      appearanceId: 'seed-balanced-a',
      care: 70,
      joy: 70,
      energy: 80,
      bond: 0,
      growthPoints: 0,
      careBias: 0,
      socialBias: 0,
      lifecycleState: isWorkingHours(now, WORK_HOURS) ? 'active' : 'resting',
      bornAt: now,
      stageChangedAt: now,
      lastEvaluatedAt: now,
      lastPetInteractionAt: now,
      careRemainderMinutes: 0,
      joyRemainderMinutes: 0,
      energyRemainderMinutes: 0,
      growthAgeMinutes: 0,
      napEndsAt: null,
      stateRevision: 1,
      createdAt: now,
      updatedAt: now,
    })
    this.store.updateSettings({ enabled: true, sharingEnabled: false }, now)
    this.store.appendEvent({
      eventId: this.randomId('event'),
      petId,
      generationId,
      type: 'pet.created',
      payload: { name },
      createdAt: now,
      appliedRevision: 1,
    })
  }

  care(input, now) {
    const settings = this.store.getSettings()
    if (!settings.enabled) throw new Error('FEATURE_DISABLED')
    let pet = this.evaluateAndSave(now)
    if (!pet) throw new Error('PET_NOT_FOUND')
    const action = input.action
    const latest = this.store.getLatestEvent(`care.${action}`, pet.petId)
    const rollingEarned = this.store.getRollingEarned(pet.petId, now)
    const protocol = this.getProtocol()
    if (action === 'rest' && protocol && typeof protocol.hasActiveSession === 'function' && protocol.hasActiveSession()) {
      throw new Error('SESSION_CONFLICT')
    }
    const reservedEnergy = protocol && typeof protocol.getReservedEnergy === 'function'
      ? protocol.getReservedEnergy()
      : 0
    const result = applyLocalAction(pet, {
      action,
      now,
      workHours: settings.workHours,
      lastSameActionAt: latest && latest.createdAt,
      rollingEarned,
      reservedEnergy,
    })
    if (!result.ok) throw new Error(result.code)
    pet = this.store.savePet(result.pet)
    const eventId = this.randomId('event')
    this.store.appendEvent({
      eventId,
      petId: pet.petId,
      generationId: pet.generationId,
      type: `care.${action}`,
      payload: { repeated: result.repeated, rewards: result.rewards },
      createdAt: now,
      appliedRevision: pet.stateRevision,
    })
    this.recordRewards(pet.petId, eventId, result.rewards, 'local', null, now)
  }

  grow(input, now) {
    const settings = this.store.getSettings()
    if (!settings.enabled) throw new Error('FEATURE_DISABLED')
    if (!isWorkingHours(now, settings.workHours)) throw new Error('OUTSIDE_WORK_HOURS')
    const pet = this.evaluateAndSave(now)
    if (!pet) throw new Error('PET_NOT_FOUND')
    if (now < pet.lastEvaluatedAt) throw new Error('CLOCK_ROLLBACK')
    if (pet.lifecycleState === 'restingAway') throw new Error('PET_RESTING_AWAY')
    if (pet.lifecycleState !== 'active') throw new Error('PET_UNAVAILABLE')
    const result = applyGrowth(pet, input.choiceId, now)
    if (!result.ok) throw new Error(result.code)
    const saved = this.store.savePet(result.pet)
    this.store.appendEvent({
      eventId: this.randomId('event'),
      petId: saved.petId,
      generationId: saved.generationId,
      type: 'pet.grown',
      payload: { choiceId: result.choice.choiceId, stage: result.choice.stage, appearanceId: result.choice.appearanceId },
      createdAt: now,
      appliedRevision: saved.stateRevision,
    })
  }

  settings(input, now) {
    const changes = {}
    if (typeof input.enabled === 'boolean') changes.enabled = input.enabled
    if (typeof input.sharingEnabled === 'boolean') changes.sharingEnabled = input.sharingEnabled
    for (const key of ['allowVisit', 'allowCooperativePlay', 'allowGift', 'allowBattle']) {
      if (input[key] !== undefined && typeof input[key] !== 'boolean') throw new Error('INVALID_COMMAND')
      if (typeof input[key] === 'boolean') changes[key] = input[key]
    }
    if (input.blockedPeerIds !== undefined) {
      if (!Array.isArray(input.blockedPeerIds) || input.blockedPeerIds.length > 100 ||
          input.blockedPeerIds.some(peerId => typeof peerId !== 'string' || peerId.length < 1 || peerId.length > 128)) {
        throw new Error('INVALID_COMMAND')
      }
      changes.blockedPeerIds = [...new Set(input.blockedPeerIds)]
    }
    if (Object.keys(changes).length === 0) throw new Error('INVALID_COMMAND')
    if (changes.sharingEnabled && !this.store.getPet()) throw new Error('PET_NOT_FOUND')
    const previousSettings = this.store.getSettings()
    if (changes.enabled === false && previousSettings.enabled) this.evaluateAndSave(now)
    if (changes.enabled === true && !previousSettings.enabled) {
      const pet = this.store.getPet()
      if (pet) {
        // 일시 중지 구간은 다시 켰을 때도 계산하지 않고, 남은 낮잠 시간만 이어 간다.
        const resumedAt = Math.max(pet.lastEvaluatedAt, now)
        const remainingNapMinutes = pet.napEndsAt
          ? workingMinutesBetween(pet.lastEvaluatedAt, pet.napEndsAt, previousSettings.workHours)
          : 0
        const napEndsAt = remainingNapMinutes > 0
          ? addWorkingMinutes(resumedAt, remainingNapMinutes, previousSettings.workHours)
          : null
        let lifecycleState = isWorkingHours(resumedAt, previousSettings.workHours) ? 'active' : 'resting'
        if (napEndsAt) lifecycleState = 'resting'
        if (['ownerConflict', 'recovering'].includes(pet.lifecycleState)) lifecycleState = pet.lifecycleState
        this.store.savePet({ ...pet, napEndsAt, lifecycleState,
          lastEvaluatedAt: resumedAt, lastPetInteractionAt: Math.max(pet.lastPetInteractionAt, resumedAt),
          updatedAt: resumedAt, stateRevision: pet.stateRevision + 1 })
      }
    }
    this.store.updateSettings(changes, now)
  }

  delete(now) {
    const pet = this.store.getPet()
    if (!pet) throw new Error('PET_NOT_FOUND')
    const protocol = this.getProtocol()
    if (protocol && typeof protocol.prepareDelete === 'function') protocol.prepareDelete()
    this.store.deleteGeneration(pet.generationId, now)
    this.store.removePet(pet.petId)
    this.store.updateSettings({ enabled: false, sharingEnabled: false }, now)
  }

  recordRewards(petId, eventId, rewards, sourceType, peerId, now) {
    for (const rewardType of ['bond', 'growthPoints', 'careBias', 'socialBias', 'decorationProgress']) {
      const amount = rewards[rewardType] || 0
      if (amount === 0) continue
      this.store.addReward({
        ledgerId: this.randomId('reward'),
        petId,
        eventId,
        rewardType,
        amount,
        sourceType,
        peerId,
        createdAt: now,
      })
    }
  }

  applySocialReward(input) {
    this.assertCurrentSession()
    const now = input.now || this.now()
    const rule = SOCIAL_REWARDS[input.activity]
    if (!rule || typeof input.eventId !== 'string' || typeof input.peerId !== 'string') {
      throw new Error('INVALID_SOCIAL_REWARD')
    }
    return this.store.transaction(() => {
      const settings = this.store.getSettings()
      const session = input.settlement && input.sessionId
        ? this.store.getProtocolRecord('sessions', input.sessionId)
        : null
      const validSettlement = Boolean(
        input.settlement && session && session.certificate && session.certificate.decision === 'result' &&
        session.certificate.eventId === input.eventId && session.generations &&
        session.generations[this.ctx.state.peerId] === input.generationId
      )
      if ((!settings.enabled || !settings.sharingEnabled) && !validSettlement) throw new Error('FEATURE_DISABLED')
      let pet = this.evaluateAndSave(now)
      if (!pet) throw new Error('PET_NOT_FOUND')
      if (now < pet.lastEvaluatedAt) throw new Error('CLOCK_ROLLBACK')
      if (input.generationId && input.generationId !== pet.generationId) throw new Error('INVALID_SOCIAL_REWARD')
      if (this.store.hasRewardEvent(pet.petId, input.eventId)) return { ok: true, duplicate: true, pet }
      if (pet.energy < rule.energyCost) throw new Error('INSUFFICIENT_ENERGY')

      let giftIssued = null
      if (input.activity === 'gift') {
        const itemType = input.itemType || input.giftType || 'friendshipStar'
        if (itemType !== 'friendshipStar') throw new Error('INVALID_SOCIAL_REWARD')
        const withinRateLimit = this.store.countRecentGifts('received', null, now) < 3 &&
          this.store.countRecentGifts('received', input.peerId, now) < 1
        const currentItem = this.store.listInventory(pet.petId).find(item => item.itemType === itemType)
        const withinInventoryLimit = !currentItem || currentItem.quantity < 10
        giftIssued = withinRateLimit && withinInventoryLimit
        this.store.addGiftRecord({
          eventId: input.eventId,
          direction: 'received',
          peerId: input.peerId,
          itemType,
          status: giftIssued ? 'issued' : 'capped',
          expiresAt: now + TOMBSTONE_RETENTION_MS,
          createdAt: now,
        })
        if (giftIssued) this.store.addInventory(pet.petId, itemType, 1, now)
      }

      const rollingEarned = this.store.getRollingEarned(pet.petId, now)
      const recentCompletions = this.store.getRecentEventCount(`social.${input.activity}`, pet.petId, now)
      const capped = recentCompletions >= 3
        ? { bond: 0, growthPoints: 0, socialBias: 0, decorationProgress: 0 }
        : capSocialReward(rule, rollingEarned)
      const restoredJoy = clamp(pet.joy + rule.joy, 0, 100)
      const lowStateMultiplier = getLowStateMultiplier(pet.care, restoredJoy)
      const bond = Math.floor(capped.bond * lowStateMultiplier)
      const growthPoints = Math.floor(capped.growthPoints * lowStateMultiplier)
      const rewards = {
        bond,
        growthPoints,
        socialBias: capped.socialBias,
        careBias: 0,
        decorationProgress: capped.decorationProgress,
      }
      pet = this.store.savePet({
        ...pet,
        joy: restoredJoy,
        energy: clamp(pet.energy - rule.energyCost, 0, 100),
        bond: clamp(pet.bond + bond, 0, 100),
        growthPoints: pet.growthPoints + growthPoints,
        socialBias: clamp(pet.socialBias + capped.socialBias, -100, 100),
        lifecycleState: settings.enabled && isWorkingHours(now, settings.workHours) ? 'active' : pet.lifecycleState,
        lastPetInteractionAt: Math.max(pet.lastPetInteractionAt, now),
        lastEvaluatedAt: settings.enabled ? Math.max(pet.lastEvaluatedAt, now) : pet.lastEvaluatedAt,
        updatedAt: now,
        stateRevision: pet.stateRevision + 1,
      })
      this.store.addReward({
        ledgerId: this.randomId('reward'),
        petId: pet.petId,
        eventId: input.eventId,
        rewardType: 'socialEvent',
        amount: 0,
        sourceType: 'social',
        peerId: input.peerId,
        createdAt: now,
      })
      this.recordRewards(pet.petId, input.eventId, rewards, 'social', input.peerId, now)
      this.store.appendEvent({
        eventId: input.eventId,
        petId: pet.petId,
        generationId: pet.generationId,
        sessionId: input.sessionId || null,
        sequence: input.sequence ?? null,
        type: `social.${input.activity}`,
        payload: { peerId: input.peerId, outcome: input.outcome || 'completed', rewards, giftIssued },
        createdAt: now,
        appliedRevision: pet.stateRevision,
      })
      this.emitChanged()
      return { ok: true, duplicate: false, pet, rewards }
    })
  }

  getProtocolRecord(namespace, recordId) {
    this.assertCurrentSession()
    return this.store.getProtocolRecord(namespace, recordId)
  }

  setProtocolRecord(namespace, recordId, value, options) {
    this.assertCurrentSession()
    return this.store.setProtocolRecord(namespace, recordId, value, options)
  }

  listProtocolRecords(namespace) {
    this.assertCurrentSession()
    return this.store.listProtocolRecords(namespace)
  }

  removeProtocolRecord(namespace, recordId) {
    this.assertCurrentSession()
    return this.store.removeProtocolRecord(namespace, recordId)
  }

  dispose() {
    if (this.disposed) return
    if (this.protocol && typeof this.protocol.dispose === 'function') this.protocol.dispose()
    this.listeners.clear()
    this.protocol = null
    this.disposed = true
  }
}

function createLanpetService(ctx, options) {
  return new LanpetService(ctx, options)
}

function getLanpetService(ctx) {
  const db = ctx && ctx.state && ctx.state.database
  if (!db) throw new Error('DATABASE_UNAVAILABLE')
  const cached = serviceCache.get(ctx)
  if (cached && cached.db === db && !cached.service.disposed) return cached.service
  if (cached) cached.service.dispose()
  const service = createLanpetService(ctx)
  serviceCache.set(ctx, { db, service })
  return service
}

function disposeLanpetService(ctx) {
  const cached = serviceCache.get(ctx)
  if (!cached) return
  cached.service.dispose()
  serviceCache.delete(ctx)
}

module.exports = {
  LanpetService,
  SOCIAL_REWARDS,
  createLanpetService,
  getLanpetService,
  disposeLanpetService,
}
