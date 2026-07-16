// peer-debug 로그 유틸 단위 테스트 (#26)
// - 동기 appendFileSync 대신 버퍼링된 비동기 flush 인지
// - 10MB 초과 시 로테이션 되는지
// - IP/닉네임이 부분 마스킹되는지
// - 기존 API(isPeerDebugEnabled/writePeerDebugLog/resetPeerDebugLog/getPeerDebugLogPath) 유지

const fs = require('fs')
const os = require('os')
const path = require('path')

describe('peerDebugLogger', () => {
  let tmpDir
  let logger

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lan-chat-logger-test-'))
    process.env.LAN_CHAT_DEBUG_PEER = '1'
    process.env.LAN_CHAT_DEBUG_LOG_PATH = path.join(tmpDir, 'peer-debug.log')
    // 모듈 내부 상태(대기열/타이머)가 테스트 간 섞이지 않도록 매번 새로 로드
    jest.resetModules()
    logger = require('../../electron/utils/peerDebugLogger')
    logger.resetPeerDebugLog()
  })

  afterEach(async () => {
    await logger.flushPeerDebugLogNow()
    delete process.env.LAN_CHAT_DEBUG_PEER
    delete process.env.LAN_CHAT_DEBUG_LOG_PATH
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('기존 API 시그니처를 유지한다', () => {
    expect(typeof logger.isPeerDebugEnabled).toBe('function')
    expect(typeof logger.writePeerDebugLog).toBe('function')
    expect(typeof logger.resetPeerDebugLog).toBe('function')
    expect(typeof logger.getPeerDebugLogPath).toBe('function')
    expect(logger.isPeerDebugEnabled()).toBe(true)
  })

  it('writePeerDebugLog 는 즉시 동기 기록하지 않고 버퍼에 쌓아뒀다가 flush 이후에 디스크에 반영된다', async () => {
    logger.writePeerDebugLog('test.event', { foo: 'bar' })

    // flush 전에는 아직 디스크에 반영되지 않아야 한다 (동기 appendFileSync 제거 확인)
    const beforeFlush = fs.readFileSync(logger.getPeerDebugLogPath(), 'utf8')
    expect(beforeFlush).toBe('')

    await logger.flushPeerDebugLogNow()

    const afterFlush = fs.readFileSync(logger.getPeerDebugLogPath(), 'utf8')
    const parsed = JSON.parse(afterFlush.trim())
    expect(parsed.event).toBe('test.event')
    expect(parsed.details.foo).toBe('bar')
  })

  it('여러 번 호출한 로그가 한 번의 flush 로 순서대로 모두 기록된다', async () => {
    logger.writePeerDebugLog('event.1', {})
    logger.writePeerDebugLog('event.2', {})
    logger.writePeerDebugLog('event.3', {})
    await logger.flushPeerDebugLogNow()

    const lines = fs.readFileSync(logger.getPeerDebugLogPath(), 'utf8').trim().split('\n')
    expect(lines).toHaveLength(3)
    expect(JSON.parse(lines[0]).event).toBe('event.1')
    expect(JSON.parse(lines[1]).event).toBe('event.2')
    expect(JSON.parse(lines[2]).event).toBe('event.3')
  })

  it('IP 는 뒤 두 옥텟이 마스킹된다', async () => {
    logger.writePeerDebugLog('net.event', { ip: '192.168.1.42', host: '10.0.0.7' })
    await logger.flushPeerDebugLogNow()

    const { details } = JSON.parse(fs.readFileSync(logger.getPeerDebugLogPath(), 'utf8').trim())
    expect(details.ip).toBe('192.168.*.*')
    expect(details.host).toBe('10.0.*.*')
  })

  it('배열 안의 IP 문자열도 마스킹된다 (addresses 등)', async () => {
    logger.writePeerDebugLog('net.event', { addresses: ['192.168.0.5', '172.16.4.9'] })
    await logger.flushPeerDebugLogNow()

    const { details } = JSON.parse(fs.readFileSync(logger.getPeerDebugLogPath(), 'utf8').trim())
    expect(details.addresses).toEqual(['192.168.*.*', '172.16.*.*'])
  })

  it('nickname/from 등 닉네임 성격의 키는 부분 마스킹된다', async () => {
    logger.writePeerDebugLog('nick.event', { nickname: '홍길동', from: '김철수', unrelatedField: '홍길동' })
    await logger.flushPeerDebugLogNow()

    const { details } = JSON.parse(fs.readFileSync(logger.getPeerDebugLogPath(), 'utf8').trim())
    expect(details.nickname).toBe('홍*동')
    expect(details.from).toBe('김*수')
    // 닉네임 성격이 아닌 필드는 그대로 유지 (과도한 마스킹 방지)
    expect(details.unrelatedField).toBe('홍길동')
  })

  it('로그 파일이 10MB 를 넘으면 회전되고, 새 로그는 계속 이어서 기록된다', async () => {
    // rotateLogIfNeeded 는 "다음" flush 시작 시점에 현재 파일 크기를 검사하므로,
    // 10MB 문턱을 확실히 넘긴 뒤 최소 한 번 더 flush 해야 회전이 실제로 일어난다.
    const bigChunk = 'x'.repeat(6 * 1024 * 1024) // 약 6MB
    for (let i = 0; i < 3; i++) {
      logger.writePeerDebugLog('big.event', { blob: bigChunk })
      await logger.flushPeerDebugLogNow()
    }

    const files = fs.readdirSync(tmpDir)
    expect(files).toContain('peer-debug.log')
    expect(files).toContain('peer-debug.log.1')

    const activeSize = fs.statSync(path.join(tmpDir, 'peer-debug.log')).size
    // 회전 직후 활성 로그는 10MB 보다 작아야 한다 (통째로 넘겨받지 않았음)
    expect(activeSize).toBeLessThan(10 * 1024 * 1024)

    // 회전 후에도 정상적으로 계속 기록됨
    logger.writePeerDebugLog('after.rotate', {})
    await logger.flushPeerDebugLogNow()
    const activeContent = fs.readFileSync(path.join(tmpDir, 'peer-debug.log'), 'utf8')
    expect(activeContent).toContain('after.rotate')
  })

  it('resetPeerDebugLog 는 대기 중인 로그를 비우고 파일을 truncate 한다', async () => {
    logger.writePeerDebugLog('stale.event', {})
    // flush 하지 않은 상태에서 reset — 대기열에 남아있던 stale 로그가 다음 flush 로
    // 새 파일에 섞여 들어가면 안 된다.
    logger.resetPeerDebugLog()
    logger.writePeerDebugLog('fresh.event', {})
    await logger.flushPeerDebugLogNow()

    const lines = fs.readFileSync(logger.getPeerDebugLogPath(), 'utf8').trim().split('\n')
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0]).event).toBe('fresh.event')
  })

  it('LAN_CHAT_DEBUG_PEER 가 꺼져있으면 아무 것도 기록하지 않는다', async () => {
    process.env.LAN_CHAT_DEBUG_PEER = '0'
    logger.writePeerDebugLog('should.not.appear', {})
    await logger.flushPeerDebugLogNow()
    expect(fs.existsSync(logger.getPeerDebugLogPath())).toBe(true)
    expect(fs.readFileSync(logger.getPeerDebugLogPath(), 'utf8')).toBe('')
  })
})
