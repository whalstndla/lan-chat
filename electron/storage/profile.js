// electron/storage/profile.js
const crypto = require('crypto')
const { promisify } = require('util')

// crypto.pbkdf2 콜백 API를 promisify — pbkdf2Sync 는 로그인/등록 처리 중 메인 이벤트 루프를
// 수백 ms 정지시키므로 비동기로 전환한다. iterations/keylen/digest 는 기존 저장된 비밀번호
// 해시와의 호환을 위해 절대 변경하지 않는다.
const pbkdf2Async = promisify(crypto.pbkdf2)

// pbkdf2로 비밀번호 해시 (Node.js 내장, 추가 의존성 없음)
async function hashPassword(password, salt) {
  const derived = await pbkdf2Async(
    password,
    salt,
    310000,      // 반복 횟수 (NIST 권장값)
    32,
    'sha256'
  )
  return derived.toString('hex')
}

async function saveProfile(db, { username, nickname, password }) {
  const salt = crypto.randomBytes(16).toString('hex')
  const passwordHash = await hashPassword(password, salt)

  db.prepare(`
    INSERT OR REPLACE INTO profile (id, username, nickname, password_hash, salt, created_at)
    VALUES (1, @username, @nickname, @passwordHash, @salt, @createdAt)
  `).run({ username, nickname, passwordHash, salt, createdAt: Date.now() })
}

function getProfile(db) {
  return db.prepare('SELECT * FROM profile WHERE id = 1').get() || null
}

// 아이디 + 비밀번호 검증 → boolean
async function verifyPassword(db, username, password) {
  const profile = getProfile(db)
  if (!profile || profile.username !== username) return false

  const inputHash = await hashPassword(password, profile.salt)
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
  const scope = profile?.notification_scope || 'all'
  const hideBody = !!profile?.notification_hide_body
  let customSoundBuffer = null
  if (profile?.notification_custom_sound) {
    const soundPath = path.join(appDataPath, 'sounds', profile.notification_custom_sound)
    if (fs.existsSync(soundPath)) {
      customSoundBuffer = new Uint8Array(fs.readFileSync(soundPath))
    }
  }
  return { sound, volume, customSoundBuffer, scope, hideBody }
}

// 알림 설정 저장 — scope/hideBody 는 선택적으로 전달되며, 생략 시 기존 값을 유지한다
// (기존 호출부가 sound/volume 만 넘겨도 알림 범위/본문 숨김 설정이 초기화되지 않도록).
function saveNotificationSettings(db, { sound, volume, scope, hideBody }) {
  const current = getProfile(db)
  const nextScope = scope !== undefined ? scope : (current?.notification_scope || 'all')
  const nextHideBody = hideBody !== undefined ? (hideBody ? 1 : 0) : (current?.notification_hide_body ? 1 : 0)
  db.prepare(
    'UPDATE profile SET notification_sound = ?, notification_volume = ?, notification_scope = ?, notification_hide_body = ? WHERE id = 1'
  ).run(sound, volume, nextScope, nextHideBody)
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

// 링크 미리보기 사용 여부 조회 — 기본값 on(true).
// 완전 단절 모드 사용자는 off 로 두어 링크 프리뷰용 외부 요청을 완전히 막을 수 있다.
function getLinkPreviewEnabled(db) {
  if (!db) return true
  const profile = getProfile(db)
  // 컬럼/행이 없으면(마이그레이션 전 등) 기존 동작(on) 유지
  if (!profile || profile.link_preview_enabled === undefined || profile.link_preview_enabled === null) {
    return true
  }
  return !!profile.link_preview_enabled
}

// 링크 미리보기 사용 여부 저장
function setLinkPreviewEnabled(db, enabled) {
  db.prepare('UPDATE profile SET link_preview_enabled = ? WHERE id = 1').run(enabled ? 1 : 0)
}

// 상태 타입 및 상태 메시지 저장
function updateStatus(db, { statusType, statusMessage }) {
  db.prepare('UPDATE profile SET status_type = ?, status_message = ? WHERE id = 1')
    .run(statusType, statusMessage || '')
}

// 비밀번호 변경 — 기존 비밀번호 검증 후 새 비밀번호로 교체
async function updatePassword(db, username, oldPassword, newPassword) {
  const isValid = await verifyPassword(db, username, oldPassword)
  if (!isValid) return { success: false, error: '현재 비밀번호가 올바르지 않습니다.' }

  const newSalt = crypto.randomBytes(16).toString('hex')
  const newHash = await hashPassword(newPassword, newSalt)
  db.prepare('UPDATE profile SET password_hash = ?, salt = ? WHERE id = 1').run(newHash, newSalt)
  return { success: true }
}

module.exports = {
  saveProfile, getProfile, verifyPassword,
  updatePeerId, updateLastLogin, clearLastLogin, updateNickname, updateProfileImage,
  getNotificationSettings, saveNotificationSettings, saveCustomNotificationSound,
  getLinkPreviewEnabled, setLinkPreviewEnabled,
  updatePassword, updateStatus,
}
