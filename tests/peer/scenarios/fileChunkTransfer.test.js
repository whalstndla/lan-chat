// Scenario: 파일 청크 전송(#44/#45/#49) 실제 2노드 왕복 (하네스 — 실제 ws 소켓).
// A 가 전체채팅에 이미지 메시지를 보내면 B 가 자동으로 file-request → A 가 청크 스트리밍으로 응답 →
// B 가 조립해 file_cache 에 저장한다. 원본과 바이트가 동일한지, 청크/레거시 경로가 capability 로
// 분기되는지 검증한다. (진행률 이벤트 유무로 청크 vs 레거시 경로를 관측한다.)

const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const { createNode, emitDiscovery } = require('../harness')
const { encryptBuffer, decryptBuffer } = require('../../../electron/crypto/fileEncryption')

async function waitFor(condition, { timeoutMs = 8000, intervalMs = 50 } = {}) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await condition()) return
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error('waitFor timeout')
}

describe('Scenario: 파일 청크 전송 2노드 왕복', () => {
  let nodeA, nodeB

  afterEach(async () => {
    if (nodeA) await nodeA.shutdown()
    if (nodeB) await nodeB.shutdown()
    nodeA = null; nodeB = null
  })

  async function connectNodes() {
    nodeA = await createNode({ peerId: 'peer-a', nickname: '앨리스' })
    nodeB = await createNode({ peerId: 'peer-b', nickname: '밥' })
    // cacheReceivedFile / fileRequest / 청크 조립 모두 masterKey 필요.
    nodeA.ctx.state.masterKey = Buffer.alloc(32, 0xa1)
    nodeB.ctx.state.masterKey = Buffer.alloc(32, 0xb2)

    await nodeA.callIpc('start-peer-discovery')
    await nodeB.callIpc('start-peer-discovery')
    emitDiscovery(nodeA, nodeB)
    await waitFor(() => nodeA.ctx.state.peerPublicKeyMap.has('peer-b'))
    await waitFor(() => nodeB.ctx.state.peerPublicKeyMap.has('peer-a'))
  }

  // A 디스크에 masterKey 로 암호화된 파일을 만들고 전체채팅 이미지 메시지를 전송 → 메시지 반환.
  async function seedAndSend(original, fileName) {
    const filesDir = path.join(nodeA.ctx.config.appDataPath, 'files')
    fs.mkdirSync(filesDir, { recursive: true })
    fs.writeFileSync(path.join(filesDir, fileName), encryptBuffer(original, nodeA.ctx.state.masterKey))
    const fileUrl = `http://127.0.0.1:0/files/${fileName}`
    return nodeA.callIpc('send-global-message', { content: null, contentType: 'image', fileUrl, fileName })
  }

  it('청크 지원 피어 — 원본과 바이트 동일 수신 + 진행률 관측', async () => {
    await connectNodes()
    const original = crypto.randomBytes(3_000_000) // 1MB 청크 → 3개
    const sent = await seedAndSend(original, 'photo.png')
    const messageId = sent.id

    await waitFor(() => nodeB.getRendererEvents('file-cached').some((e) => e.data.messageId === messageId))

    const cachedPath = path.join(nodeB.ctx.config.appDataPath, 'file_cache', `${messageId}.png`)
    expect(fs.existsSync(cachedPath)).toBe(true)
    const decrypted = decryptBuffer(fs.readFileSync(cachedPath), nodeB.ctx.state.masterKey)
    expect(decrypted.equals(original)).toBe(true)
    // 청크 경로임을 진행률 이벤트로 확인 (레거시 file-data 경로는 file-progress 를 보내지 않음).
    expect(nodeB.getRendererEvents('file-progress').some((e) => e.data.messageId === messageId)).toBe(true)
    // 조립 완료 후 양쪽 transfer 상태 정리됨.
    expect(nodeB.ctx.state.inboundFileTransfers.size).toBe(0)
    expect(nodeA.ctx.state.outboundFileTransfers.size).toBe(0)
  })

  it('청크 미지원 피어 — 레거시 file-data 폴백 (바이트 동일, 진행률 없음)', async () => {
    await connectNodes()
    // A 가 보는 B 의 협상 capability 에서 file-chunk 제거 → A 는 레거시 경로 선택.
    const sessionOnA = nodeA.ctx.state.peerManager.getSession('peer-b')
    sessionOnA.handshake.remoteCapabilities = sessionOnA.handshake.remoteCapabilities.filter((c) => c !== 'file-chunk')

    const original = crypto.randomBytes(1_200_000)
    const sent = await seedAndSend(original, 'legacy.png')
    const messageId = sent.id

    await waitFor(() => nodeB.getRendererEvents('file-cached').some((e) => e.data.messageId === messageId))

    const cachedPath = path.join(nodeB.ctx.config.appDataPath, 'file_cache', `${messageId}.png`)
    expect(fs.existsSync(cachedPath)).toBe(true)
    const decrypted = decryptBuffer(fs.readFileSync(cachedPath), nodeB.ctx.state.masterKey)
    expect(decrypted.equals(original)).toBe(true)
    // 레거시 경로 → 진행률 이벤트 없음.
    expect(nodeB.getRendererEvents('file-progress').some((e) => e.data.messageId === messageId)).toBe(false)
  })
})
