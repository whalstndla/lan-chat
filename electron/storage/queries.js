// electron/storage/queries.js
function saveMessage(db, message) {
  db.prepare(`
    INSERT OR IGNORE INTO messages
    (id, type, from_id, from_name, to_id, content, content_type, encrypted_payload, file_url, file_name, timestamp)
    VALUES (@id, @type, @from_id, @from_name, @to_id, @content, @content_type, @encrypted_payload, @file_url, @file_name, @timestamp)
  `).run(message)
}

function getGlobalHistory(db, limit = 100) {
  return db.prepare(`
    SELECT * FROM messages
    WHERE type = 'message'
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(limit).reverse()
}

function getDMHistory(db, peerId1, peerId2, limit = 100) {
  return db.prepare(`
    SELECT * FROM messages
    WHERE type = 'dm'
      AND ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?))
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(peerId1, peerId2, peerId2, peerId1, limit).reverse()
}

function deleteMessage(db, messageId, fromId) {
  return db.prepare('DELETE FROM messages WHERE id = ? AND from_id = ?').run(messageId, fromId)
}

// 나와 DM을 나눈 고유 상대 목록 (최신 메시지 순)
function getDMPeers(db, myPeerId) {
  const rows = db.prepare(`
    SELECT
      CASE WHEN from_id = ? THEN to_id ELSE from_id END AS peer_id,
      MAX(timestamp) AS last_timestamp
    FROM messages
    WHERE type = 'dm' AND (from_id = ? OR to_id = ?)
    GROUP BY CASE WHEN from_id = ? THEN to_id ELSE from_id END
    ORDER BY last_timestamp DESC
  `).all(myPeerId, myPeerId, myPeerId, myPeerId)

  return rows.map(row => {
    // 상대방이 보낸 가장 최근 메시지에서 닉네임 추출
    const lastFromPeer = db.prepare(`
      SELECT from_name FROM messages
      WHERE type = 'dm' AND from_id = ?
      ORDER BY timestamp DESC LIMIT 1
    `).get(row.peer_id)
    return {
      peerId: row.peer_id,
      nickname: lastFromPeer?.from_name || '알 수 없음',
    }
  })
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

module.exports = { saveMessage, getGlobalHistory, getDMHistory, deleteMessage, getDMPeers, clearAllMessages, clearAllDMs, markMessagesAsRead, getUnreadDMMessageIds }
