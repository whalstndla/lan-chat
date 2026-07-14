// electron/storage/queries.js
function saveMessage(db, message) {
  db.prepare(`
    INSERT OR IGNORE INTO messages
    (id, type, from_id, from_name, to_id, content, content_type, encrypted_payload, file_url, file_name, timestamp, format)
    VALUES (@id, @type, @from_id, @from_name, @to_id, @content, @content_type, @encrypted_payload, @file_url, @file_name, @timestamp, @format)
  `).run({ ...message, format: message.format || null })

  // FTS5 동기화(INSERT/UPDATE/DELETE)는 database.js 의 messages_fts_after_* 트리거가
  // 전담한다. 과거엔 여기서 수동으로 INSERT 했으나, 트리거와 병행하면 동일 rowid 를
  // 두 번 삽입 시도하게 되어 제거함 (edit/delete/clearAll 은 트리거가 없으면 FTS 가
  // 동기화되지 않던 문제(#8)의 원인이기도 했다).
}

function getGlobalHistory(db, limit = 100, offset = 0) {
  return db.prepare(`
    SELECT * FROM messages
    WHERE type = 'message'
    ORDER BY timestamp DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset).reverse()
}

function getDMHistory(db, peerId1, peerId2, limit = 100, offset = 0) {
  return db.prepare(`
    SELECT * FROM messages
    WHERE type = 'dm'
      AND ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?))
    ORDER BY timestamp DESC
    LIMIT ? OFFSET ?
  `).all(peerId1, peerId2, peerId2, peerId1, limit, offset).reverse()
}

function deleteMessage(db, messageId, fromId) {
  return db.prepare('DELETE FROM messages WHERE id = ? AND from_id = ?').run(messageId, fromId)
}

// 나와 DM을 나눈 고유 상대 목록 (최신 메시지 순) — 단일 쿼리로 닉네임까지 조회
function getDMPeers(db, myPeerId) {
  return db.prepare(`
    SELECT
      CASE WHEN from_id = ? THEN to_id ELSE from_id END AS peer_id,
      MAX(timestamp) AS last_timestamp,
      (
        SELECT m2.from_name FROM messages m2
        WHERE m2.type = 'dm'
          AND m2.from_id = CASE WHEN messages.from_id = ? THEN messages.to_id ELSE messages.from_id END
        ORDER BY m2.timestamp DESC LIMIT 1
      ) AS nickname
    FROM messages
    WHERE type = 'dm' AND (from_id = ? OR to_id = ?)
    GROUP BY peer_id
    ORDER BY last_timestamp DESC
  `).all(myPeerId, myPeerId, myPeerId, myPeerId).map(row => ({
    peerId: row.peer_id,
    nickname: row.nickname || '알 수 없음',
  }))
}

// 전체 채팅 기록 삭제 (global + DM + pending 모두) — 트랜잭션으로 원자적 실행.
// 삭제되는 메시지가 참조하던 file_cache 경로 목록을 반환 — 호출자가 DB 삭제 이후
// (트랜잭션 밖에서) 실제 캐시 파일을 지우는 데 사용한다 (#24, DB 행만 지우고
// 캐시 파일은 고아로 남던 문제).
function clearAllMessages(db) {
  const cachedFilePaths = db.prepare(
    'SELECT cached_file_path FROM messages WHERE cached_file_path IS NOT NULL'
  ).all().map(row => row.cached_file_path)
  db.transaction(() => {
    db.prepare('DELETE FROM messages').run()
    db.prepare('DELETE FROM pending_messages').run()
  })()
  // VACUUM 은 트랜잭션 내부에서 실행할 수 없어 트랜잭션이 커밋된 이후에 호출한다.
  // 전체 삭제처럼 큰 폭으로 비워진 페이지를 회수해 디스크 파일 크기를 줄인다(#27).
  try { db.exec('VACUUM') } catch { /* VACUUM 실패해도 삭제 자체는 이미 커밋된 상태이므로 무시 */ }
  return { cachedFilePaths }
}

// DM 기록만 삭제 (DM 메시지 + pending) — 트랜잭션으로 원자적 실행.
// clearAllMessages 와 마찬가지로 삭제되는 DM 이 참조하던 file_cache 경로를 반환한다.
function clearAllDMs(db) {
  const cachedFilePaths = db.prepare(
    "SELECT cached_file_path FROM messages WHERE type = 'dm' AND cached_file_path IS NOT NULL"
  ).all().map(row => row.cached_file_path)
  db.transaction(() => {
    db.prepare("DELETE FROM messages WHERE type = 'dm'").run()
    db.prepare('DELETE FROM pending_messages').run()
  })()
  try { db.exec('VACUUM') } catch { /* 무시 */ }
  return { cachedFilePaths }
}

// 특정 상대가 보낸 안읽은 DM 메시지 ID 전체 조회 (제한 없음)
function getUnreadDMMessageIds(db, myPeerId, senderPeerId) {
  return db.prepare(`
    SELECT id FROM messages
    WHERE type = 'dm' AND from_id = ? AND to_id = ? AND read = 0
  `).all(senderPeerId, myPeerId).map(row => row.id)
}

// 상대별 안읽은 DM 개수 일괄 조회 — { peerId: count } 형태로 반환.
// 부팅/재로그인 시 DB 의 read=0 상태를 사이드바 배지에 복원하는 용도.
function getUnreadCountsByPeer(db, myPeerId) {
  const rows = db.prepare(`
    SELECT from_id AS peerId, COUNT(*) AS count
    FROM messages
    WHERE type = 'dm' AND to_id = ? AND read = 0
    GROUP BY from_id
  `).all(myPeerId)
  return Object.fromEntries(rows.map(row => [row.peerId, row.count]))
}

// DM 메시지 읽음 상태 DB 업데이트
function markMessagesAsRead(db, messageIds) {
  if (!messageIds?.length) return
  const placeholders = messageIds.map(() => '?').join(',')
  db.prepare(`UPDATE messages SET read = 1 WHERE id IN (${placeholders})`).run(...messageIds)
}

// 리액션 추가 — 동일 (message_id, peer_id, emoji) 조합은 무시
function addReaction(db, { messageId, peerId, emoji }) {
  db.prepare('INSERT OR IGNORE INTO reactions (message_id, peer_id, emoji, created_at) VALUES (?, ?, ?, ?)')
    .run(messageId, peerId, emoji, Date.now())
}

// 리액션 제거
function removeReaction(db, { messageId, peerId, emoji }) {
  db.prepare('DELETE FROM reactions WHERE message_id = ? AND peer_id = ? AND emoji = ?')
    .run(messageId, peerId, emoji)
}

// 특정 메시지의 리액션 전체 조회
function getReactions(db, messageId) {
  return db.prepare('SELECT * FROM reactions WHERE message_id = ?').all(messageId)
}

// 여러 메시지 ID의 리액션을 한 번에 조회 — { messageId: [row, ...] } 형태로 반환
function getReactionsByMessageIds(db, messageIds) {
  if (!messageIds?.length) return {}
  const placeholders = messageIds.map(() => '?').join(',')
  const rows = db.prepare(`SELECT * FROM reactions WHERE message_id IN (${placeholders})`).all(...messageIds)
  const grouped = {}
  for (const row of rows) {
    if (!grouped[row.message_id]) grouped[row.message_id] = []
    grouped[row.message_id].push(row)
  }
  return grouped
}

// 메시지 내용 수정 — 본인이 보낸 메시지만 수정 가능 (from_id 검증)
function editMessage(db, { messageId, fromId, newContent }) {
  return db.prepare('UPDATE messages SET content = ?, edited_at = ? WHERE id = ? AND from_id = ?')
    .run(newContent, Date.now(), messageId, fromId)
}

// 메시지 전문 검색 — FTS5 지원 시 사용, 미지원 시 LIKE 폴백
function searchMessages(db, { query, type, limit = 50 }) {
  if (!query?.trim()) return []
  try {
    // FTS5 MATCH로 전문 검색 (접두사 검색 지원)
    let sql = `SELECT m.* FROM messages m INNER JOIN messages_fts fts ON m.id = fts.id WHERE messages_fts MATCH ?`
    const params = [query + '*']
    if (type) { sql += ' AND m.type = ?'; params.push(type) }
    sql += ' ORDER BY m.timestamp DESC LIMIT ?'
    params.push(limit)
    return db.prepare(sql).all(...params)
  } catch {
    // FTS5 미지원 시 LIKE 폴백
    let sql = 'SELECT * FROM messages WHERE content LIKE ?'
    const params = [`%${query}%`]
    if (type) { sql += ' AND type = ?'; params.push(type) }
    sql += ' ORDER BY timestamp DESC LIMIT ?'
    params.push(limit)
    return db.prepare(sql).all(...params)
  }
}

// DM 전체 기간 검색용 — 페이지네이션 없이 상대와 나눈 DM 을 최신순으로 넉넉한 한도까지 조회.
// DM 은 암호화 저장이라 FTS 인덱싱이 불가능하므로, 여기서 가져온 레코드를 호출자(IPC 핸들러)가
// main 프로세스에서 복호화하며 순차 검색한다(#35). 대량 채팅 대비 안전한 상한을 둔다.
const DM_SEARCH_FETCH_LIMIT = 5000
function getAllDMMessagesForSearch(db, peerId1, peerId2, limit = DM_SEARCH_FETCH_LIMIT) {
  return db.prepare(`
    SELECT * FROM messages
    WHERE type = 'dm'
      AND ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?))
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(peerId1, peerId2, peerId2, peerId1, limit)
}

