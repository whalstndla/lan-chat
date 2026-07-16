// tests/peer/scenarios/dedup.test.js
// 인바운드 dedup 공용화(#57) — dedup 판정이 wsServer/wsClient 공용 진입점(handleIncomingMessage)
// 으로 이동해, 어느 경로로 같은 id 메시지가 다시 들어와도 한 번만 처리됨을 실제 소켓/DB 로 검증한다.
//
// 관측 신호로는 'message-received' 렌더러 이벤트를 사용한다. messages.id 는 TEXT PRIMARY KEY 이고
// saveMessage 가 INSERT OR IGNORE 라서 DB 행 수는 DB 계층에서 이미 dedup 되어 앱 계층 dedup 을
// 관측할 수 없다. 렌더러 이벤트는 핸들러가 실제로 실행될 때마다 발행되므로 앱 계층 dedup 을 반영한다.
const { createNode } = require('../harness')
const WebSocket = require('ws')

async function waitFor(condition, { timeoutMs = 3000, intervalMs = 30 } = {}) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await condition()) return
    await new Promise(r => setTimeout(r, intervalMs))
  }
  throw new Error('waitFor timeout')
}

function globalMessage(id) {
  return { type: 'message', id, from: '앨리스', fromId: 'peer-a', content: `내용-${id}`, contentType: 'text', timestamp: Date.now() }
}

// nodeB 의 wsServer 로 raw ws 연결을 열어 payload 들을 순서대로 전송하고 소켓을 닫는다.
function sendViaServerSocket(node, payloads) {
  return new Promise((resolve, reject) => {
    const client = new WebSocket(`ws://localhost:${node.port}`)
    client.on('error', reject)
    client.on('open', () => {
      for (const p of payloads) client.send(JSON.stringify(p))
      resolve(client)
    })
  })
}

describe('Scenario: 인바운드 dedup 공용화(#57)', () => {
  let nodeB

  afterEach(async () => {
    if (nodeB) await nodeB.shutdown()
    nodeB = null
  })

  it('wsServer 경로로 같은 id 메시지를 두 번 보내면 message-received 는 한 번만 발행된다', async () => {
    nodeB = await createNode({ peerId: 'peer-b', nickname: '밥' })
    await sendViaServerSocket(nodeB, [globalMessage('dup-1'), globalMessage('dup-1')])

    // 첫 처리 대기 후, 두 번째가 도착할 여지를 준 뒤 정확히 1건인지 확인
    await waitFor(() => nodeB.getRendererEvents('message-received').some(e => e.data.id === 'dup-1'))
    await new Promise(r => setTimeout(r, 200))
    const count = nodeB.getRendererEvents('message-received').filter(e => e.data.id === 'dup-1').length
    expect(count).toBe(1)
  })

  it('경로 교차: wsServer 로 받은 id 를 wsClient 인바운드 진입점으로 다시 넣어도 재처리되지 않는다', async () => {
    nodeB = await createNode({ peerId: 'peer-b', nickname: '밥' })
    // 1) 서버 소켓 경로로 1회 수신
    await sendViaServerSocket(nodeB, [globalMessage('cross-1')])
    await waitFor(() => nodeB.getRendererEvents('message-received').some(e => e.data.id === 'cross-1'))

    // 2) wsClient 인바운드와 동일한 진입점(handleIncomingMessage)으로 같은 id 재주입.
    //    wsClient.js 는 수신 시 onMessage(=ctx.state.handleIncomingMessage) 를 호출하므로,
    //    아래 호출은 클라이언트 경로로 같은 id 가 다시 들어온 상황과 동일하다.
    nodeB.ctx.state.handleIncomingMessage(globalMessage('cross-1'), () => {})
    await new Promise(r => setTimeout(r, 100))

    const count = nodeB.getRendererEvents('message-received').filter(e => e.data.id === 'cross-1').length
    expect(count).toBe(1)
  })

  it('id 가 없는 반복 메시지(reaction)는 dedup 대상이 아니라 두 번 다 처리된다', async () => {
    nodeB = await createNode({ peerId: 'peer-b', nickname: '밥' })
    const reaction = { type: 'reaction', messageId: 'm-1', fromId: 'peer-a', emoji: '👍', action: 'add', timestamp: Date.now() }
    await sendViaServerSocket(nodeB, [reaction, reaction])

    await waitFor(() => nodeB.getRendererEvents('reaction-updated').filter(e => e.data.messageId === 'm-1').length >= 2)
    const count = nodeB.getRendererEvents('reaction-updated').filter(e => e.data.messageId === 'm-1').length
    expect(count).toBe(2)
  })
})
