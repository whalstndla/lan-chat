const WORK_HOURS = Object.freeze({
  startHour: 9,
  endHour: 18,
  weekdays: Object.freeze([1, 2, 3, 4, 5]),
})

const ACTION_RULES = Object.freeze({
  care: Object.freeze({ energy: -5, care: 12, bond: 2, growthPoints: 2, careBias: 2 }),
  tidy: Object.freeze({ energy: -3, care: 8, bond: 1, growthPoints: 1, careBias: 1 }),
  play: Object.freeze({ energy: -8, joy: 14, bond: 2, growthPoints: 2, careBias: -2, socialBias: -1 }),
  rest: Object.freeze({}),
  welcomeBack: Object.freeze({}),
})

const ROLLING_LIMITS = Object.freeze({
  bond: 10,
  growthPoints: 12,
  socialBond: 6,
  socialGrowthPoints: 6,
  biasMagnitude: 12,
})

const GROWTH_REQUIREMENTS = Object.freeze({
  young: Object.freeze({ previousStage: 'seed', growthPoints: 40, bond: 15, minimumGrowthAgeMinutes: 9 * 60 }),
  grown: Object.freeze({ previousStage: 'young', growthPoints: 140, bond: 50, minimumGrowthAgeMinutes: 7 * 9 * 60 }),
})

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value))
}

function normalizeWorkHours(workHours = WORK_HOURS) {
  return {
    startHour: Number.isInteger(workHours.startHour) ? workHours.startHour : WORK_HOURS.startHour,
    endHour: Number.isInteger(workHours.endHour) ? workHours.endHour : WORK_HOURS.endHour,
    weekdays: Array.isArray(workHours.weekdays) ? workHours.weekdays : [...WORK_HOURS.weekdays],
  }
}

function isWorkingHours(timestamp, workHours = WORK_HOURS) {
  const schedule = normalizeWorkHours(workHours)
  const date = new Date(timestamp)
  if (!Number.isFinite(date.getTime()) || !schedule.weekdays.includes(date.getDay())) return false
  const minutes = date.getHours() * 60 + date.getMinutes()
  return minutes >= schedule.startHour * 60 && minutes < schedule.endHour * 60
}

function workingMinutesBetween(startTimestamp, endTimestamp, workHours = WORK_HOURS) {
  if (!Number.isFinite(startTimestamp) || !Number.isFinite(endTimestamp) || endTimestamp <= startTimestamp) return 0
  const schedule = normalizeWorkHours(workHours)
  let cursor = new Date(startTimestamp)
  cursor.setHours(0, 0, 0, 0)
  let totalMilliseconds = 0
  let dayGuard = 0

  while (cursor.getTime() < endTimestamp && dayGuard < 370) {
    if (schedule.weekdays.includes(cursor.getDay())) {
      const workStart = new Date(cursor)
      const workEnd = new Date(cursor)
      workStart.setHours(schedule.startHour, 0, 0, 0)
      workEnd.setHours(schedule.endHour, 0, 0, 0)
      const overlapStart = Math.max(startTimestamp, workStart.getTime())
      const overlapEnd = Math.min(endTimestamp, workEnd.getTime())
      if (overlapEnd > overlapStart) totalMilliseconds += overlapEnd - overlapStart
    }
    cursor.setDate(cursor.getDate() + 1)
    cursor.setHours(0, 0, 0, 0)
    dayGuard += 1
  }

  return totalMilliseconds / 60000
}

