// tests/utils/isRoomMuted.test.js
// 뮤트 판정 순수 로직 테스트 — mutedRoomKeySet 기준으로 방이 뮤트됐는지 확인한다(#4).
// 뮤트는 소리/OS알림만 억제하고 안읽음 배지는 영향받지 않아야 하므로, 판정 자체를
// incrementBadge 와 분리된 함수로 검증한다.

const { isRoomMuted } = require('../../electron/utils/appUtils')

function buildCtx(mutedRoomKeys) {
  return { state: { mutedRoomKeySet: new Set(mutedRoomKeys) } }
}

describe('isRoomMuted', () => {
  it('뮤트된 전체채팅(global) 방은 true 를 반환한다', () => {
    const ctx = buildCtx(['global'])
    expect(isRoomMuted(ctx, 'global')).toBe(true)
  })

  it('뮤트된 DM 상대(peerId) 는 true 를 반환한다', () => {
    const ctx = buildCtx(['peer-a'])
    expect(isRoomMuted(ctx, 'peer-a')).toBe(true)
  })

  it('뮤트되지 않은 방은 false 를 반환한다', () => {
    const ctx = buildCtx(['peer-a'])
    expect(isRoomMuted(ctx, 'peer-b')).toBe(false)
    expect(isRoomMuted(ctx, 'global')).toBe(false)
  })

  it('mutedRoomKeySet 이 아직 초기화되지 않아도(undefined) 안전하게 false 를 반환한다', () => {
    const ctx = { state: {} }
    expect(isRoomMuted(ctx, 'global')).toBe(false)
  })

  it('빈 집합으로 동기화되면 이전에 뮤트됐던 방도 더 이상 뮤트가 아니다', () => {
    const ctx = buildCtx(['global', 'peer-a'])
    expect(isRoomMuted(ctx, 'global')).toBe(true)
    ctx.state.mutedRoomKeySet = new Set([])
    expect(isRoomMuted(ctx, 'global')).toBe(false)
  })
})
