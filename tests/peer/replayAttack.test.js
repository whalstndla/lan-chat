// tests/peer/replayAttack.test.js
// Replay Attack(동일 id 재수신) 방어 — dedup 판정은 wsServer 에서 wsServer/wsClient 공용
// 인바운드 진입점인 messageHandler.js(handleIncomingMessage)로 이동했다(#57). 두 경로가 모두
// 이 함수를 onMessage 로 사용하므로 여기서의 dedup 이 양 경로에 일관되게 적용된다.
// 따라서 방어 로직은 이 진입점에서 검증한다.

// dispatchInbound 를 스텁으로 대체해 "실제 처리 횟수"를 호출 횟수로 관측한다.
jest.mock('../../electron/peer/inbound', () => ({
  dispatchInbound: jest.fn(() => true),
}))

const { dispatchInbound } = require('../../electron/peer/inbound')
const { createIncomingMessageHandler, MAX_RECENT_MESSAGE_IDS } = require('../../electron/messageHandler')
const { createAppContext } = require('../../electron/context')

// database 가 준비된(=truthy) 상태의 핸들러/컨텍스트를 생성
function makeHandler() {
  const ctx = createAppContext({})
  ctx.state.database = {} // truthy — DB 준비 완료로 간주
  return { handler: createIncomingMessageHandler(ctx), ctx }
}

function globalMessage(id) {
  return { type: 'message', id, from: '테스터', fromId: 'peer-a', content: '중복 테스트', contentType: 'text', timestamp: Date.now() }
}

describe('Replay Attack 방어 (공용 진입점 dedup)', () => {
  beforeEach(() => {
    dispatchInbound.mockClear()
  })

  it('동일한 메시지 id 를 두 번 넣으면 첫 번째만 처리된다', () => {
    const { handler } = makeHandler()
    const msg = globalMessage('replay-test-id-001')
    handler(msg, () => {})
    handler(msg, () => {})
    expect(dispatchInbound).toHaveBeenCalledTimes(1)
  })

  it('서로 다른 메시지 id 는 모두 처리된다', () => {
    const { handler } = makeHandler()
    handler(globalMessage('unique-id-001'), () => {})
    handler(globalMessage('unique-id-002'), () => {})
    expect(dispatchInbound).toHaveBeenCalledTimes(2)
  })

  it('id 필드가 없는 메시지(typing/reaction 등)는 중복 검사 없이 매번 처리된다', () => {
    const { handler } = makeHandler()
    // typing 은 id 가 없고 정당하게 반복 전송되는 타입 — dedup 대상이 아니다.
    const typing = { type: 'typing', fromId: 'peer-a', from: '테스터', to: null, timestamp: Date.now() }
    handler(typing, () => {})
    handler(typing, () => {})
    // reaction 도 id 대신 messageId 를 쓰므로 dedup 대상이 아니다.
    const reaction = { type: 'reaction', messageId: 'm-1', fromId: 'peer-a', emoji: '👍', action: 'add', timestamp: Date.now() }
    handler(reaction, () => {})
    handler(reaction, () => {})
    expect(dispatchInbound).toHaveBeenCalledTimes(4)
  })

  it('database 미준비 상태에서는 아무 것도 처리하지 않는다(early return)', () => {
    const ctx = createAppContext({})
    ctx.state.database = null
    const handler = createIncomingMessageHandler(ctx)
    handler(globalMessage('x'), () => {})
    expect(dispatchInbound).not.toHaveBeenCalled()
  })

  it('상한(MAX_RECENT_MESSAGE_IDS) 초과 시 가장 오래된 id 가 FIFO 방출되어 재처리 가능해진다', () => {
    const { handler } = makeHandler()
    const firstId = 'id-0'
    handler(globalMessage(firstId), () => {})
    // firstId 이후 서로 다른 id 를 MAX 개 추가하면, 총 MAX+1 개가 되어 가장 오래된 firstId 가 방출된다.
    for (let i = 1; i <= MAX_RECENT_MESSAGE_IDS; i++) {
      handler(globalMessage(`id-${i}`), () => {})
    }
    dispatchInbound.mockClear()
    // firstId 는 방출됐으므로 다시 넣으면 새 메시지로 처리되어야 한다.
    handler(globalMessage(firstId), () => {})
    expect(dispatchInbound).toHaveBeenCalledTimes(1)
  })
})
