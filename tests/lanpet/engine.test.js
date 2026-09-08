const {
  WORK_HOURS,
  isWorkingHours,
  workingMinutesBetween,
  addWorkingMinutes,
  evaluatePetState,
  applyLocalAction,
  getGrowthChoices,
  applyGrowth,
} = require('../../electron/lanpet/engine')

function at(day, hour, minute = 0) {
  return new Date(2026, 8, day, hour, minute, 0, 0).getTime()
}

function petAt(timestamp, overrides = {}) {
  return {
    petId: 'pet_1',
    generationId: 'generation_1',
    ownerInstallationId: 'owner_1',
    name: 'Mori',
    temperament: 'balanced',
    stage: 'seed',
    appearanceId: 'seed-balanced-a',
    care: 70,
    joy: 70,
    energy: 50,
    bond: 0,
    growthPoints: 0,
    careBias: 0,
    socialBias: 0,
    lifecycleState: 'active',
    bornAt: timestamp,
    stageChangedAt: timestamp,
    lastEvaluatedAt: timestamp,
    lastPetInteractionAt: timestamp,
    careRemainderMinutes: 0,
    joyRemainderMinutes: 0,
    energyRemainderMinutes: 0,
    growthAgeMinutes: 0,
    napEndsAt: null,
    stateRevision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  }
}

describe('Lanpet work-hour engine', () => {
  test('recognizes only weekday hours from 09:00 through 17:59', () => {
    expect(isWorkingHours(at(7, 8, 59), WORK_HOURS)).toBe(false)
    expect(isWorkingHours(at(7, 9), WORK_HOURS)).toBe(true)
    expect(isWorkingHours(at(7, 17, 59), WORK_HOURS)).toBe(true)
    expect(isWorkingHours(at(7, 18), WORK_HOURS)).toBe(false)
    expect(isWorkingHours(at(6, 12), WORK_HOURS)).toBe(false)
  })

  test('integrates only the overlapping office minutes across a weekend', () => {
    expect(workingMinutesBetween(at(4, 17), at(7, 10), WORK_HOURS)).toBe(120)
  })

  test('keeps weekend absence penalty-free and enters away rest', () => {
    const friday = at(4, 18)
    const monday = at(7, 9)
    const result = evaluatePetState(petAt(friday), monday, WORK_HOURS)
    expect(result.care).toBe(70)
    expect(result.joy).toBe(70)
    expect(result.energy).toBe(50)
    expect(result.lifecycleState).toBe('restingAway')
  })

  test('produces the same result with background ticks and one restart evaluation', () => {
    const friday = at(4, 17)
    const monday = at(7, 10)
    const direct = evaluatePetState(petAt(friday), monday, WORK_HOURS)
    let incremental = petAt(friday)
    for (let cursor = friday + 5 * 60 * 1000; cursor <= monday; cursor += 5 * 60 * 1000) {
      incremental = evaluatePetState(incremental, cursor, WORK_HOURS)
    }
    expect(incremental.care).toBe(direct.care)
    expect(incremental.joy).toBe(direct.joy)
    expect(incremental.energy).toBe(direct.energy)
    expect(incremental.lifecycleState).toBe(direct.lifecycleState)
  })

  test('preserves sub-minute progress across 30-second snapshot polling', () => {
    const start = at(7, 10)
    const end = at(7, 11)
    const direct = evaluatePetState(petAt(start), end, WORK_HOURS)
    let polled = petAt(start)
    for (let cursor = start + 30000; cursor <= end; cursor += 30000) {
      polled = evaluatePetState(polled, cursor, WORK_HOURS)
    }
    expect(polled).toMatchObject({
      care: direct.care,
      joy: direct.joy,
      energy: direct.energy,
      careRemainderMinutes: direct.careRemainderMinutes,
      joyRemainderMinutes: direct.joyRemainderMinutes,
      energyRemainderMinutes: direct.energyRemainderMinutes,
      growthAgeMinutes: direct.growthAgeMinutes,
    })
  })

  test('never lowers the evaluation cursor after a wall-clock rollback', () => {
    const timestamp = at(7, 12)
    const result = evaluatePetState(petAt(timestamp), timestamp - 60 * 60 * 1000, WORK_HOURS)
    expect(result.lastEvaluatedAt).toBe(timestamp)
    expect(result.clockRollbackDetected).toBe(true)
    expect(result.care).toBe(70)
  })
})

describe('Lanpet actions and growth', () => {
  test('rejects care actions outside office hours', () => {
    const result = applyLocalAction(petAt(at(7, 18)), { action: 'care', now: at(7, 18) })
    expect(result).toEqual({ ok: false, code: 'OUTSIDE_WORK_HOURS' })
  })

  test('rejects an action while the wall clock is behind the persisted cursor', () => {
    const result = applyLocalAction(petAt(at(7, 12)), { action: 'care', now: at(7, 11) })
    expect(result).toEqual({ ok: false, code: 'CLOCK_ROLLBACK' })
  })

  test('applies repeat reduction, rolling limits, and full energy cost', () => {
    const now = at(7, 10)
    const result = applyLocalAction(petAt(now, { care: 40, energy: 50, bond: 9, growthPoints: 11 }), {
      action: 'care',
      now,
      lastSameActionAt: now - 10 * 60 * 1000,
      rollingEarned: { bond: 9, growthPoints: 11, biasMagnitude: 11 },
    })
    expect(result.ok).toBe(true)
    expect(result.repeated).toBe(true)
    expect(result.pet.care).toBe(43)
    expect(result.pet.energy).toBe(45)
    expect(result.pet.bond).toBe(9)
    expect(result.pet.growthPoints).toBe(11)
    expect(result.pet.careBias).toBe(0)
  })

  test('offers explicit growth choices and applies the selected appearance', () => {
    const bornAt = at(1, 9)
    const now = at(7, 10)
    const pet = petAt(bornAt, { growthPoints: 40, bond: 15, careBias: 25, growthAgeMinutes: 600 })
    const choices = getGrowthChoices(pet, now)
    expect(choices).toHaveLength(2)
    expect(choices.every(choice => choice.family === 'calm')).toBe(true)
    const result = applyGrowth(pet, choices[1].choiceId, now)
    expect(result.ok).toBe(true)
    expect(result.pet.stage).toBe('young')
    expect(result.pet.appearanceId).toBe(choices[1].appearanceId)
  })

  test('completes a 30-work-minute rest once across an overnight boundary', () => {
    const start = at(7, 17, 50)
    const nextDayCompletion = at(8, 9, 20)
    expect(addWorkingMinutes(start, 30)).toBe(nextDayCompletion)
    const started = applyLocalAction(petAt(start), { action: 'rest', now: start })
    expect(started).toMatchObject({ ok: true, pet: { energy: 50, lifecycleState: 'resting', napEndsAt: nextDayCompletion } })
    const beforeCompletion = evaluatePetState(started.pet, at(8, 9, 19))
    expect(beforeCompletion.energy).toBe(50)
    expect(beforeCompletion.napEndsAt).toBe(nextDayCompletion)
    const completed = evaluatePetState(beforeCompletion, nextDayCompletion)
    expect(completed.energy).toBe(62)
    expect(completed.napEndsAt).toBeNull()
    expect(evaluatePetState(completed, nextDayCompletion + 1).energy).toBe(62)
  })
})
