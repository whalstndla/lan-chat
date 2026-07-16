// tests/storage/roomReadState.test.js
// getRoomReadState / setRoomReadTimestamp — 안읽음 구분선 영속화(#39)에 쓰이는 순수 쿼리 검증.
const { initDatabase, migrateDatabase, closeDatabase } = require('../../electron/storage/database')
const { getRoomReadState, setRoomReadTimestamp } = require('../../electron/storage/queries')

describe('room_read_state 쿼리', () => {
  let db

  beforeEach(() => {
    db = initDatabase(':memory:')
    migrateDatabase(db)
  })
  afterEach(() => { closeDatabase(db) })

  it('저장된 값이 없으면 빈 객체를 반환한다', () => {
    expect(getRoomReadState(db)).toEqual({})
  })

  it('setRoomReadTimestamp 로 저장한 값을 roomKey 기준으로 조회할 수 있다', () => {
    setRoomReadTimestamp(db, 'global', 1000)
    setRoomReadTimestamp(db, 'peer-1', 2000)

    expect(getRoomReadState(db)).toEqual({ global: 1000, 'peer-1': 2000 })
  })

  it('같은 roomKey 로 다시 호출하면 값을 덮어쓴다(upsert)', () => {
    setRoomReadTimestamp(db, 'global', 1000)
    setRoomReadTimestamp(db, 'global', 5000)

    expect(getRoomReadState(db)).toEqual({ global: 5000 })
  })

  it('timestamp 로 null 을 저장할 수 있다(메시지가 아직 없는 방)', () => {
    setRoomReadTimestamp(db, 'peer-new', null)

    expect(getRoomReadState(db)).toEqual({ 'peer-new': null })
  })

  it('null 로 저장했던 값을 이후 실제 타임스탬프로 갱신할 수 있다', () => {
    setRoomReadTimestamp(db, 'peer-new', null)
    setRoomReadTimestamp(db, 'peer-new', 3000)

    expect(getRoomReadState(db)).toEqual({ 'peer-new': 3000 })
  })
})
