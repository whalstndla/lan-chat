// electron/storage/pendingMessages.js

function savePendingMessage(db, { id, targetPeerId, messagePayload }) {
  db.prepare(`
    INSERT OR IGNORE INTO pending_messages (id, target_peer_id, message_payload, created_at)
    VALUES (@id, @targetPeerId, @messagePayload, @createdAt)
  `).run({ id, targetPeerId, messagePayload: JSON.stringify(messagePayload), createdAt: Date.now() })
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

module.exports = { savePendingMessage, getPendingMessages, deletePendingMessage }
