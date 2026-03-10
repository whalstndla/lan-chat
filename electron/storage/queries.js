// electron/storage/queries.js
function 메시지저장(데이터베이스, 메시지) {
  데이터베이스.prepare(`
    INSERT OR IGNORE INTO messages
    (id, type, from_id, from_name, to_id, content, content_type, encrypted_payload, file_url, file_name, timestamp)
    VALUES (@id, @type, @from_id, @from_name, @to_id, @content, @content_type, @encrypted_payload, @file_url, @file_name, @timestamp)
  `).run(메시지)
}

function 전체채팅기록조회(데이터베이스, 개수 = 100) {
  return 데이터베이스.prepare(`
    SELECT * FROM messages
    WHERE type = 'message'
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(개수).reverse()
}

function DM기록조회(데이터베이스, 피어아이디1, 피어아이디2, 개수 = 100) {
  return 데이터베이스.prepare(`
    SELECT * FROM messages
    WHERE type = 'dm'
      AND ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?))
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(피어아이디1, 피어아이디2, 피어아이디2, 피어아이디1, 개수).reverse()
}

module.exports = { 메시지저장, 전체채팅기록조회, DM기록조회 }
