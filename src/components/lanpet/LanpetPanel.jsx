import React, { useEffect, useRef, useState } from 'react'
import { ArrowRight, Check, Gift, History, Leaf, Moon, RefreshCw, Settings, Shield, Sparkles, Users, X } from 'lucide-react'
import LanpetAvatar from './LanpetAvatar'
import useLanpet from './useLanpet'
import { PetRoom, EvolutionTree, WorldShop, WorldGames } from './LanpetWorld'
import './LanpetWorld.css'
import LanpetScene from './LanpetScene'
import LanpetRace, { SessionExplanation } from './LanpetRace'
import { Notice, PeerLimit, ReadyTime, SocialRewardNotice, activityReason, usePetClock } from './LanpetNotice'

const activityLabels = { visit: '방문하기', cooperativePlay: '함께 놀기', gift: '기념품 보내기', battle: '친선 배틀', race: '친구와 경주' }
const activityDescriptions = { visit: '친구에게 들러 가볍게 인사해요.', cooperativePlay: '협동 놀이와 친구 경주를 허용해요.', gift: '친구에게 추억이 담긴 기념품을 선물해요.', battle: '다섯 판의 친선 대결이에요. 펫이나 아이템을 잃지 않아요.' }
activityDescriptions.race = '주사위를 굴려 다섯 턴 동안 전진해요. 한 턴에 15초, 에너지 6이 필요해요.'
const activitySettings = { visit: 'allowVisit', cooperativePlay: 'allowCooperativePlay', gift: 'allowGift', battle: 'allowBattle' }
const statusLabels = { outgoingPending: '수락 대기', incomingPending: '초대 도착', preparing: '준비 중', inProgress: '진행 중', resultUnknown: '결과 확인 대기', completed: '완료', declined: '거절됨', canceled: '종료됨', aborted: '중단됨', expired: '만료됨', reconciliationNeeded: '재연결 필요', keyChanged: '신원 확인 필요' }
const outcomeLabels = { win: '이겼어요!', loss: '멋진 대결이었어요!', draw: '사이좋게 비겼어요', completed: '함께한 추억이 생겼어요' }
const choiceLabels = { focus: '집중', guard: '방어', spark: '불꽃' }
const temperamentLabels = { calm: '차분한 성격', active: '활발한 성격', balanced: '온화한 성격', social: '다정한 성격' }
const memoryLabels = { 'pet.created': '새 친구가 찾아왔어요', 'pet.grown': '한 뼘 더 자랐어요', 'care.care': '정성껏 돌봤어요', 'care.tidy': '깨끗하게 정리했어요', 'care.play': '즐겁게 놀았어요', 'care.rest': '포근한 낮잠을 잤어요', 'care.welcomeBack': '다시 만나 반가워요' }
const careActions = [{ action: 'care', label: '돌보기', symbol: '♡' }, { action: 'tidy', label: '정리하기', symbol: '✧' }, { action: 'play', label: '놀아주기', symbol: '♫' }, { action: 'rest', label: '쉬기', symbol: '☾' }]

function growthLabel(choice) {
  if (choice.label) return choice.label
  const familyLabels = { calm: '버들', active: '햇살', balanced: '이끼', social: '별빛' }
  const prefix = familyLabels[choice.family] || '이끼'
  const form = choice.appearanceId?.endsWith('-b') ? '클로버' : prefix
  return `${form} ${choice.stage === 'grown' ? '지킴이' : '새싹'}`
}

function choiceLabel(value) {
  if (value === 'rest') return '쉬기'
  return choiceLabels[value] || '선택 없음'
}