function addWorkingMinutes(startTimestamp, minutes, workHours = WORK_HOURS) {
  if (!Number.isFinite(startTimestamp) || !Number.isFinite(minutes) || minutes < 0) throw new Error('INVALID_TIME')
  if (minutes === 0) return startTimestamp
  const schedule = normalizeWorkHours(workHours)
  let cursor = new Date(startTimestamp)
  let remainingMilliseconds = minutes * 60000
  let dayGuard = 0

  while (remainingMilliseconds > 0 && dayGuard < 370) {
    const day = new Date(cursor)
    day.setHours(0, 0, 0, 0)
    const workStart = new Date(day)
    const workEnd = new Date(day)
    workStart.setHours(schedule.startHour, 0, 0, 0)
    workEnd.setHours(schedule.endHour, 0, 0, 0)

    if (!schedule.weekdays.includes(day.getDay()) || cursor.getTime() >= workEnd.getTime()) {
      cursor.setDate(cursor.getDate() + 1)
      cursor.setHours(0, 0, 0, 0)
      dayGuard += 1
      continue
    }
    if (cursor.getTime() < workStart.getTime()) cursor = workStart
    const availableMilliseconds = workEnd.getTime() - cursor.getTime()
    const consumedMilliseconds = Math.min(availableMilliseconds, remainingMilliseconds)
    cursor = new Date(cursor.getTime() + consumedMilliseconds)
    remainingMilliseconds -= consumedMilliseconds
  }

  if (remainingMilliseconds > 0) throw new Error('WORK_SCHEDULE_RANGE_EXCEEDED')
  return cursor.getTime()
}

function deriveLifecycleState(pet, now, workHours = WORK_HOURS) {
  if (pet.lifecycleState === 'ownerConflict' || pet.lifecycleState === 'recovering' || pet.lifecycleState === 'visiting') {
    return pet.lifecycleState
  }
  if (now - pet.lastPetInteractionAt >= 24 * 60 * 60 * 1000) return 'restingAway'
  if (pet.napEndsAt && now < pet.napEndsAt) return 'resting'
  return isWorkingHours(now, workHours) ? 'active' : 'resting'
}

function evaluatePetState(pet, now, workHours = WORK_HOURS) {
  if (!pet) return null
  if (!Number.isFinite(now)) throw new Error('INVALID_TIME')
  const lastEvaluatedAt = Number.isFinite(pet.lastEvaluatedAt) ? pet.lastEvaluatedAt : now
  if (now <= lastEvaluatedAt) {
    return {
      ...pet,
      lifecycleState: deriveLifecycleState(pet, lastEvaluatedAt, workHours),
      clockRollbackDetected: now < lastEvaluatedAt,
    }
  }

  const awayBoundary = pet.lastPetInteractionAt + 24 * 60 * 60 * 1000
  const decayEnd = Math.min(now, awayBoundary)
  const workMinutes = workingMinutesBetween(lastEvaluatedAt, decayEnd, workHours)
  const carePool = (pet.careRemainderMinutes || 0) + workMinutes
  const joyPool = (pet.joyRemainderMinutes || 0) + workMinutes
  const napWorkEnd = pet.napEndsAt ? Math.min(decayEnd, pet.napEndsAt) : lastEvaluatedAt
  const napWorkMinutes = pet.napEndsAt
    ? workingMinutesBetween(lastEvaluatedAt, napWorkEnd, workHours)
    : 0
  const energyPool = (pet.energyRemainderMinutes || 0) + Math.max(0, workMinutes - napWorkMinutes)
  const careLoss = Math.min(6, Math.floor(carePool / 180))
  const joyLoss = Math.min(4, Math.floor(joyPool / 240))
  const energyGain = Math.floor(energyPool / 30)
  const napCompleted = Boolean(pet.napEndsAt && now >= pet.napEndsAt)
  const totalEnergyGain = energyGain + (napCompleted ? 12 : 0)

  const nextPet = {
    ...pet,
    care: clamp(pet.care - careLoss, 0, 100),
    joy: clamp(pet.joy - joyLoss, 0, 100),
    energy: clamp(pet.energy + totalEnergyGain, 0, 100),
    careRemainderMinutes: decayEnd >= awayBoundary ? 0 : carePool % 180,
    joyRemainderMinutes: decayEnd >= awayBoundary ? 0 : joyPool % 240,
    energyRemainderMinutes: pet.energy + totalEnergyGain >= 100 ? 0 : energyPool % 30,
    growthAgeMinutes: (pet.growthAgeMinutes || 0) + workMinutes,
    lastEvaluatedAt: now,
    updatedAt: now,
    napEndsAt: napCompleted ? null : pet.napEndsAt,
    lifecycleState: deriveLifecycleState({ ...pet, napEndsAt: napCompleted ? null : pet.napEndsAt }, now, workHours),
    clockRollbackDetected: false,
  }

  const changed = workMinutes > 0 || careLoss > 0 || joyLoss > 0 || totalEnergyGain > 0 || napCompleted ||
    nextPet.lifecycleState !== pet.lifecycleState
  if (changed) nextPet.stateRevision = (pet.stateRevision || 0) + 1
  return nextPet
}

