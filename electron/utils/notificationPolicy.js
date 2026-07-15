// electron/utils/notificationPolicy.js
// 소리 + OS 알림 발송 여부/본문을 결정하는 알림 정책 (#42).
// 안읽음 배지(카운트)는 이 판정과 무관하게 호출부(message.js/dm.js)가 항상 유지한다.

const { getProfile } = require('../storage/profile')
const { isRoomMuted } = require('./appUtils')

// 순수 판정 함수 — 방 뮤트/알림 범위(scope)/방해금지(dnd)/@멘션(#29) 조건으로
// 소리+OS알림 여부를 결정한다.
// roomType: 'global' | 'dm'
// scope: 'all'(전체) | 'dm'(DM만) | 'mention'(멘션만) | 'off'(끄기)
//
// 우선순위(#29): dnd > scope='off' > 멘션 override > 뮤트 > scope 나머지 분기.
// - dnd(방해금지)와 scope='off'(전체 알림 끄기)는 사용자의 명시적 "완전 차단" 의도이므로
//   멘션이어도 절대 우회하지 않는다.
// - 멘션이면 "뮤트된 방"과 "scope='dm'인데 전체채팅 메시지"라는 두 가지 억제 조건을
//   우회한다 — 일반적으로 멘션은 뮤트보다 강하게 알려야 하고, DM만 알림을 받기로
//   했더라도 전체채팅에서 내가 불렸다면 놓치면 안 되기 때문.
// - scope='mention'이면 멘션이 아닌 메시지는 이 지점에서 억제된다.
function shouldNotify({ roomType, scope, isMuted, isDnd, isMentioned }) {
  if (isDnd) return false
  if (scope === 'off') return false
  if (isMentioned) return true
  if (isMuted) return false
  if (scope === 'mention') return false
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
// isMentioned(#29) — 호출부가 "이 메시지의 mentions 에 내 peerId 가 포함되는지"를 미리 계산해 전달한다.
function resolveNotificationDecision(ctx, { roomType, roomKey, fallbackBody, isMentioned = false }) {
  const profile = ctx.state.database ? getProfile(ctx.state.database) : null
  const scope = profile?.notification_scope || 'all'
  const hideBody = !!profile?.notification_hide_body
  const isDnd = (profile?.status_type || 'online') === 'dnd'
  const isMuted = isRoomMuted(ctx, roomKey)

  return {
    notify: shouldNotify({ roomType, scope, isMuted, isDnd, isMentioned }),
    body: maskNotificationBody(hideBody, fallbackBody),
  }
}

module.exports = { shouldNotify, maskNotificationBody, resolveNotificationDecision }