// 검색 결과 점프용 — 특정 타임스탬프보다 최신인 메시지 개수를 반환한다(#36).
// 이 값 + 1 을 limit 으로 getGlobalHistory/getDMHistory 를 호출하면, 오프셋 계산 없이
// 한 번에 해당 메시지가 포함되는 지점까지의 히스토리를 정확히 불러올 수 있다.
function getGlobalMessageRank(db, timestamp) {
  const row = db.prepare(`
    SELECT COUNT(*) AS count FROM messages WHERE type = 'message' AND timestamp > ?
  `).get(timestamp)
  return row.count
}

function getDMMessageRank(db, peerId1, peerId2, timestamp) {
  const row = db.prepare(`
    SELECT COUNT(*) AS count FROM messages
    WHERE type = 'dm'
      AND ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?))
      AND timestamp > ?
  `).get(peerId1, peerId2, peerId2, peerId1, timestamp)
  return row.count
}

// 파일 캐시 경로 저장 — 수신된 파일을 로컬에 캐시한 경로를 메시지에 연결
function saveFileCache(db, { messageId, cachedPath }) {
  db.prepare('UPDATE messages SET cached_file_path = ? WHERE id = ?').run(cachedPath, messageId)
}

// 파일 캐시 경로 조회 — 없으면 null 반환
function getFileCache(db, messageId) {
  const row = db.prepare('SELECT cached_file_path FROM messages WHERE id = ?').get(messageId)
  return row?.cached_file_path || null
}