function scaleReward(value, multiplier, isStateRestore = false) {
  if (!value) return 0
  const scaled = Math.floor(Math.abs(value) * multiplier)
  const magnitude = isStateRestore ? Math.max(1, scaled) : scaled
  return Math.sign(value) * magnitude
}

function remainingLimit(earned, limit) {
  return Math.max(0, limit - Math.max(0, earned || 0))
}

function applySignedBias(current, requested, usedMagnitude) {
  const available = remainingLimit(usedMagnitude, ROLLING_LIMITS.biasMagnitude)
  const applied = Math.sign(requested) * Math.min(Math.abs(requested), available)
  return { value: clamp(current + applied, -100, 100), applied }
}

function getLowStateMultiplier(care, joy) {
  if (care < 30 && joy < 30) return 0
  if (care < 30 || joy < 30) return 0.5
  return 1
}

function applyLocalAction(pet, input) {
  const { action, now, workHours = WORK_HOURS, lastSameActionAt = null, rollingEarned = {}, reservedEnergy = 0 } = input
  const rule = ACTION_RULES[action]
  if (!rule) return { ok: false, code: 'INVALID_ACTION' }
  if (now < pet.lastEvaluatedAt) return { ok: false, code: 'CLOCK_ROLLBACK' }
  if (!isWorkingHours(now, workHours)) return { ok: false, code: 'OUTSIDE_WORK_HOURS' }
  if (pet.lifecycleState === 'ownerConflict' || pet.lifecycleState === 'recovering' || pet.lifecycleState === 'visiting') {
    return { ok: false, code: 'PET_UNAVAILABLE' }
  }
  if (pet.lifecycleState === 'restingAway' && action !== 'welcomeBack') return { ok: false, code: 'PET_RESTING_AWAY' }
  if (action === 'welcomeBack' && pet.lifecycleState !== 'restingAway') return { ok: false, code: 'WELCOME_BACK_UNAVAILABLE' }
  if (pet.napEndsAt && now < pet.napEndsAt && action !== 'rest') return { ok: false, code: 'PET_UNAVAILABLE' }

  const cost = Math.abs(Math.min(0, rule.energy || 0))
  if (pet.energy - Math.max(0, reservedEnergy) < cost) return { ok: false, code: 'INSUFFICIENT_ENERGY' }

  if (action === 'welcomeBack') {
    return {
      ok: true,
      pet: {
        ...pet,
        care: Math.max(60, pet.care),
        joy: Math.max(60, pet.joy),
        energy: Math.max(70, pet.energy),
        lifecycleState: 'active',
        lastPetInteractionAt: now,
        lastEvaluatedAt: Math.max(pet.lastEvaluatedAt, now),
        updatedAt: now,
        stateRevision: pet.stateRevision + 1,
      },
      rewards: {},
      repeated: false,
    }
  }

  if (action === 'rest') {
    if (pet.napEndsAt && now < pet.napEndsAt) return { ok: false, code: 'REST_ALREADY_ACTIVE' }
    return {
      ok: true,
      pet: {
        ...pet,
        lifecycleState: 'resting',
        napEndsAt: addWorkingMinutes(now, 30, workHours),
        lastPetInteractionAt: now,
        lastEvaluatedAt: Math.max(pet.lastEvaluatedAt, now),
        updatedAt: now,
        stateRevision: pet.stateRevision + 1,
      },
      rewards: {},
      repeated: false,
    }
  }

  const repeated = Number.isFinite(lastSameActionAt) && now - lastSameActionAt < 30 * 60 * 1000
  const multiplier = repeated ? 0.25 : 1
  const careDelta = scaleReward(rule.care || 0, multiplier, true)
  const joyDelta = scaleReward(rule.joy || 0, multiplier, true)
  const energyDelta = rule.energy || 0
  const restoredCare = clamp(pet.care + careDelta, 0, 100)
  const restoredJoy = clamp(pet.joy + joyDelta, 0, 100)
  const lowStateMultiplier = getLowStateMultiplier(restoredCare, restoredJoy)
  const desiredBond = scaleReward(rule.bond || 0, multiplier * lowStateMultiplier)
  const desiredGrowth = scaleReward(rule.growthPoints || 0, multiplier * lowStateMultiplier)
  const bondDelta = Math.min(desiredBond, remainingLimit(rollingEarned.bond, ROLLING_LIMITS.bond))
  const growthDelta = Math.min(desiredGrowth, remainingLimit(rollingEarned.growthPoints, ROLLING_LIMITS.growthPoints))
  const careBias = applySignedBias(pet.careBias, scaleReward(rule.careBias || 0, multiplier), rollingEarned.biasMagnitude)
  const socialBias = applySignedBias(pet.socialBias, scaleReward(rule.socialBias || 0, multiplier), (rollingEarned.biasMagnitude || 0) + Math.abs(careBias.applied))

  return {
    ok: true,
    pet: {
      ...pet,
      care: restoredCare,
      joy: restoredJoy,
      energy: clamp(pet.energy + energyDelta, 0, 100),
      bond: clamp(pet.bond + bondDelta, 0, 100),
      growthPoints: pet.growthPoints + growthDelta,
      careBias: careBias.value,
      socialBias: socialBias.value,
      lifecycleState: 'active',
      lastPetInteractionAt: now,
      lastEvaluatedAt: Math.max(pet.lastEvaluatedAt, now),
      updatedAt: now,
      stateRevision: pet.stateRevision + 1,
    },
    rewards: {
      bond: bondDelta,
      growthPoints: growthDelta,
      careBias: careBias.applied,
      socialBias: socialBias.applied,
    },
    repeated,
  }
}

