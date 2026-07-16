// get-room-read-state / set-room-read-timestamp IPC 핸들러 단위 테스트(#39).
// 안읽음 구분선 위치를 재시작 후에도 유지하기 위한 영속 저장소가 IPC 를 통해
// 올바르게 조회/갱신되는지 검증한다.

jest.mock('electron', () => {
  const handlers = new Map()
  return {
    __handlers: handlers,
    ipcMain: {
      handle: (channel, fn) => handlers.set(channel, fn),
    },
  }
})

const { __handlers } = require('electron')
const { initDatabase, migrateDatabase, closeDatabase } = require('../../electron/storage/database')
const { registerReadStatusHandlers } = require('../../electron/ipcHandlers/readStatus')

describe('get-room-read-state / set-room-read-timestamp', () => {
  let db

  beforeEach(() => {
    db = initDatabase(':memory:')
    migrateDatabase(db)
    __handlers.clear()
  })
  afterEach(() => closeDatabase(db))

  function buildCtx() {
    return { state: { database: db, peerId: 'me' } }
  }

  it('저장된 값이 없으면 빈 객체를 반환한다', () => {
    const ctx = buildCtx()
    registerReadStatusHandlers(ctx)
    const handler = __handlers.get('get-room-read-state')
    expect(handler()).toEqual({})
  })

  it('set 으로 저장한 값을 get 으로 조회할 수 있다 — 전체채팅과 DM 모두', () => {
    const ctx = buildCtx()
    registerReadStatusHandlers(ctx)
    const setHandler = __handlers.get('set-room-read-timestamp')
    const getHandler = __handlers.get('get-room-read-state')

    setHandler(null, { roomKey: 'global', timestamp: 1000 })
    setHandler(null, { roomKey: 'peer-1', timestamp: 2000 })

    expect(getHandler()).toEqual({ global: 1000, 'peer-1': 2000 })
  })

  it('같은 roomKey 를 다시 set 하면 값이 갱신된다', () => {
    const ctx = buildCtx()
    registerReadStatusHandlers(ctx)
    const setHandler = __handlers.get('set-room-read-timestamp')
    const getHandler = __handlers.get('get-room-read-state')

    setHandler(null, { roomKey: 'global', timestamp: 1000 })
    setHandler(null, { roomKey: 'global', timestamp: 9000 })

    expect(getHandler()).toEqual({ global: 9000 })
  })

  it('roomKey 가 없으면 아무 것도 저장하지 않는다', () => {
    const ctx = buildCtx()
    registerReadStatusHandlers(ctx)
    const setHandler = __handlers.get('set-room-read-timestamp')
    const getHandler = __handlers.get('get-room-read-state')

    setHandler(null, { roomKey: null, timestamp: 1000 })

    expect(getHandler()).toEqual({})
  })

  it('timestamp 가 null 이어도(메시지 없는 방) 저장된다', () => {
    const ctx = buildCtx()
    registerReadStatusHandlers(ctx)
    const setHandler = __handlers.get('set-room-read-timestamp')
    const getHandler = __handlers.get('get-room-read-state')

    setHandler(null, { roomKey: 'peer-new', timestamp: null })

    expect(getHandler()).toEqual({ 'peer-new': null })
  })
})
