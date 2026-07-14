// electron/utils/notificationPolicy.js
// 소리 + OS 알림 발송 여부/본문을 결정하는 알림 정책 (#42).
// 안읽음 배지(카운트)는 이 판정과 무관하게 호출부(message.js/dm.js)가 항상 유지한다.

const { getProfile } = require('../storage/profile')
const { isRoomMuted } = require('./appUtils')

// 순수 판정 함수 — 방 뮤트/알림 범위(scope)/방해금지(dnd) 조건으로 소리+OS알림 여부를 결정한다.
// roomType: 'global' | 'dm'
// scope: 'all'(전체) | 'dm'(DM만) | 'off'(끄기)
function shouldNotify({ roomType, scope, isMuted, isDnd }) {
  if (isMuted) return false
  if (isDnd) return false
  if (scope === 'off') return false
  if (scope === 'dm' && roomType !== 'dm') return false
  return true
}

// 순수 함수 — OS 알림 본문 마스킹. hideBody 활성화 시 실제 내용 대신 고정 문구만 노출한다
// (민감 정보가 잠금화면/알림센터에 그대로 노출되는 것을 막기 위한 보안 지향 옵션).
function maskNotificationBody(hideBody, actualBody) {
  return hideBody ? '새 메시지' : actualBody
}

// ctx + 방 정보로부터 "소리/OS알림을 보낼지"와 "마스킹된 본문"을 한 번에 결정한다.
// message.js/dm.js 인바운드 핸들러가 사용하는 통합 진입점.
function resolveNotificationDecision(ctx, { roomType, roomKey, fallbackBody }) {
  const profile = ctx.state.database ? getProfile(ctx.state.database) : null
  const scope = profile?.notification_scope || 'all'
  const hideBody = !!profile?.notification_hide_body
  const isDnd = (profile?.status_type || 'online') === 'dnd'
  const isMuted = isRoomMuted(ctx, roomKey)

  return {
    notify: shouldNotify({ roomType, scope, isMuted, isDnd }),
    body: maskNotificationBody(hideBody, fallbackBody),
  }
}

module.exports = { shouldNotify, maskNotificationBody, resolveNotificationDecision }
