// tests/peer/messageFreshness.test.js
// 신선도(replay) 검증 — 라이브 message/dm 의 timestamp 가 허용 window 밖이면 무시한다.
// id 기반 dedup 은 in-memory 라 재시작 시 소실되므로, timestamp 신선도로 replay 창을
// 시간으로 봉쇄한다(#69). 히스토리 동기화·pending flush 는 정당하게 오래되므로 예외.
//
// 관측: dispatchInbound 를 스텁으로 대체해 "실제 처리 여부"를 호출 횟수로 본다
// (replayAttack.test.js 와 동일한 방식).

jest.mock('../../electron/peer/inbound', () => ({
  dispatchInbound: jest.fn(() => true),
}))

const { dispatchInbound } = require('../../electron/peer/inbound')
const {
  createIncomingMessageHandler,
  isStaleInboundMessage,
  MAX_INBOUND_PAST_AGE_MS,
  MAX_INBOUND_FUTURE_SKEW_MS,
} = require('../../electron/messageHandler')
const { createAppContext } = require('../../electron/context')

function makeHandler() {
  const ctx = createAppContext({})
  ctx.state.database = {} // truthy — DB 준비 완료로 간주
  return { handler: createIncomingMessageHandler(ctx), ctx }
}

function liveMessage(overrides = {}) {
  return {
    type: 'message', id: `m-${Math.random()}`, from: '앨리스', fromId: 'peer-a',
    content: '내용', contentType: 'text', timestamp: Date.now(), ...overrides,
  }
}

function liveDm(overrides = {}) {
  return {
    type: 'dm', id: `d-${Math.random()}`, from: '앨리스', fromId: 'peer-a',
    to: 'peer-b', encryptedPayload: 'x', contentType: 'text', timestamp: Date.now(), ...overrides,
  }
}

describe('신선도 검증 순수 함수 (isStaleInboundMessage)', () => {
  it('window 안(현재 시각)의 message/dm 은 신선하다(false)', () => {
    expect(isStaleInboundMessage(liveMessage())).toBe(false)
    expect(isStaleInboundMessage(liveDm())).toBe(false)
  })

  it('과거 window 초과(10분 + 1초)면 stale(true)', () => {
    const old = Date.now() - MAX_INBOUND_PAST_AGE_MS - 1000
    expect(isStaleInboundMessage(liveMessage({ timestamp: old }))).toBe(true)
    expect(isStaleInboundMessage(liveDm({ timestamp: old }))).toBe(true)
  })

  it('미래 skew 초과(2분 + 1초)면 stale(true)', () => {
    const future = Date.now() + MAX_INBOUND_FUTURE_SKEW_MS + 1000
    expect(isStaleInboundMessage(liveMessage({ timestamp: future }))).toBe(true)
  })

  it('window 경계 직전(과거 9분)은 통과, 소폭 미래(1분)도 통과', () => {
    expect(isStaleInboundMessage(liveMessage({ timestamp: Date.now() - 9 * 60 * 1000 }))).toBe(false)
    expect(isStaleInboundMessage(liveMessage({ timestamp: Date.now() + 60 * 1000 }))).toBe(false)
  })

  it('예외: deferred(pending flush) 는 오래된 timestamp 여도 통과', () => {
    const old = Date.now() - MAX_INBOUND_PAST_AGE_MS - 5 * 60 * 1000
    expect(isStaleInboundMessage(liveDm({ timestamp: old, deferred: true }))).toBe(false)
  })

  it('예외: message/dm 이 아닌 타입(typing/reaction/history-sync-response)은 검사 대상 아님', () => {
    const old = Date.now() - MAX_INBOUND_PAST_AGE_MS - 60 * 1000
    expect(isStaleInboundMessage({ type: 'typing', fromId: 'peer-a', timestamp: old })).toBe(false)
    expect(isStaleInboundMessage({ type: 'reaction', messageId: 'm', timestamp: old })).toBe(false)
    // 히스토리 동기화 응답 엔벨로프는 타입이 message/dm 이 아니라 검사 자체를 안 탄다.
    expect(isStaleInboundMessage({ type: 'history-sync-response', fromId: 'peer-a', messages: [] })).toBe(false)
  })

  it('예외: timestamp 없음/비정상이면 검사 불가로 통과(하위호환)', () => {
    expect(isStaleInboundMessage(liveMessage({ timestamp: undefined }))).toBe(false)
    expect(isStaleInboundMessage(liveMessage({ timestamp: 'not-a-number' }))).toBe(false)
    expect(isStaleInboundMessage(liveMessage({ timestamp: NaN }))).toBe(false)
  })
})

describe('신선도 검증 진입점 통합 (handleIncomingMessage)', () => {
  beforeEach(() => dispatchInbound.mockClear())

  it('신선한 라이브 message 는 처리된다', () => {
    const { handler } = makeHandler()
    handler(liveMessage(), () => {})
    expect(dispatchInbound).toHaveBeenCalledTimes(1)
  })

  it('window 밖(과거) 라이브 dm 은 처리되지 않는다(replay 차단)', () => {
    const { handler } = makeHandler()
    handler(liveDm({ timestamp: Date.now() - MAX_INBOUND_PAST_AGE_MS - 1000 }), () => {})
    expect(dispatchInbound).not.toHaveBeenCalled()
  })

  it('window 밖(미래) 라이브 message 는 처리되지 않는다', () => {
    const { handler } = makeHandler()
    handler(liveMessage({ timestamp: Date.now() + MAX_INBOUND_FUTURE_SKEW_MS + 1000 }), () => {})
    expect(dispatchInbound).not.toHaveBeenCalled()
  })

  it('예외: deferred 표시된 오래된 dm(pending flush)은 정상 처리된다', () => {
    const { handler } = makeHandler()
    handler(liveDm({ timestamp: Date.now() - 6 * 24 * 60 * 60 * 1000, deferred: true }), () => {})
    expect(dispatchInbound).toHaveBeenCalledTimes(1)
  })

  it('예외: 오래된 history-sync-response 엔벨로프는 신선도 검증을 타지 않는다', () => {
    const { handler } = makeHandler()
    handler({ type: 'history-sync-response', fromId: 'peer-a', messages: [], timestamp: 1000 }, () => {})
    expect(dispatchInbound).toHaveBeenCalledTimes(1)
  })
})
