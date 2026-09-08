import React, { useEffect, useState } from 'react'

export function usePetClock(serverNow) {
  const [clock, setClock] = useState(() => ({ received: Date.now(), server: serverNow || Date.now(), tick: Date.now() }))
  useEffect(() => { setClock({ received: Date.now(), server: serverNow || Date.now(), tick: Date.now() }) }, [serverNow])
  useEffect(() => { const timer = setInterval(() => setClock(value => ({ ...value, tick: Date.now() })), 1000); return () => clearInterval(timer) }, [])
  return clock.server + Math.max(0, clock.tick - clock.received)
}

export function remainingLabel(readyAt, now) {
  const seconds = Math.max(0, Math.ceil((readyAt - now) / 1000))
  if (seconds <= 0) return '지금 이용 가능'
  if (seconds < 60) return `${seconds}초 남음`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}분 ${seconds % 60}초 남음`
  return `${Math.floor(seconds / 3600)}시간 ${Math.ceil(seconds % 3600 / 60)}분 남음`
}

export function ReadyTime({ at, now, label = '다시 이용' }) {
  if (!at || at <= now) return null
  return <span className="pet-ready-time"><strong>{remainingLabel(at, now)}</strong><span>{label} · {new Date(at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></span>
}

export function Notice({ notice, now, onDismiss }) {
  if (!notice) return null
  const error = notice.kind === 'error' || !!notice.code
  return <div className={`pet-explained-notice ${error ? 'is-error' : 'is-success'}`} role={error ? 'alert' : 'status'}>
    <span className="pet-notice-symbol" aria-hidden="true">{error ? '!' : '✦'}</span>
    <div><strong>{notice.title || '잠깐 확인해 주세요'}</strong><p>{notice.message}</p>{notice.explanation && <p>{notice.explanation}</p>}<ReadyTime at={notice.retryAt} now={now} label={notice.readyLabel || '다시 이용'} /></div>
    {onDismiss && <button className="lanpet-icon-button" aria-label="알림 닫기" onClick={onDismiss}>×</button>}
  </div>
}

export function activityReason(snapshot, peer, activity, now) {
  if (!snapshot.enabled) return '랜펫을 켜면 다시 활동할 수 있어요.'
  if (!snapshot.sharingEnabled) return '내 펫 공개를 켜야 초대를 보낼 수 있어요.'
  if (!snapshot.isWorkingTime) return '월–금 09:00–18:00에 초대할 수 있어요.'
  if (snapshot.pet?.napEndsAt > now) return `낮잠 중 · ${remainingLabel(snapshot.pet.napEndsAt, now)}`
  if (!['active', 'visiting'].includes(snapshot.pet?.lifecycleState)) return '내 펫 화면에서 상태를 확인해 주세요.'
  if (snapshot.hasActiveSession) return '진행 중인 활동을 마치거나 초대를 취소해 주세요.'
  if (peer.inviteReadyAt > now) return `재초대 대기 · ${remainingLabel(peer.inviteReadyAt, now)}`
  if (['race', 'battle', 'cooperativePlay'].includes(activity) && snapshot.pet.energy - (snapshot.reservedEnergy || 0) < 6) return '에너지 6이 필요해요. 먹이를 주거나 30분 낮잠으로 회복해 주세요.'
  return ''
}

export function PeerLimit({ peer, now }) {
  return <div className="pet-limit-explanation"><p>{peer.inviteCooldownSeconds === 600 ? '이전 버전 친구: 활동 종류와 관계없이 최초 초대 후 10분 동안 재초대를 기다려요. 양쪽을 업데이트하면 완료 직후 다시 놀 수 있어요.' : '놀이를 완료하면 바로 다시 초대할 수 있어요. 취소·거절된 초대는 초대 시점부터 30초만 기다려요.'}</p><ReadyTime at={peer.inviteReadyAt} now={now} label="초대 가능" />{peer.supportsDice === false && <p>주사위 경주는 친구도 v0.15.0 이상으로 업데이트해야 해요.</p>}</div>
}

export function SocialRewardNotice({ world, now }) {
  if (!world) return null
  return <div className="pet-limit-explanation"><strong>놀이는 계속, 코인은 최근 24시간에 3번</strong><p>완료 시 12코인 · 오늘 받을 수 있는 횟수 {world.socialCoinsRemaining ?? 3}회. 이후에도 에너지가 있으면 계속 놀 수 있어요. 교류로 얻는 유대와 성장은 각각 최근 24시간에 최대 6점이에요.</p><ReadyTime at={world.socialCoinsReadyAt} now={now} label="코인 보상 1회 회복" /></div>
}
