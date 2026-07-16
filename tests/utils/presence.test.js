// tests/utils/presence.test.js
// 유휴 자동 자리비움(auto-away) 판정 순수 로직 테스트(#41).
// 사용자가 명시적으로 설정한 상태(manualStatusType)가 'online' 일 때만 자동 전환 대상이며,
// 활동 재개 시 auto-away 로 전환됐던 경우에만 이전 상태로 복원해야 한다.

const { decidePresenceTransition, IDLE_THRESHOLD_SECONDS } = require('../../electron/utils/presence')

describe('decidePresenceTransition', () => {
  it('online 상태에서 유휴 임계값 이상이면 away 로 자동 전환한다', () => {
    const result = decidePresenceTransition({
      idleSeconds: IDLE_THRESHOLD_SECONDS,
      manualStatusType: 'online',
      isAutoAway: false,
    })
    expect(result).toEqual({ statusType: 'away', isAutoAway: true })
  })

  it('유휴 임계값 미만이면 전환하지 않는다', () => {
    const result = decidePresenceTransition({
      idleSeconds: IDLE_THRESHOLD_SECONDS - 1,
      manualStatusType: 'online',
      isAutoAway: false,
    })
    expect(result).toBeNull()
  })

  it("사용자가 명시적으로 busy 를 설정한 경우 유휴여도 auto-away 로 덮어쓰지 않는다", () => {
    const result = decidePresenceTransition({
      idleSeconds: IDLE_THRESHOLD_SECONDS,
      manualStatusType: 'busy',
      isAutoAway: false,
    })
    expect(result).toBeNull()
  })

  it("사용자가 명시적으로 dnd 를 설정한 경우도 auto-away 로 덮어쓰지 않는다", () => {
    const result = decidePresenceTransition({
      idleSeconds: IDLE_THRESHOLD_SECONDS,
      manualStatusType: 'dnd',
      isAutoAway: false,
    })
    expect(result).toBeNull()
  })

  it('이미 auto-away 상태면 유휴가 계속돼도 중복 전환하지 않는다', () => {
    const result = decidePresenceTransition({
      idleSeconds: IDLE_THRESHOLD_SECONDS * 2,
      manualStatusType: 'online',
      isAutoAway: true,
    })
    expect(result).toBeNull()
  })

  it('auto-away 상태에서 활동이 재개되면 이전 상태(online)로 복원한다', () => {
    const result = decidePresenceTransition({
      idleSeconds: 0,
      manualStatusType: 'online',
      isAutoAway: true,
    })
    expect(result).toEqual({ statusType: 'online', isAutoAway: false })
  })

  it('auto-away 가 아닌데(수동으로 away 를 선택한 경우) 활동이 재개돼도 복원 전환은 없다', () => {
    const result = decidePresenceTransition({
      idleSeconds: 0,
      manualStatusType: 'away',
      isAutoAway: false,
    })
    expect(result).toBeNull()
  })

  it('활동 중(비유휴)이고 auto-away 도 아니면 아무 것도 하지 않는다', () => {
    const result = decidePresenceTransition({
      idleSeconds: 0,
      manualStatusType: 'online',
      isAutoAway: false,
    })
    expect(result).toBeNull()
  })

  it('커스텀 임계값(idleThresholdSeconds) 을 지정할 수 있다', () => {
    const result = decidePresenceTransition({
      idleSeconds: 10,
      manualStatusType: 'online',
      isAutoAway: false,
      idleThresholdSeconds: 10,
    })
    expect(result).toEqual({ statusType: 'away', isAutoAway: true })
  })
})
