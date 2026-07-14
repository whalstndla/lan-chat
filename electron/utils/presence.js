// electron/utils/presence.js
// 유휴 자동 자리비움(auto-away) 판정 + 주기적 감시 (#41).
//
// 사용자가 명시적으로 설정한 상태(DB profile.status_type, "manualStatusType")가
// 'online' 일 때만 자동 전환 대상이다 — busy/dnd/away 등 사용자가 직접 고른 상태는
// 절대 덮어쓰지 않는다(사용자 명시 상태 우선). 활동이 재개되면 auto-away 로 전환됐던
// 경우에만 이전 상태로 복원한다. 자동 전환은 DB 에 저장하지 않고(ctx.state.isAutoAway
// 로만 추적) 피어에게만 브로드캐스트한다 — DB(profile.status_type)는 항상 "사용자가
// 마지막으로 명시한 상태"를 그대로 유지해, 재시작 후에도 auto-away 여부 판정 기준이
// 오염되지 않는다.

const { powerMonitor } = require('electron')
const { getProfile } = require('../storage/profile')
const { sendToRenderer, broadcastPeerMessage } = require('./appUtils')

const IDLE_THRESHOLD_SECONDS = 5 * 60 // 5분 유휴 시 자동 자리비움
const PRESENCE_CHECK_INTERVAL_MS = 15_000 // 15초 간격으로 유휴 시간 점검

// 순수 판정 함수 — 유휴 시간과 현재 상태로부터 전환 여부를 결정한다.
// 반환값: 전환이 필요하면 { statusType, isAutoAway }, 필요 없으면 null.
function decidePresenceTransition({ idleSeconds, manualStatusType, isAutoAway, idleThresholdSeconds = IDLE_THRESHOLD_SECONDS }) {
  const isIdle = idleSeconds >= idleThresholdSeconds

  if (isIdle && !isAutoAway) {
    // 유휴 진입 — 사용자가 online 상태일 때만 자동으로 away 전환한다.
    // busy/dnd/away 등 사용자가 명시적으로 설정한 상태는 덮어쓰지 않는다.
    if (manualStatusType !== 'online') return null
    return { statusType: 'away', isAutoAway: true }
  }

  if (!isIdle && isAutoAway) {
    // 활동 재개 — 자동으로 away 전환됐던 경우에만 이전 상태(manualStatusType)로 복원한다.
    return { statusType: manualStatusType, isAutoAway: false }
  }

  return null
}

let presenceIntervalHandle = null

// 주기적으로 시스템 유휴 시간을 점검해 자동 자리비움 전환/복원을 수행한다.
// 로그인 전(ctx.state.database 없음)에는 아무 것도 하지 않는다.
function startPresenceMonitor(ctx, intervalMs = PRESENCE_CHECK_INTERVAL_MS) {
  if (presenceIntervalHandle) clearInterval(presenceIntervalHandle)
  presenceIntervalHandle = setInterval(() => {
    if (!ctx.state.database || !ctx.state.peerId) return

    let idleSeconds
    try {
      idleSeconds = powerMonitor.getSystemIdleTime()
    } catch {
      return
    }

    const profile = getProfile(ctx.state.database)
    const manualStatusType = profile?.status_type || 'online'
    const manualStatusMessage = profile?.status_message || ''

    const transition = decidePresenceTransition({
      idleSeconds,
      manualStatusType,
      isAutoAway: ctx.state.isAutoAway,
    })
    if (!transition) return

    ctx.state.isAutoAway = transition.isAutoAway
    sendToRenderer(ctx, 'my-status-changed', { statusType: transition.statusType, statusMessage: manualStatusMessage })
    broadcastPeerMessage(ctx, {
      type: 'status-changed',
      fromId: ctx.state.peerId,
      statusType: transition.statusType,
      statusMessage: manualStatusMessage,
      timestamp: Date.now(),
    })
  }, intervalMs)
  if (presenceIntervalHandle.unref) presenceIntervalHandle.unref()
}

function stopPresenceMonitor() {
  if (presenceIntervalHandle) {
    clearInterval(presenceIntervalHandle)
    presenceIntervalHandle = null
  }
}

module.exports = {
  IDLE_THRESHOLD_SECONDS,
  PRESENCE_CHECK_INTERVAL_MS,
  decidePresenceTransition,
  startPresenceMonitor,
  stopPresenceMonitor,
}
