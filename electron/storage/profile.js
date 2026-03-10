// electron/storage/profile.js
const crypto = require('crypto')

// pbkdf2로 비밀번호 해시 (Node.js 내장, 추가 의존성 없음)
function 비밀번호해시(password, salt) {
  return crypto.pbkdf2Sync(
    password,
    salt,
    310000,      // 반복 횟수 (NIST 권장값)
    32,
    'sha256'
  ).toString('hex')
}

function 프로필저장(데이터베이스, { username, nickname, password }) {
  const salt = crypto.randomBytes(16).toString('hex')
  const passwordHash = 비밀번호해시(password, salt)

  데이터베이스.prepare(`
    INSERT OR REPLACE INTO profile (id, username, nickname, password_hash, salt, created_at)
    VALUES (1, @username, @nickname, @passwordHash, @salt, @createdAt)
  `).run({ username, nickname, passwordHash, salt, createdAt: Date.now() })
}

function 프로필조회(데이터베이스) {
  return 데이터베이스.prepare('SELECT * FROM profile WHERE id = 1').get() || null
}

// 아이디 + 비밀번호 검증 → boolean
function 비밀번호검증(데이터베이스, username, password) {
  const 프로필 = 프로필조회(데이터베이스)
  if (!프로필 || 프로필.username !== username) return false

  const 입력해시 = 비밀번호해시(password, 프로필.salt)
  // timing-safe 비교로 timing attack 방지
  return crypto.timingSafeEqual(
    Buffer.from(입력해시, 'hex'),
    Buffer.from(프로필.password_hash, 'hex')
  )
}

module.exports = { 프로필저장, 프로필조회, 비밀번호검증 }
