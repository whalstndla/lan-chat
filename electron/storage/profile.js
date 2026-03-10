// electron/storage/profile.js
const crypto = require('crypto')

// pbkdf2로 비밀번호 해시 (Node.js 내장, 추가 의존성 없음)
function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(
    password,
    salt,
    310000,      // 반복 횟수 (NIST 권장값)
    32,
    'sha256'
  ).toString('hex')
}

function saveProfile(db, { username, nickname, password }) {
  const salt = crypto.randomBytes(16).toString('hex')
  const passwordHash = hashPassword(password, salt)

  db.prepare(`
    INSERT OR REPLACE INTO profile (id, username, nickname, password_hash, salt, created_at)
    VALUES (1, @username, @nickname, @passwordHash, @salt, @createdAt)
  `).run({ username, nickname, passwordHash, salt, createdAt: Date.now() })
}

function getProfile(db) {
  return db.prepare('SELECT * FROM profile WHERE id = 1').get() || null
}

// 아이디 + 비밀번호 검증 → boolean
function verifyPassword(db, username, password) {
  const profile = getProfile(db)
  if (!profile || profile.username !== username) return false

  const inputHash = hashPassword(password, profile.salt)
  // timing-safe 비교로 timing attack 방지
  return crypto.timingSafeEqual(
    Buffer.from(inputHash, 'hex'),
    Buffer.from(profile.password_hash, 'hex')
  )
}

module.exports = { saveProfile, getProfile, verifyPassword }
