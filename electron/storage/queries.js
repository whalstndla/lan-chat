// electron/storage/queries.js
function saveMessage(db, message) {
  db.prepare(`
    INSERT OR IGNORE INTO messages
    (id, type, from_id, from_name, to_id, content, content_type, encrypted_payload, file_url, file_name, timestamp, format)
    VALUES (@id, @type, @from_id, @from_name, @to_id, @content, @content_type, @encrypted_payload, @file_url, @file_name, @timestamp, @format)
  `).run({ ...message, format: message.format || null })

  // 글로벌 메시지만 FTS 인덱스에 동기화 (DM은 암호화되어 인덱싱 불가)
  // content='messages' 모드에서 FTS rowid는 반드시 messages 테이블의 rowid와 일치해야 함.
  // rowid 미지정 시 FTS rowid가 자동 증가하여 messages rowid와 어긋나고
  // 다른 메시지(dm 등)가 검색 결과에 섞이는 버그가 발생하므로 rowid를 명시적으로 지정함.
  if (message.type === 'message' && message.content) {
    try {
      const savedRow = db.prepare('SELECT rowid FROM messages WHERE id = ?').get(message.id)
      if (savedRow) {
        db.prepare('INSERT INTO messages_fts(rowid, id, content, from_name) VALUES (?, ?, ?, ?)')
          .run(savedRow.rowid, message.id, message.content, message.from_name)
      }
    } catch { /* FTS 테이블 없으면 무시 */ }
  }
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

// 전체 채팅 기록 삭제 (global + DM + pending 모두) — 트랜잭션으로 원자적 실행
function clearAllMessages(db) {
  db.transaction(() => {
    db.prepare('DELETE FROM messages').run()
    db.prepare('DELETE FROM pending_messages').run()
  })()
}

// DM 기록만 삭제 (DM 메시지 + pending) — 트랜잭션으로 원자적 실행
function clearAllDMs(db) {
  db.transaction(() => {
    db.prepare("DELETE FROM messages WHERE type = 'dm'").run()
    db.prepare('DELETE FROM pending_messages').run()
  })()
}

// 특정 상대가 보낸 안읽은 DM 메시지 ID 전체 조회 (제한 없음)
function getUnreadDMMessageIds(db, myPeerId, senderPeerId) {
  return db.prepare(`
    SELECT id FROM messages
    WHERE type = 'dm' AND from_id = ? AND to_id = ? AND read = 0
  `).all(senderPeerId, myPeerId).map(row => row.id)
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

// 파일 캐시 경로 저장 — 수신된 파일을 로컬에 캐시한 경로를 메시지에 연결
function saveFileCache(db, { messageId, cachedPath }) {
  db.prepare('UPDATE messages SET cached_file_path = ? WHERE id = ?').run(cachedPath, messageId)
}

// 파일 캐시 경로 조회 — 없으면 null 반환
function getFileCache(db, messageId) {
  const row = db.prepare('SELECT cached_file_path FROM messages WHERE id = ?').get(messageId)
  return row?.cached_file_path || null
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

module.exports = { saveMessage, getGlobalHistory, getDMHistory, deleteMessage, editMessage, getDMPeers, clearAllMessages, clearAllDMs, markMessagesAsRead, getUnreadDMMessageIds, addReaction, removeReaction, getReactions, getReactionsByMessageIds, searchMessages, saveFileCache, getFileCache, savePeerCache, loadPeerCache, deletePeerCache }