function growthFamily(pet) {
  if (pet.careBias >= 20) return 'calm'
  if (pet.careBias <= -20) return 'active'
  return 'balanced'
}

function getGrowthChoices(pet, now) {
  if (!pet) return []
  const nextStageByCurrentStage = { seed: 'young', young: 'grown' }
  const nextStage = nextStageByCurrentStage[pet.stage] || null
  if (!nextStage) return []
  const requirement = GROWTH_REQUIREMENTS[nextStage]
  if (pet.growthPoints < requirement.growthPoints || pet.bond < requirement.bond ||
      (pet.growthAgeMinutes || 0) < requirement.minimumGrowthAgeMinutes) return []
  const family = growthFamily(pet)
  const choices = [
    { choiceId: `${nextStage}.${family}.a`, stage: nextStage, appearanceId: `${nextStage}-${family}-a`, family },
    { choiceId: `${nextStage}.${family}.b`, stage: nextStage, appearanceId: `${nextStage}-${family}-b`, family },
  ]
  if (pet.socialBias >= 20) {
    choices.push({ choiceId: `${nextStage}.${family}.social`, stage: nextStage, appearanceId: `${nextStage}-${family}-social`, family: 'social' })
  }
  return choices
}

function applyGrowth(pet, choiceId, now) {
  const choice = getGrowthChoices(pet, now).find(candidate => candidate.choiceId === choiceId)
  if (!choice) return { ok: false, code: 'GROWTH_NOT_AVAILABLE' }
  return {
    ok: true,
    pet: {
      ...pet,
      stage: choice.stage,
      appearanceId: choice.appearanceId,
      stageChangedAt: now,
      updatedAt: now,
      stateRevision: pet.stateRevision + 1,
    },
    choice,
  }
}

function deriveMood(pet) {
  if (!pet) return null
  if (pet.lifecycleState === 'resting' || pet.lifecycleState === 'restingAway') return 'resting'
  if (pet.joy >= 70 && pet.care >= 60) return 'happy'
  if (pet.joy < 30 || pet.care < 30) return 'quiet'
  return 'content'
}

module.exports = {
  WORK_HOURS,
  ACTION_RULES,
  ROLLING_LIMITS,
  GROWTH_REQUIREMENTS,
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
}
