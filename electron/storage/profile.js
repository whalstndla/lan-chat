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

function updatePeerId(db, peerId) {
  db.prepare('UPDATE profile SET peer_id = ? WHERE id = 1').run(peerId)
}

function updateLastLogin(db) {
  db.prepare('UPDATE profile SET last_login_at = ? WHERE id = 1').run(Date.now())
}

function clearLastLogin(db) {
  db.prepare('UPDATE profile SET last_login_at = NULL WHERE id = 1').run()
}

function updateNickname(db, nickname) {
  db.prepare('UPDATE profile SET nickname = ? WHERE id = 1').run(nickname)
}

function updateProfileImage(db, imageName) {
  db.prepare('UPDATE profile SET profile_image = ? WHERE id = 1').run(imageName)
}

// 알림 설정 조회 — 커스텀 사운드 파일이 있으면 Uint8Array로 읽어서 반환
function getNotificationSettings(db, appDataPath) {
  const fs = require('fs')
  const path = require('path')
  const profile = getProfile(db)
  const sound = profile?.notification_sound || 'notification1'
  const volume = profile?.notification_volume ?? 0.7
  let customSoundBuffer = null
  if (profile?.notification_custom_sound) {
    const soundPath = path.join(appDataPath, 'sounds', profile.notification_custom_sound)
    if (fs.existsSync(soundPath)) {
      customSoundBuffer = new Uint8Array(fs.readFileSync(soundPath))
    }
  }
  return { sound, volume, customSoundBuffer }
}

// 알림 설정 저장
function saveNotificationSettings(db, { sound, volume }) {
  db.prepare(
    'UPDATE profile SET notification_sound = ?, notification_volume = ? WHERE id = 1'
  ).run(sound, volume)
}

// 커스텀 사운드 파일 저장 — appData/sounds/ 에 저장 후 파일명을 DB에 기록
function saveCustomNotificationSound(db, appDataPath, buffer, extension) {
  const fs = require('fs')
  const path = require('path')
  const soundsDir = path.join(appDataPath, 'sounds')
  if (!fs.existsSync(soundsDir)) fs.mkdirSync(soundsDir, { recursive: true })
  const filename = `notification_custom.${extension}`
  fs.writeFileSync(path.join(soundsDir, filename), Buffer.from(buffer))
  db.prepare('UPDATE profile SET notification_custom_sound = ? WHERE id = 1').run(filename)
  return filename
}

// 비밀번호 변경 — 기존 비밀번호 검증 후 새 비밀번호로 교체
function updatePassword(db, username, oldPassword, newPassword) {
  const isValid = verifyPassword(db, username, oldPassword)
  if (!isValid) return { success: false, error: '현재 비밀번호가 올바르지 않습니다.' }

  const newSalt = crypto.randomBytes(16).toString('hex')
  const newHash = hashPassword(newPassword, newSalt)
  db.prepare('UPDATE profile SET password_hash = ?, salt = ? WHERE id = 1').run(newHash, newSalt)
  return { success: true }
}

module.exports = {
  saveProfile, getProfile, verifyPassword,
  updatePeerId, updateLastLogin, clearLastLogin, updateNickname, updateProfileImage,
  getNotificationSettings, saveNotificationSettings, saveCustomNotificationSound,
  updatePassword,
}
