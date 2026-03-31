// electron/storage/pendingMessages.js

// 오프라인 상태의 피어에게 보낼 메시지를 저장
// originalTimestamp가 있으면 원래 전송 시점의 타임스탬프를 사용
function savePendingMessage(db, { id, targetPeerId, messagePayload, originalTimestamp }) {
  db.prepare(`
    INSERT OR IGNORE INTO pending_messages (id, target_peer_id, message_payload, created_at)
    VALUES (@id, @targetPeerId, @messagePayload, @createdAt)
  `).run({ id, targetPeerId, messagePayload: JSON.stringify(messagePayload), createdAt: originalTimestamp || Date.now() })
}

function getPendingMessages(db, targetPeerId) {
  return db.prepare(
    'SELECT * FROM pending_messages WHERE target_peer_id = ? ORDER BY created_at ASC'
  ).all(targetPeerId).map(row => ({
    ...row,
    messagePayload: JSON.parse(row.message_payload),
  }))
}

function deletePendingMessage(db, messageId) {
  db.prepare('DELETE FROM pending_messages WHERE id = ?').run(messageId)
}

// 만료된 pending 메시지 자동 삭제 (기본 7일)
function deleteExpiredPendingMessages(db, maxAgeDays = 7) {
  const expirationTime = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
  db.prepare('DELETE FROM pending_messages WHERE created_at < ?').run(expirationTime)
}

module.exports = { savePendingMessage, getPendingMessages, deletePendingMessage, deleteExpiredPendingMessages }
