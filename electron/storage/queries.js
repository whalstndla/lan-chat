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

module.exports = { saveMessage, getGlobalHistory, getDMHistory }
