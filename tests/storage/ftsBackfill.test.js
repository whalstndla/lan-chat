// FTS5 백필 중복 방지 테스트 (#7)
// migrateDatabase() 는 로그인/등록마다 호출되므로, 가드 없이 매번 백필 INSERT 를
// 실행하면 동일 rowid 가 반복 삽입 시도되어 검색 결과가 중복되거나 인덱스가 계속
// 커지는 문제가 있었다. messages_fts 가 이미 채워져 있으면 백필을 건너뛰어야 한다.

const { initDatabase, migrateDatabase, closeDatabase } = require('../../electron/storage/database')
const { searchMessages, saveMessage } = require('../../electron/storage/queries')

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

// file_name 컬럼 추가 마이그레이션 안전성 테스트(#36).
// FTS5 external-content 테이블은 ALTER TABLE 로 컬럼을 추가할 수 없어, file_name 컬럼이
// 없는 구버전 messages_fts 가 이미 존재하는 사용자 DB 에서는 DROP 후 재생성 + 전체
// 재백필이 유일한 안전한 경로다. 트리거도 "CREATE TRIGGER IF NOT EXISTS" 로는 구버전
// 정의가 영구히 남으므로 매번 DROP 후 재생성되어야 한다.
describe('FTS5 file_name 컬럼 마이그레이션(#36)', () => {
  let db

  beforeEach(() => {
    db = initDatabase(':memory:')
  })

  afterEach(() => closeDatabase(db))

  it('file_name 컬럼이 없는 구버전 messages_fts 를 감지하면 DROP 후 재생성하고 전체를 재백필한다', () => {
    // 구버전(#36 이전) 스키마 흉내 — file_name 컬럼 없이 messages_fts 생성 + 구버전 트리거 등록
    db.exec(`
      CREATE VIRTUAL TABLE messages_fts USING fts5(
        id UNINDEXED, content, from_name,
        content='messages', content_rowid='rowid'
      );
      CREATE TRIGGER messages_fts_after_insert AFTER INSERT ON messages
      WHEN new.type = 'message' AND new.content IS NOT NULL
      BEGIN
        INSERT INTO messages_fts(rowid, id, content, from_name)
        VALUES (new.rowid, new.id, new.content, new.from_name);
      END;
    `)

    // 구버전 트리거를 거쳐 저장된 텍스트 메시지 (레거시 데이터)
    saveMessage(db, {
      id: 'msg-legacy-text', type: 'message', from_id: 'peer1', from_name: '홍길동', to_id: null,
      content: '레거시 회의록입니다', content_type: 'text', encrypted_payload: null,
      file_url: null, file_name: null, timestamp: 1000,
    })
    // 구버전 트리거의 WHEN 절(content IS NOT NULL)에 걸려 인덱싱되지 못했던 파일 메시지
    db.prepare(`
      INSERT INTO messages (id, type, from_id, from_name, to_id, content, content_type, file_name, timestamp)
      VALUES ('msg-legacy-file', 'message', 'peer1', '홍길동', NULL, NULL, 'file', '분기보고서.pdf', 1500)
    `).run()

    // 업그레이드 후 첫 로그인 — 구버전 스키마 감지 → DROP + 재생성 + 재백필 수행
    migrateDatabase(db)

    // 재백필 이후: 레거시 텍스트 메시지는 여전히 검색되고, 파일명으로도 새로 검색 가능해야 함
    expect(searchMessages(db, { query: '레거시', type: 'message' })).toHaveLength(1)
    const fileResults = searchMessages(db, { query: '분기보고서', type: 'message' })
    expect(fileResults).toHaveLength(1)
    expect(fileResults[0].id).toBe('msg-legacy-file')

    // 새 트리거가 실제로 등록되어 이후 저장되는 파일 메시지도 파일명으로 검색되어야 함
    saveMessage(db, {
      id: 'msg-new-file', type: 'message', from_id: 'peer2', from_name: '김철수', to_id: null,
      content: null, content_type: 'file', encrypted_payload: null,
      file_url: null, file_name: '신규계약서.hwp', timestamp: 2000,
    })
    expect(searchMessages(db, { query: '신규계약서', type: 'message' })).toHaveLength(1)

    // 재로그인을 흉내낸 반복 호출 — 이미 신규 스키마이므로 재백필/재드랍 없이 에러 없이 통과,
    // 검색 결과도 중복 없이 그대로 유지되어야 함
    expect(() => {
      migrateDatabase(db)
      migrateDatabase(db)
    }).not.toThrow()
    expect(searchMessages(db, { query: '레거시', type: 'message' })).toHaveLength(1)
    expect(searchMessages(db, { query: '분기보고서', type: 'message' })).toHaveLength(1)
    expect(searchMessages(db, { query: '신규계약서', type: 'message' })).toHaveLength(1)
  })
})