function timeLabel(value) {
  const date = new Date(value)
  if (!value || Number.isNaN(date.getTime())) return ''
  const period = date.getHours() < 12 ? '오전' : '오후'
  const hour = date.getHours() % 12 || 12
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${date.getMonth() + 1}월 ${date.getDate()}일 ${period} ${hour}:${minute}`
}

function OfficeHours({ snapshot }) {
  const hours = snapshot.workHours || { startHour: 9, endHour: 18 }
  const start = String(hours.startHour).padStart(2, '0')
  const end = String(hours.endHour).padStart(2, '0')
  return <div className="lanpet-office-note"><Moon size={15} aria-hidden="true" /><span>월–금 {start}:00–{end}:00 · 업무시간 밖에는 펫이 편안히 쉬어요.</span></div>
}

function NapNotice({ pet }) {
  if (!pet?.napEndsAt) return null
  return <p className="lanpet-notice" role="status">업무시간 기준 30분 동안 낮잠을 자고 있어요. {timeLabel(pet.napEndsAt)}쯤 일어나면 다시 돌보고 놀아줄 수 있어요.</p>
}

function Onboarding({ snapshot, command, busy }) {
  const [step, setStep] = useState(0)
  const [name, setName] = useState('이끼')
  const [share, setShare] = useState(false)
  const inputReference = useRef(null)
  useEffect(() => { if (step === 1) inputReference.current?.focus() }, [step])

  const create = async (event) => {
    event.preventDefault()
    if (!name.trim() || busy) return
    if (step < 2) return setStep(step + 1)
    const created = await command({ type: 'create', name: name.trim() })
    if (created && share) await command({ type: 'settings', sharingEnabled: true })
  }

  return <form className="lanpet-onboarding" onSubmit={create}>
    <div className="lanpet-step-indicator" aria-label={`전체 3단계 중 ${step + 1}단계`}>{[0, 1, 2].map(index => <span key={index} data-current={index <= step} />)}</div>
    <div className="lanpet-onboarding-art"><LanpetAvatar stage="seed" /></div>
    {step === 0 && <>
      <span className="lanpet-eyebrow">가까이에서 함께하는 작은 친구</span>
      <h2>작은 친구를 맞이해 보세요.</h2>
      <p>씨앗에서 새싹으로, 새싹에서 든든한 친구로. 잠깐씩 정성을 나누면 랜펫이 자라요. 같은 네트워크의 동료들과 함께 놀 수도 있어요.</p>
      <div className="lanpet-onboarding-facts"><span><Leaf size={16} /> 정성으로 자라요</span><span><Shield size={16} /> 처음에는 비공개예요</span></div>
    </>}
    {step === 1 && <>
      <span className="lanpet-eyebrow">우리 친구만의 이름</span>
      <h2>어떤 이름으로 불러줄까요?</h2>
      <label className="lanpet-field">펫 이름<input ref={inputReference} value={name} onChange={event => setName(event.target.value)} maxLength={24} required autoComplete="off" /></label>
      <p>펫은 오롯이 나만의 친구예요. 채팅 내용이나 메시지 수는 먹이·점수·훈련에 사용하지 않아요.</p>
    </>}
    {step === 2 && <>
      <span className="lanpet-eyebrow">나만의 속도로 천천히</span>
      <h2>잠깐의 돌봄, 넉넉한 여유.</h2>
      <OfficeHours snapshot={snapshot} />
      <p>자리를 비운 동안에는 펫도 쉬어요. 연속 접속이나 끊임없는 채팅을 요구하지 않아요.</p>
      <label className="lanpet-checkbox"><input type="checkbox" checked={share} onChange={event => setShare(event.target.checked)} /><span><strong>주변 친구에게 내 펫 공개하기</strong><small>다른 랜챗 사용자가 내 펫을 보고 놀이에 초대할 수 있어요. 언제든 바꿀 수 있어요.</small></span></label>
    </>}
    <div className="lanpet-onboarding-actions">
      {step > 0 && <button type="button" className="lanpet-button" disabled={busy} onClick={() => setStep(step - 1)}>이전</button>}
      <button type="submit" className="lanpet-button is-primary" disabled={busy || !name.trim()}>{step === 2 ? '친구 맞이하기' : '다음'}<ArrowRight size={16} /></button>
    </div>
  </form>
}

function Meter({ label, value }) {
  const safeValue = Math.max(0, Math.min(100, Number(value) || 0))
  return <div className="lanpet-meter"><div><span>{label}</span><span>{Math.round(safeValue)}<small>/100</small></span></div><meter aria-label={label} min="0" max="100" value={safeValue} /></div>
}

function PetHome({ snapshot, command, busy, effect }) {
  const now = usePetClock(snapshot.serverNow)
  const pet = snapshot.pet
  const resting = ['resting', 'restingAway'].includes(pet.lifecycleState) || !snapshot.isWorkingTime
  const canCare = snapshot.enabled && snapshot.isWorkingTime && pet.lifecycleState === 'active'
  const growthChoices = pet.growthChoices || []
  return <>
    <div className="lanpet-home-layout">
      <section className="lanpet-pocket" aria-label={`${pet.name}의 작은 정원`}>
        <div className="lanpet-pocket-label"><span>랜펫 / 01</span><span className="lanpet-lamp">{resting ? '쉬는 중' : '집에 있어요'}</span></div>
        <PetRoom pet={pet} room={snapshot.world?.room} resting={resting} effect={effect} roaming />
        <div className="lanpet-pocket-caption"><div><h2>{pet.name}</h2><span>{{ seed: '씨앗', young: '새싹', grown: '동반자' }[pet.stage] || '작은 친구'} · {temperamentLabels[pet.temperament] || '호기심 많은 친구'}</span></div><span className="lanpet-generation">하나뿐인<br />내 친구</span></div>
      </section>
      <section className="lanpet-care-panel" aria-labelledby="lanpet-care-title">
        <span className="lanpet-eyebrow">매일의 작은 순간</span><h2 id="lanpet-care-title">작은 관심으로 함께 자라요.</h2>
        <p className="lanpet-secondary">돌봄과 놀이, 함께한 추억이 우리 친구를 만들어 가요.</p>
        <div className="lanpet-meters"><Meter label="돌봄" value={pet.care} /><Meter label="즐거움" value={pet.joy} /><Meter label="에너지" value={pet.energy} /><Meter label="유대감" value={pet.bond} /></div>
        <div className="lanpet-care-actions">{careActions.map(action => <button key={action.action} className="lanpet-care-button" disabled={busy || !canCare} onClick={() => command({ type: 'care', action: action.action })}><span aria-hidden="true">{action.symbol}</span>{action.label}</button>)}</div>
        {pet.lifecycleState === 'restingAway' && <button className="lanpet-button lanpet-welcome" disabled={busy || !snapshot.enabled || !snapshot.isWorkingTime} onClick={() => command({ type: 'care', action: 'welcomeBack' })}><Leaf size={16} /> 다시 만나기</button>}
        <NapNotice pet={pet} />
        <div className="pet-limit-explanation"><p>돌보기 에너지 −5 · 정리 −3 · 놀아주기 −8. 같은 돌봄을 30분 안에 반복하면 효과가 25%예요. 쉬기는 업무시간 30분 낮잠이에요.</p>{careActions.filter(action => snapshot.careRepeatReadyAt?.[action.action] > now).map(action => <ReadyTime key={action.action} at={snapshot.careRepeatReadyAt[action.action]} now={now} label={`${action.label} 온전한 효과`} />)}</div>
        {!snapshot.isWorkingTime && <p className="lanpet-secondary">업무시간에 다시 돌볼 수 있어요. 지금까지의 성장은 그대로 간직해요.</p>}
        {['ownerConflict', 'recovering'].includes(pet.lifecycleState) && <p className="lanpet-notice">다시 놀기 전에 펫 상태를 복구해야 해요. {pet.lifecycleState === 'ownerConflict' ? '펫의 소유 정보를 확인해 주세요.' : '복구가 끝날 때까지 잠시 기다려 주세요.'}</p>}
      </section>
    </div>
    <OfficeHours snapshot={snapshot} />
    {snapshot.world && <EvolutionTree pet={pet} species={snapshot.world.species} />}
    <section className="lanpet-growth" aria-label="성장">
      <div><span className="lanpet-eyebrow">나만의 속도로 자라요</span><h3>{growthChoices.length ? '새로운 모습으로 자랄 준비가 됐어요.' : '작은 순간들이 모여 쑥쑥 자라요.'}</h3><p>성장 점수 {Number(pet.growthPoints) || 0} · 서두르지 않아도 괜찮아요.</p></div>
      {growthChoices.length > 0 && <div className="lanpet-growth-choices">{growthChoices.map(choice => {
        const choiceId = typeof choice === 'string' ? choice : choice.choiceId || choice.id
        const label = typeof choice === 'string' ? '새로운 친구' : growthLabel(choice)
        return <button key={choiceId} className="lanpet-growth-choice" disabled={busy || !canCare} onClick={() => command({ type: 'grow', choiceId })}><LanpetAvatar stage={choice.stage} appearanceId={choice.appearanceId} small /><span>{label} 모습으로 성장하기</span></button>
      })}</div>}
    </section>
  </>
}

function peerStatus(peer, blocked = false) {
  if (blocked) return { label: '초대 차단됨', hint: '다시 함께 놀고 싶을 때 초대 차단을 해제해 주세요.', disabled: true }
  if (peer.pendingKeyChange) return { label: '신원 확인 필요', hint: '펫을 공개하기 전에 랜챗에서 이 친구의 신원을 확인해 주세요.', disabled: true }
  if (!peer.online) return { label: '접속하지 않음', hint: '친구가 같은 로컬 네트워크에 접속해야 해요.', disabled: true }
  if (!peer.supported) return { label: '업데이트 필요', hint: '친구의 랜챗을 랜펫 지원 버전으로 업데이트해야 해요.', disabled: true }
  if (!peer.available) return { label: '지금은 함께 놀 수 없어요', hint: '친구가 쉬고 있거나 펫을 비공개로 설정했을 수 있어요.', disabled: true }
  return { label: '함께 놀 수 있어요', hint: '', disabled: false }
}

export function Invitation({ invitation, command, busy, interactionPaused }) {
  const incoming = invitation.direction === 'incoming'
  return <article className="lanpet-invitation"><div><span className="lanpet-eyebrow">{incoming ? '초대가 도착했어요' : '초대를 보냈어요'}</span><h3>{activityLabels[invitation.activity] || '놀이'} · {invitation.peerName || '주변 친구'}</h3><p>{incoming ? '함께하고 싶을 때 참여해 주세요.' : '친구의 답을 기다리고 있어요.'} {invitation.expiresAt && `${timeLabel(invitation.expiresAt)}까지 수락할 수 있어요.`}</p></div><div className="lanpet-action-row">{incoming && <><button className="lanpet-button is-primary" disabled={busy || interactionPaused} onClick={() => command({ type: 'respond', sessionId: invitation.sessionId, response: 'accept' })}><Check size={15} />수락</button><button className="lanpet-button" disabled={busy} onClick={() => command({ type: 'respond', sessionId: invitation.sessionId, response: 'decline' })}>거절</button></>}{!incoming && <button className="lanpet-button" disabled={busy} onClick={() => command({ type: 'end', sessionId: invitation.sessionId })}>초대 취소</button>}</div></article>
}

export function Session({ session, command, busy, interactionPaused }) {
  const now = usePetClock(session.serverNow)
  const active = session.status === 'inProgress'
  const interactive = ['battle', 'cooperativePlay'].includes(session.activity)
  const timed = session.activity === 'battle'
  const moves = choiceLabels
  const moveLabel = value => moves[value] || choiceLabel(value)
  const totalTurns = session.totalTurns || (session.activity === 'battle' ? 5 : 3)
  const secondsRemaining = Math.min(15, Math.max(0, Math.ceil((Number(session.turnEndsAt) - now) / 1000)))
  const turnExpired = timed && Number.isFinite(secondsRemaining) && secondsRemaining === 0
  const canChoose = active && !interactionPaused && !session.ownChoice && !session.waitingForPeer && !turnExpired
  let visitActionLabel = '친구를 기다리는 중…'
  if (canChoose) visitActionLabel = '방문 마치기'
  if (interactionPaused) visitActionLabel = '놀이가 일시 중지됐어요'
  if (session.activity === 'race') return <LanpetRace session={session} command={command} busy={busy} interactionPaused={interactionPaused} />
  return <article className="lanpet-session">
    <div className="lanpet-session-heading"><div><span className="lanpet-eyebrow">{activityLabels[session.activity] || '함께하는 시간'}</span><h3>{session.peerName || '친구'} 님과 함께</h3></div><span className="lanpet-badge">{statusLabels[session.status] || '상태 확인 중'}</span></div>
    {(active || session.result) && session.activity !== 'gift' && <LanpetScene residents={[session.ownPet || {}, session.peerPet || {}]} roaming={!interactionPaused} effect={session.lastRound ? { id: `${session.sessionId}:${session.lastRound.turn}`, kind: session.activity } : null} label="친구와 함께 노는 입체 장면" />}
    {active && interactive && <>
      {session.activity !== 'race' && <p className="lanpet-game-rules">{session.activity === 'battle' ? '집중은 불꽃을, 불꽃은 방어를, 방어는 집중을 이겨요. 한 판에 15초씩 총 다섯 판을 진행해요. 선택하지 않으면 쉬기로 처리돼요.' : '총 세 판 동안 친구와 함께 빛을 골라요. 어떤 조합이든 괜찮아요. 틀린 답은 없어요.'}</p>}
      <div className="lanpet-game-progress"><span>{totalTurns}판 중 {session.turn || 1}판</span><span>{session.ownChoice ? `내 선택: ${moveLabel(session.ownChoice)}` : '행동을 골라 주세요'}</span>{timed && Number.isFinite(secondsRemaining) && <span>{secondsRemaining}초</span>}</div>
      <div className="lanpet-move-grid">{Object.entries(moves).map(([choice, label]) => <button key={choice} className={`lanpet-move ${session.ownChoice === choice ? 'is-selected' : ''}`} disabled={busy || !canChoose} onClick={() => command({ type: 'action', sessionId: session.sessionId, choice })}><span aria-hidden="true">{{ focus: '◎', guard: '◇', spark: '✦' }[choice]}</span>{label}</button>)}</div>
      {(session.ownChoice || session.waitingForPeer) && <p role="status" className="lanpet-secondary">선택을 보냈어요. 친구를 기다리고 있어요…</p>}
      {turnExpired && !session.ownChoice && <p role="status" className="lanpet-secondary">시간이 끝났어요. 이번 판의 결과를 기다리고 있어요…</p>}
      {session.lastRound && <p className="lanpet-round-result">지난 판: {moveLabel(session.lastRound.ownChoice)} / {moveLabel(session.lastRound.peerChoice)} · {session.lastRound.ownScore}–{session.lastRound.peerScore}</p>}
    </>}
    {active && session.activity === 'visit' && <div className="lanpet-visit"><LanpetAvatar small stage="sprout" /><p>잠깐 함께하는 것만으로도 좋은 하루가 돼요.</p><button className="lanpet-button is-primary" disabled={busy || !canChoose} onClick={() => command({ type: 'action', sessionId: session.sessionId, choice: 'focus' })}>{visitActionLabel}</button></div>}
    {session.result && <div className="lanpet-result"><Sparkles size={19} /><div><strong>{outcomeLabels[session.result.outcome] || '함께한 추억이 생겼어요'}</strong>{timed && <p>최종 점수 · {session.result.ownScore}–{session.result.peerScore}</p>}<p>내 펫과 아이템은 그대로 간직해요.</p></div></div>}
    <SessionExplanation session={session} />
    {session.settlementPending && <p className="lanpet-notice">결과를 내 기기에 저장했어요. 친구의 확인을 기다리고 있어요.</p>}
    {['resultUnknown', 'reconciliationNeeded', 'keyChanged'].includes(session.status) && <p className="lanpet-notice">아직 결과가 확인되지 않았어요. 친구와 다시 연결하면 활동을 복구할 수 있어요. 확인되지 않은 결과를 임의로 적용하지 않아요.</p>}
    {active && <button className="lanpet-button is-quiet" disabled={busy} onClick={() => command({ type: 'end', sessionId: session.sessionId })}>활동 끝내기</button>}
  </article>
}

function Friends({ snapshot, command, busy }) {
  const now = usePetClock(snapshot.serverNow)
  const peers = snapshot.peers || []
  const activeSessions = (snapshot.sessions || []).filter(session => ['inProgress', 'preparing', 'resultUnknown', 'reconciliationNeeded'].includes(session.status))
  const visibleSessions = activeSessions.length ? activeSessions : (snapshot.sessions || []).slice(0, 1)
  const interactionPaused = !snapshot.enabled || !snapshot.sharingEnabled || !snapshot.isWorkingTime || Boolean(snapshot.pet?.napEndsAt) || !['active', 'visiting'].includes(snapshot.pet?.lifecycleState)
  return <div className="lanpet-section-stack">
    <div className="lanpet-section-heading"><div><span className="lanpet-eyebrow">가까이에 있는 우리 친구들</span><h2>함께라서 더 즐거워요.</h2><p>같은 네트워크에 있는 동료들의 펫을 만나 보세요.</p></div><span className="lanpet-badge">{peers.filter(peer => peer.available).length}명과 함께 놀 수 있어요</span></div>
    {!snapshot.sharingEnabled && <div className="lanpet-notice"><Shield size={18} /><div><strong>내 펫은 비공개 상태예요.</strong><p>펫 공개를 켜면 초대를 주고받을 수 있어요. 이 설정은 랜펫에만 적용돼요.</p><button className="lanpet-button" disabled={busy} onClick={() => command({ type: 'settings', sharingEnabled: true })}>펫 공개 켜기</button></div></div>}
    <NapNotice pet={snapshot.pet} />
    {!snapshot.isWorkingTime && <p className="lanpet-notice">업무시간이 되면 친구들과 다시 놀 수 있어요.</p>}
    {snapshot.pet?.lifecycleState === 'restingAway' && <p className="lanpet-notice">함께 놀기 전에 내 펫 화면에서 다시 만나기를 눌러 주세요.</p>}
    {(snapshot.invitations || []).map(invitation => <Invitation key={invitation.sessionId} invitation={invitation} command={command} busy={busy} interactionPaused={interactionPaused} />)}
    {visibleSessions.map(session => <Session key={session.sessionId} session={session} command={command} busy={busy} interactionPaused={interactionPaused} />)}
    <SocialRewardNotice world={snapshot.world} now={now} />
    {!peers.length && <div className="lanpet-empty"><Users size={28} /><h3>아직 주변에 친구가 없어요.</h3><p>랜챗이 같은 네트워크의 친구를 찾으면 여기에 표시돼요. 서로 랜펫을 지원하는 앱을 사용하고 펫 공개와 신뢰 연결을 켜야 해요.</p></div>}
    <div className="lanpet-peer-grid">{peers.map(peer => {
      const blockedPeerIds = snapshot.blockedPeerIds || []
      const blocked = blockedPeerIds.includes(peer.peerId) || peer.blocked === true
      const status = peerStatus(peer, blocked)
      const nextBlockedPeerIds = blocked ? blockedPeerIds.filter(peerId => peerId !== peer.peerId) : [...blockedPeerIds, peer.peerId]
      const reason = activityReason(snapshot, peer, 'cooperativePlay', now)
      return <article className="lanpet-peer" key={peer.peerId}><div className="lanpet-peer-heading"><div className="lanpet-peer-avatar"><LanpetAvatar stage={peer.stage} appearanceId={peer.appearanceId} small resting={!peer.available} /></div><div><h3>{peer.petName || peer.name || '주변 친구'}</h3><p>{peer.petName && peer.name}</p><span className={`lanpet-peer-status ${status.disabled ? '' : 'is-ready'}`}>{status.label}</span></div></div>{status.hint && <p className="lanpet-secondary">{status.hint}</p>}<div className="lanpet-peer-actions">{Object.entries(activityLabels).map(([activity, label]) => <button key={activity} className="lanpet-button" title={activityReason(snapshot, peer, activity, now) || activityDescriptions[activity]} disabled={busy || interactionPaused || status.disabled || !!activityReason(snapshot, peer, activity, now) || snapshot[activitySettings[activity] || 'allowCooperativePlay'] === false || !peer.activities?.includes(activity)} onClick={() => command({ type: 'invite', peerId: peer.peerId, activity })}>{label}</button>)}</div>{reason && <p className="lanpet-secondary">{reason}</p>}<PeerLimit peer={peer} now={now} /><button className="lanpet-button is-quiet lanpet-peer-block" disabled={busy} onClick={() => command({ type: 'settings', blockedPeerIds: nextBlockedPeerIds })}>{blocked ? '초대 차단 해제' : '초대 차단'}</button></article>
    })}</div>
  </div>
}

function Journal({ snapshot }) {
  const memories = snapshot.history || []
  const detailedSessionIds = new Set(memories.filter(event => event.activity && event.sessionId).map(event => event.sessionId))
  // 같은 교류의 보상 이벤트와 세션 결과가 함께 오면 친구 정보가 있는 결과 한 건만 보여준다.
  const history = memories.filter(event => !(event.type?.startsWith('social.') && detailedSessionIds.has(event.sessionId)))
  const inventory = snapshot.inventory || []
  return <div className="lanpet-section-stack"><div className="lanpet-section-heading"><div><span className="lanpet-eyebrow">간직하고 싶은 작은 순간</span><h2>우리의 추억 일지.</h2><p>함께한 순간과 기념품을 펫의 추억으로 간직해요.</p></div><History size={24} /></div><section><h3 className="lanpet-subheading">기념품 <span>{inventory.length}</span></h3>{inventory.length ? <div className="lanpet-keepsakes">{inventory.map((item, index) => <article key={item.itemType || index}><Gift size={22} /><strong>{item.itemType === 'friendshipStar' ? '우정의 별' : '우정의 기념품'}</strong><span>{item.quantity ? `×${item.quantity}` : '함께한 추억'}</span></article>)}</div> : <p className="lanpet-empty-note">첫 번째 기념품에 담길 이야기를 기다리고 있어요.</p>}</section><section><h3 className="lanpet-subheading">추억 <span>{history.length}</span></h3>{history.length ? <ol className="lanpet-timeline">{history.map((event, index) => {
    const activity = event.activity || event.type?.replace(/^social\./, '')
    const outcome = event.result?.outcome || event.payload?.outcome
    const detail = outcomeLabels[outcome] || statusLabels[event.status]
    return <li key={event.eventId || event.sessionId || event.id || index}><span className="lanpet-timeline-dot" /><div><strong>{activityLabels[activity] || memoryLabels[event.type] || '소중한 순간'}{event.peerName ? ` · ${event.peerName} 님과 함께` : ''}</strong>{detail && <p>{detail}</p>}<time>{timeLabel(event.completedAt || event.endedAt || event.startedAt || event.createdAt)}</time></div></li>
  })}</ol> : <p className="lanpet-empty-note">친구를 방문하거나 놀이를 마치면 추억이 쌓여요.</p>}</section></div>
}

function Preferences({ snapshot, command, busy, onDeleted }) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  return <div className="lanpet-section-stack"><div className="lanpet-section-heading"><div><span className="lanpet-eyebrow">나에게 편안한 공간으로</span><h2>내 펫, 나만의 속도로.</h2></div><Settings size={24} /></div><label className="lanpet-checkbox"><input type="checkbox" checked={snapshot.enabled} disabled={busy} onChange={event => command({ type: 'settings', enabled: event.target.checked })} /><span><strong>랜펫 사용하기</strong><small>쉬고 싶을 때는 펫의 성장과 교류를 잠시 멈출 수 있어요.</small></span></label><label className="lanpet-checkbox"><input type="checkbox" checked={snapshot.sharingEnabled} disabled={busy || !snapshot.enabled} onChange={event => command({ type: 'settings', sharingEnabled: event.target.checked })} /><span><strong>주변 친구에게 내 펫 공개하기</strong><small>친구가 내 펫을 보고 초대를 보낼 수 있어요. 공개를 꺼도 펫은 삭제되지 않아요.</small></span></label><section><h3 className="lanpet-subheading">원하는 활동을 골라요</h3><p className="lanpet-secondary">친구들과 함께하고 싶은 활동을 선택해 주세요.</p><div className="lanpet-activity-settings">{Object.entries(activitySettings).map(([activity, setting]) => <label key={setting} className="lanpet-checkbox"><input type="checkbox" checked={snapshot[setting] !== false} disabled={busy || !snapshot.enabled} onChange={event => command({ type: 'settings', [setting]: event.target.checked })} /><span><strong>{activityLabels[activity]}</strong><small>{activityDescriptions[activity]}</small></span></label>)}</div></section><section className="lanpet-settings-note"><h3>편안히 쉴 수 있어요.</h3><OfficeHours snapshot={snapshot} /><p>채팅을 많이 해도 펫 점수가 추가되지 않아요. 돌봄과 교류는 내가 원할 때 직접 선택해요.</p></section><section className="lanpet-delete-section"><h3>이 펫과 작별하기</h3><p>펫과 성장 기록, 기념품을 삭제해요. 코인·구매한 아이템·방 꾸미기·보상 수령 이력은 계정에 남아요. 삭제한 내용은 되돌릴 수 없어요. 친구 기기에 이미 저장된 추억은 남을 수 있어요.</p>{!confirmDelete && <button className="lanpet-button is-danger" disabled={busy} onClick={() => setConfirmDelete(true)}>펫 삭제…</button>}{confirmDelete && <div className="lanpet-delete-confirm" role="group" aria-label="펫 삭제 확인"><strong>{snapshot.pet.name} 펫과 이 기기에 저장된 추억을 삭제할까요?</strong><div className="lanpet-action-row"><button className="lanpet-button" disabled={busy} onClick={() => setConfirmDelete(false)}>내 펫 간직하기</button><button className="lanpet-button is-danger" disabled={busy} onClick={async () => { if (await command({ type: 'delete' })) onDeleted() }}>영구 삭제</button></div></div>}</section></div>
}

export default function LanpetPanel({ onClose, initialTab = 'home' }) {
  const { snapshot, loading, busy, error, notice, effect, dismissNotice, command, refresh, retry } = useLanpet()
  const now = usePetClock(snapshot?.serverNow)
  const [tab, setTab] = useState(initialTab)
  const dialogReference = useRef(null)

  useEffect(() => {
    const dialog = dialogReference.current
    if (dialog.showModal) dialog.showModal()
    else dialog.setAttribute('open', '')
    return () => { if (dialog.open && dialog.close) dialog.close() }
  }, [])

  const tabs = [{ id: 'home', label: '내 펫', icon: Leaf }, { id: 'friends', label: '친구', icon: Users }, { id: 'shop', label: '상점·꾸미기', icon: Gift }, { id: 'games', label: '놀이터', icon: Sparkles }, { id: 'journal', label: '추억', icon: History }, { id: 'settings', label: '설정', icon: Settings }]
  const invitationCount = (snapshot?.invitations || []).filter(invitation => invitation.direction === 'incoming').length

  return <dialog ref={dialogReference} className="lanpet-dialog" aria-labelledby="lanpet-title" onCancel={event => { event.preventDefault(); onClose() }}>
    <header className="lanpet-header"><div className="lanpet-wordmark"><span className="lanpet-brand-icon"><Leaf size={20} /></span><div><h1 id="lanpet-title">랜펫<span>내 곁의 작은 친구</span></h1></div></div><div className="lanpet-header-actions"><span className="lanpet-local-label"><span />로컬 전용</span><button type="button" className="lanpet-icon-button" aria-label="랜펫 닫기" onClick={onClose} autoFocus><X size={20} /></button></div></header>
    {snapshot?.pet && <nav className="lanpet-tabs" aria-label="랜펫 메뉴">{tabs.map(item => <button key={item.id} type="button" className={tab === item.id ? 'is-active' : ''} aria-current={tab === item.id ? 'page' : undefined} onClick={() => setTab(item.id)}><item.icon size={16} /><span>{item.label}</span>{item.id === 'friends' && invitationCount > 0 && <span className="lanpet-count">{invitationCount}</span>}</button>)}</nav>}
    <div className="lanpet-content" aria-busy={busy || loading}>
      <Notice notice={error || snapshot?.error || notice} now={now} onDismiss={dismissNotice} />
      {error && <button className="lanpet-button" disabled={busy || loading || error.retryAt > now} onClick={retry}><RefreshCw size={15} />다시 시도</button>}
      {loading && !snapshot && <div className="lanpet-empty" role="status"><Leaf size={28} /><p>작은 친구의 공간을 여는 중…</p></div>}
      {snapshot && !snapshot.pet && !snapshot.error && <Onboarding snapshot={snapshot} command={command} busy={busy} />}
      {snapshot?.pet && <>
        {!snapshot.enabled && <div className="lanpet-notice"><Moon size={19} /><div><strong>랜펫이 일시 중지됐어요.</strong><p>펫이 조용히 쉬고 있어요.</p><button className="lanpet-button" disabled={busy} onClick={() => command({ type: 'settings', enabled: true })}>랜펫 다시 시작</button></div></div>}
        {tab === 'home' && <PetHome snapshot={snapshot} command={command} busy={busy} effect={effect} />}
        {tab === 'friends' && <Friends snapshot={snapshot} command={command} busy={busy} />}
        {tab === 'shop' && <WorldShop snapshot={snapshot} command={command} busy={busy} effect={effect} />}
        {tab === 'games' && <WorldGames snapshot={snapshot} command={command} busy={busy} effect={effect} />}
        {tab === 'journal' && <Journal snapshot={snapshot} />}
        {tab === 'settings' && <Preferences snapshot={snapshot} command={command} busy={busy} onDeleted={() => setTab('home')} />}
      </>}
      {snapshot?.pet && tab === 'friends' && <button className="lanpet-button is-quiet lanpet-refresh" disabled={loading || busy} onClick={refresh}><RefreshCw size={14} />주변 친구 새로고침</button>}
    </div>
    <footer className="lanpet-footer"><span>{busy ? '우리의 순간을 저장하는 중…' : '작은 순간을 함께하는 좋은 친구.'}</span><span>랜챗 × 랜펫</span></footer>
  </dialog>
}
