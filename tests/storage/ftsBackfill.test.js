// FTS5 백필 중복 방지 테스트 (#7)
// migrateDatabase() 는 로그인/등록마다 호출되므로, 가드 없이 매번 백필 INSERT 를
// 실행하면 동일 rowid 가 반복 삽입 시도되어 검색 결과가 중복되거나 인덱스가 계속
// 커지는 문제가 있었다. messages_fts 가 이미 채워져 있으면 백필을 건너뛰어야 한다.

const { initDatabase, migrateDatabase, closeDatabase } = require('../../electron/storage/database')
const { searchMessages } = require('../../electron/storage/queries')

describe('FTS5 백필 가드', () => {
  let db

  beforeEach(() => {
    db = initDatabase(':memory:')
  })

  afterEach(() => closeDatabase(db))

  it('migrateDatabase 를 여러 번 호출해도 백필은 최초 1회만 수행된다', () => {
    // FTS5 도입 이전부터 있던 레거시 메시지를 흉내내기 위해 messages_fts 테이블이
    // 아예 존재하지 않는 상태(= migrateDatabase 를 한 번도 호출한 적 없는 구버전 DB)에서
    // messages 테이블에 직접 삽입한다 (saveMessage/트리거를 거치지 않음).
    db.prepare(`
      INSERT INTO messages (id, type, from_id, from_name, to_id, content, content_type, timestamp)
      VALUES ('msg-legacy', 'message', 'peer1', '홍길동', NULL, '안녕하세요 반갑습니다', 'text', 1)
    `).run()

    // 업그레이드 후 첫 로그인 — messages_fts 테이블이 이번 호출에서 처음 생성되므로 백필 수행
    migrateDatabase(db)
    // content='messages' 외부 콘텐츠 테이블은 MATCH 없는 count(*)/SELECT 가 인덱스를 거치지
    // 않고 원본 messages 테이블을 그대로 스캔해 행 수가 실제 인덱스 상태를 반영하지 못한다.
    // 따라서 반드시 MATCH 기반 검색으로 실제 토큰 인덱싱 여부를 검증해야 한다.
    expect(searchMessages(db, { query: '반갑습니다', type: 'message' })).toHaveLength(1)

    // 재로그인을 흉내낸 반복 호출 — messages_fts 가 이미 존재하므로 재시도하지 않아야 함
    // (에러 없이 통과하고, 검색 결과도 중복 없이 그대로 1건이어야 함)
    expect(() => {
      migrateDatabase(db)
      migrateDatabase(db)
    }).not.toThrow()
    expect(searchMessages(db, { query: '반갑습니다', type: 'message' })).toHaveLength(1)
  })

  it('메시지가 없는 새 프로필은 백필할 것이 없어도 에러 없이 통과한다', () => {
    expect(() => {
      migrateDatabase(db)
      migrateDatabase(db)
    }).not.toThrow()
    expect(searchMessages(db, { query: '아무거나', type: 'message' })).toHaveLength(0)
  })
})
