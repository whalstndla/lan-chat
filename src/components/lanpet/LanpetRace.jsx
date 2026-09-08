import React, { useEffect, useRef, useState } from 'react'
import LanpetScene from './LanpetScene'
import { DiceResult } from './LanpetWorld'
import { usePetClock } from './LanpetNotice'

const outcomes = { win: '먼저 도착했어요!', loss: '끝까지 멋지게 달렸어요!', draw: '사이좋게 비겼어요!' }

export function SessionExplanation({ session }) {
  const messages = {
    INVITE_RATE_LIMITED: '친구 기기에 재초대 대기시간이 남아 있어요. 이전 버전은 최초 초대 후 10분, 새 버전에서 취소·거절한 초대는 30초예요. 친구 카드에서 다음 초대 시간을 확인해 주세요.',
    NOT_ENOUGH_ENERGY: '활동에 필요한 에너지 6이 부족해요. 양쪽 펫에 먹이를 주거나 30분 낮잠으로 에너지를 회복해 주세요.',
    RACE_UPDATE_REQUIRED: '친구도 v0.15.0 이상으로 업데이트해야 같은 주사위 경주를 할 수 있어요.',
    declined: '친구가 초대를 거절했어요. 초대를 보낸 시점부터 30초 뒤 다시 초대할 수 있어요. 이전 버전 친구는 10분을 기다려요.',
    expired: '초대 수락 시간 2분 또는 활동 유지 시간 10분이 지났어요. 다음 초대 가능 시간이 지나면 새로 시작해 주세요.',
    canceled: '활동이 종료됐어요. 미완료 보상은 지급하지 않으며 예약한 에너지는 취소 결과가 확인되면 해제돼요.',
  }
  let message = messages[session.error] || messages[session.status]
  if (session.error && !messages[session.error]) message = '친구와 활동 상태를 맞추지 못했어요. 양쪽 앱의 연결·공개 설정과 펫 상태를 확인한 뒤 새 초대를 보내 주세요.'
  return message ? <p className="pet-limit-explanation" role="status">{message}</p> : null
}

export default function LanpetRace({ session, command, busy, interactionPaused }) {
  const container = useRef(null)
  const [ready, setReady] = useState(true)
  const now = usePetClock(session.serverNow)
  const active = session.status === 'inProgress'
  const seconds = Math.min(15, Math.max(0, Math.ceil((session.turnEndsAt - now) / 1000)))
  const canRoll = active && ready && !busy && !interactionPaused && !session.ownChoice && seconds > 0
  const modern = session.ruleVersion === 2
  const progress = session.raceProgress || {}
  const effect = session.lastRound ? { id: `${session.sessionId}:${session.lastRound.turn}`, kind: session.result ? 'win' : 'roll' } : null
  useEffect(() => { if (active) container.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }) }, [session.sessionId, active])
  useEffect(() => { if (session.turn <= 1) return undefined; setReady(false); const timer = setTimeout(() => setReady(true), 1100); return () => clearTimeout(timer) }, [session.sessionId, session.turn])
  return <article ref={container} className="lanpet-session pet-social-race">
    <div className="lanpet-session-heading"><div><span className="lanpet-eyebrow">주사위 친구 경주</span><h3>{session.peerName || '친구'} 님과 작은 모험</h3></div><span className="lanpet-badge">{active ? `${session.turn}/5턴 · ${seconds}초` : '경주 결과'}</span></div>
    {!modern && <p className="pet-limit-explanation">이전 버전에서 시작한 경주예요. 활동을 종료하고 양쪽 앱을 업데이트한 뒤 새 주사위 경주로 만나요.</p>}
    {modern && <><p className="lanpet-game-rules">매턴 주사위 1~6만큼 전진해요. 5턴 합계가 큰 펫이 이기고 같은 거리면 무승부예요. 15초 안에 누르지 않으면 자동으로 굴려요.</p>
      <LanpetScene mode="race" residents={[session.ownPet || { appearanceId: progress.ownAppearance }, session.peerPet || { appearanceId: progress.peerAppearance }]} distances={[progress.own || 0, progress.peer || 0]} die={session.lastRound?.ownScore} rolling={active && !!session.ownChoice} effect={effect} label="친구와 주사위 경주 3D 트랙" />
      <div className="pet-distance-bar"><span>내 펫 <b>{progress.own || 0}칸</b></span><span>{session.peerName || '친구 펫'} <b>{progress.peer || 0}칸</b></span></div>
      <DiceResult own={session.lastRound?.ownScore} peer={session.lastRound?.peerScore} />
      {active && <><button className="pet-dice-button" disabled={!canRoll} onClick={() => command({ type: 'action', sessionId: session.sessionId, choice: 'roll' })}><span aria-hidden="true">⚄</span>{session.ownChoice ? '친구의 주사위를 기다리는 중…' : '주사위 굴리기'}</button><p className="lanpet-secondary" role="status">{seconds === 0 ? '시간이 끝나 자동으로 굴리고 있어요. 결과를 기다려 주세요.' : '두 주사위가 확정되면 함께 전진해요. 한 턴에 한 번만 굴릴 수 있어요.'}</p></>}
      {session.lastRound?.automatic && <p className="lanpet-secondary">지난 턴에는 15초가 지나 내 주사위가 자동으로 굴려졌어요.</p>}
      {session.result && <div className="pet-prize" role="status"><strong>{outcomes[session.result.outcome] || '즐거운 경주였어요'}</strong><p>최종 이동 · {session.result.ownScore}칸 / {session.result.peerScore}칸</p><p>에너지 6 사용 · 코인은 최근 24시간 첫 세 번의 교류 완료에만 12개씩 받아요. 다음 경주도 바로 초대할 수 있어요.</p></div>}
    </>}
    <SessionExplanation session={session} />
    {session.settlementPending && <p className="pet-limit-explanation">내 기기에 결과를 저장했어요. 친구의 저장 확인을 기다리고 있어요.</p>}
    {['resultUnknown', 'reconciliationNeeded', 'preparing', 'keyChanged'].includes(session.status) && <p className="pet-limit-explanation">친구와 활동 상태를 확인하고 있어요. 양쪽 연결과 신원을 확인하면 저장된 결과를 다시 맞춰요.</p>}
    {active && <button className="lanpet-button is-quiet" disabled={busy} onClick={() => command({ type: 'end', sessionId: session.sessionId })}>활동 끝내기</button>}
  </article>
}