// 다운로드용 원본 파일명 + 캐시 경로 조회 — download-file IPC 핸들러에서 사용.
// 메시지가 없으면 null 반환.
function getFileForDownload(db, messageId) {
  const row = db.prepare('SELECT file_name, cached_file_path FROM messages WHERE id = ?').get(messageId)
  if (!row) return null
  return { fileName: row.file_name, cachedFilePath: row.cached_file_path }
}

// 방별 마지막 읽은 지점(타임스탬프) 전체 조회 — { roomKey: timestamp } 형태로 반환.
// 부팅 시 안읽음 구분선 위치를 복원하는 데 사용된다(#39).
function getRoomReadState(db) {
  const rows = db.prepare('SELECT room_key, last_read_timestamp FROM room_read_state').all()
  return Object.fromEntries(rows.map(row => [row.room_key, row.last_read_timestamp]))
}

// 방별 마지막 읽은 지점 갱신(upsert) — 방 진입/이탈 시 호출되어 재시작 후에도 안읽음
// 구분선 위치가 유지되도록 영속화한다. timestamp 는 해당 방에 메시지가 아직 없으면 null.
function setRoomReadTimestamp(db, roomKey, timestamp) {
  db.prepare(`
    INSERT INTO room_read_state (room_key, last_read_timestamp) VALUES (?, ?)
    ON CONFLICT(room_key) DO UPDATE SET last_read_timestamp = excluded.last_read_timestamp
  `).run(roomKey, timestamp)
}

// 피어 캐시 저장 — key-exchange 성공 시 IP·포트 기록 (mDNS 없이도 재연결 가능)
function savePeerCache(db, { peerId, ip, wsPort, nickname }) {
  db.prepare(`
    INSERT INTO peer_cache (peer_id, ip, ws_port, nickname, last_seen)
    VALUES (@peerId, @ip, @wsPort, @nickname, strftime('%s','now') * 1000)
    ON CONFLICT(peer_id) DO UPDATE SET
      ip = excluded.ip,
      ws_port = excluded.ws_port,
      nickname = excluded.nickname,
      last_seen = excluded.last_seen
  `).run({ peerId, ip, wsPort, nickname })
}

// 피어 캐시 전체 조회 (최근 접속 순, 최대 20개)
function loadPeerCache(db) {
  return db.prepare(`
    SELECT peer_id AS peerId, ip, ws_port AS wsPort, nickname
    FROM peer_cache
    ORDER BY last_seen DESC
    LIMIT 20
  `).all()
}

// 특정 피어 캐시 삭제
function deletePeerCache(db, peerId) {
  db.prepare('DELETE FROM peer_cache WHERE peer_id = ?').run(peerId)
}

module.exports = { saveMessage, getGlobalHistory, getDMHistory, deleteMessage, editMessage, getDMPeers, clearAllMessages, clearAllDMs, markMessagesAsRead, getUnreadDMMessageIds, getUnreadCountsByPeer, getRoomReadState, setRoomReadTimestamp, addReaction, removeReaction, getReactions, getReactionsByMessageIds, searchMessages, getAllDMMessagesForSearch, getGlobalMessageRank, getDMMessageRank, saveFileCache, getFileCache, getFileForDownload, savePeerCache, loadPeerCache, deletePeerCache }
