import React, { useEffect, useRef, useState } from 'react'
import { ArrowRight, Check, Gift, History, Leaf, Moon, RefreshCw, Settings, Shield, Sparkles, Users, X } from 'lucide-react'
import LanpetAvatar from './LanpetAvatar'
import useLanpet from './useLanpet'

const activityLabels = { visit: 'Visit', cooperativePlay: 'Team play', gift: 'Send keepsake', battle: 'Friendly battle' }
const activityDescriptions = { visit: 'Drop by for a small hello.', cooperativePlay: 'Three little challenges, together.', gift: 'Give your friend a keepsake.', battle: 'Five rounds. No lost pets or items.' }
const activitySettings = { visit: 'allowVisit', cooperativePlay: 'allowCooperativePlay', gift: 'allowGift', battle: 'allowBattle' }
const statusLabels = { inProgress: 'In progress', resultUnknown: 'Waiting to confirm', completed: 'Completed', declined: 'Declined', canceled: 'Ended', expired: 'Expired', reconciliationNeeded: 'Needs reconnection', keyChanged: 'Identity check needed' }
const outcomeLabels = { win: 'You won!', loss: 'A good match!', draw: 'A friendly draw', completed: 'A moment to remember' }
const choiceLabels = { focus: 'Focus', guard: 'Guard', spark: 'Spark' }
const memoryLabels = { 'pet.created': 'A new friend arrived', 'pet.grown': 'A new chapter', 'care.care': 'A little care', 'care.tidy': 'Freshened up', 'care.play': 'Playtime', 'care.rest': 'A quiet nap', 'care.welcomeBack': 'Welcome home again' }
const careActions = [{ action: 'care', label: 'Care', symbol: '♡' }, { action: 'tidy', label: 'Tidy', symbol: '✧' }, { action: 'play', label: 'Play', symbol: '♫' }, { action: 'rest', label: 'Rest', symbol: '☾' }]

function growthLabel(choice) {
  const familyLabels = { calm: 'Willow', active: 'Sunny', balanced: 'Moss', social: 'Star' }
  const prefix = familyLabels[choice.family] || 'Moss'
  const form = choice.appearanceId?.endsWith('-b') ? 'Clover' : prefix
  return `${form} ${choice.stage === 'grown' ? 'keeper' : 'sprout'}`
}

function readableLabel(value) {
  return String(value || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ')
}

function timeLabel(value) {
  const date = new Date(value)
  if (!value || Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function OfficeHours({ snapshot }) {
  const hours = snapshot.workHours || { startHour: 9, endHour: 18 }
  const start = String(hours.startHour).padStart(2, '0')
  const end = String(hours.endHour).padStart(2, '0')
  return <div className="lanpet-office-note"><Moon size={15} aria-hidden="true" /><span>Mon–Fri, {start}:00–{end}:00 · Outside these hours, your pet rests safely.</span></div>
}

function NapNotice({ pet }) {
  if (!pet?.napEndsAt) return null
  return <p className="lanpet-notice" role="status">Your pet is taking a nap for 30 minutes of office time. Ready around {timeLabel(pet.napEndsAt)}. Care and play will return after resting.</p>
}

function Onboarding({ snapshot, command, busy }) {
  const [step, setStep] = useState(0)
  const [name, setName] = useState('Moss')
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
    <div className="lanpet-step-indicator" aria-label={`Step ${step + 1} of 3`}>{[0, 1, 2].map(index => <span key={index} data-current={index <= step} />)}</div>
    <div className="lanpet-onboarding-art"><LanpetAvatar stage="seed" /></div>
    {step === 0 && <>
      <span className="lanpet-eyebrow">A SMALL LIFE, CLOSE BY</span>
      <h2>Make room for a little friend.</h2>
      <p>A seed, a sprout, a companion. A few gentle moments of care help your Lanpet grow. Friends on your local network can join the fun.</p>
      <div className="lanpet-onboarding-facts"><span><Leaf size={16} /> Grows with care</span><span><Shield size={16} /> Private by default</span></div>
    </>}
    {step === 1 && <>
      <span className="lanpet-eyebrow">EVERY FRIEND NEEDS A NAME</span>
      <h2>What should we call them?</h2>
      <label className="lanpet-field">Pet name<input ref={inputReference} value={name} onChange={event => setName(event.target.value)} maxLength={24} required autoComplete="off" /></label>
      <p>Your pet belongs to you. Chat messages never become food, points, or training.</p>
    </>}
    {step === 2 && <>
      <span className="lanpet-eyebrow">YOUR OWN PACE</span>
      <h2>A little care. Plenty of breathing room.</h2>
      <OfficeHours snapshot={snapshot} />
      <p>Your pet can rest while you are away. No competitive streaks, no pressure to keep chatting.</p>
      <label className="lanpet-checkbox"><input type="checkbox" checked={share} onChange={event => setShare(event.target.checked)} /><span><strong>Share my pet with nearby friends</strong><small>Other LAN Chat peers can see your pet and invite you to play. You can change this at any time.</small></span></label>
    </>}
    <div className="lanpet-onboarding-actions">
      {step > 0 && <button type="button" className="lanpet-button" disabled={busy} onClick={() => setStep(step - 1)}>Back</button>}
      <button type="submit" className="lanpet-button is-primary" disabled={busy || !name.trim()}>{step === 2 ? 'Welcome home' : 'Continue'}<ArrowRight size={16} /></button>
    </div>
  </form>
}

function Meter({ label, value }) {
  const safeValue = Math.max(0, Math.min(100, Number(value) || 0))
  return <div className="lanpet-meter"><div><span>{label}</span><span>{Math.round(safeValue)}<small>/100</small></span></div><meter aria-label={label} min="0" max="100" value={safeValue} /></div>
}

function PetHome({ snapshot, command, busy }) {
  const pet = snapshot.pet
  const resting = ['resting', 'restingAway'].includes(pet.lifecycleState) || !snapshot.isWorkingTime
  const canCare = snapshot.enabled && snapshot.isWorkingTime && pet.lifecycleState === 'active'
  const growthChoices = pet.growthChoices || []
  return <>
    <div className="lanpet-home-layout">
      <section className="lanpet-pocket" aria-label={`${pet.name}'s terrarium`}>
        <div className="lanpet-pocket-label"><span>LANPET / 01</span><span className="lanpet-lamp">{resting ? 'RESTING' : 'AT HOME'}</span></div>
        <div className="lanpet-terrarium"><div className="lanpet-sky-detail" /><LanpetAvatar stage={pet.stage} appearanceId={pet.appearanceId} resting={resting} /><div className="lanpet-ground" /><span className="lanpet-scene-caption">{resting ? 'Dreaming of little adventures' : 'A good day to grow'}</span></div>
        <div className="lanpet-pocket-caption"><div><h2>{pet.name}</h2><span>{{ seed: 'Seed', young: 'Sprout', grown: 'Companion' }[pet.stage] || readableLabel(pet.stage)} · {readableLabel(pet.temperament) || 'A curious little soul'}</span></div><span className="lanpet-generation">ONE OF<br />A KIND</span></div>
      </section>
      <section className="lanpet-care-panel" aria-labelledby="lanpet-care-title">
        <span className="lanpet-eyebrow">EVERYDAY MOMENTS</span><h2 id="lanpet-care-title">A little attention goes a long way.</h2>
        <p className="lanpet-secondary">Care, play, and shared moments shape the friend they become.</p>
        <div className="lanpet-meters"><Meter label="Care" value={pet.care} /><Meter label="Joy" value={pet.joy} /><Meter label="Energy" value={pet.energy} /><Meter label="Bond" value={pet.bond} /></div>
        <div className="lanpet-care-actions">{careActions.map(action => <button key={action.action} className="lanpet-care-button" disabled={busy || !canCare} onClick={() => command({ type: 'care', action: action.action })}><span aria-hidden="true">{action.symbol}</span>{action.label}</button>)}</div>
        {pet.lifecycleState === 'restingAway' && <button className="lanpet-button lanpet-welcome" disabled={busy || !snapshot.enabled || !snapshot.isWorkingTime} onClick={() => command({ type: 'care', action: 'welcomeBack' })}><Leaf size={16} /> Welcome back</button>}
        <NapNotice pet={pet} />
        {!snapshot.isWorkingTime && <p className="lanpet-secondary">Care returns during office hours. Your progress is safe.</p>}
        {['ownerConflict', 'recovering'].includes(pet.lifecycleState) && <p className="lanpet-notice">Your pet needs to recover before playing. {readableLabel(pet.lifecycleState)}.</p>}
      </section>
    </div>
    <OfficeHours snapshot={snapshot} />
    <section className="lanpet-growth" aria-label="Growth">
      <div><span className="lanpet-eyebrow">GROWING AT YOUR PACE</span><h3>{growthChoices.length ? 'A new chapter is ready.' : 'Small moments, lasting growth.'}</h3><p>{Number(pet.growthPoints) || 0} growth points · No need to rush.</p></div>
      {growthChoices.length > 0 && <div className="lanpet-growth-choices">{growthChoices.map(choice => {
        const choiceId = typeof choice === 'string' ? choice : choice.choiceId || choice.id
        const label = typeof choice === 'string' ? 'a new companion' : choice.label || choice.name || growthLabel(choice)
        return <button key={choiceId} className="lanpet-growth-choice" disabled={busy || !canCare} onClick={() => command({ type: 'grow', choiceId })}><LanpetAvatar stage={choice.stage} appearanceId={choice.appearanceId} small /><span>Grow into {label}</span></button>
      })}</div>}
    </section>
  </>
}

function peerStatus(peer, blocked = false) {
  if (blocked) return { label: 'Invitations blocked', hint: 'Unblock this friend when you want to play together again.', disabled: true }
  if (peer.pendingKeyChange) return { label: 'Identity check needed', hint: 'Confirm this peer in LAN Chat before sharing your pet.', disabled: true }
  if (!peer.online) return { label: 'Offline', hint: 'Your friend needs to be on the same local network.', disabled: true }
  if (!peer.supported) return { label: 'Update needed', hint: 'Your friend needs a LAN Chat version with Lanpet.', disabled: true }
  if (!peer.available) return { label: 'Not available', hint: 'Your friend may be resting or keeping their pet private.', disabled: true }
  return { label: 'Ready to play', hint: '', disabled: false }
}

function Invitation({ invitation, command, busy, interactionPaused }) {
  const incoming = invitation.direction === 'incoming'
  return <article className="lanpet-invitation"><div><span className="lanpet-eyebrow">{incoming ? 'AN INVITATION FOR YOU' : 'INVITATION SENT'}</span><h3>{activityLabels[invitation.activity] || 'Play'} · {invitation.peerName || 'Nearby friend'}</h3><p>{incoming ? 'Join when you feel like it.' : 'Waiting for your friend to decide.'} {invitation.expiresAt && `Expires ${timeLabel(invitation.expiresAt)}.`}</p></div><div className="lanpet-action-row">{incoming && <><button className="lanpet-button is-primary" disabled={busy || interactionPaused} onClick={() => command({ type: 'respond', sessionId: invitation.sessionId, response: 'accept' })}><Check size={15} />Accept</button><button className="lanpet-button" disabled={busy} onClick={() => command({ type: 'respond', sessionId: invitation.sessionId, response: 'decline' })}>Decline</button></>}{!incoming && <button className="lanpet-button" disabled={busy} onClick={() => command({ type: 'end', sessionId: invitation.sessionId })}>Cancel invitation</button>}</div></article>
}

function Session({ session, command, busy, interactionPaused }) {
  const [now, setNow] = useState(Date.now())
  const active = session.status === 'inProgress'
  const interactive = ['battle', 'cooperativePlay'].includes(session.activity)
  const totalTurns = session.totalTurns || (session.activity === 'battle' ? 5 : 3)
  const secondsRemaining = Math.max(0, Math.ceil((Number(session.turnEndsAt) - now) / 1000))
  const turnExpired = session.activity === 'battle' && Number.isFinite(secondsRemaining) && secondsRemaining === 0
  const canChoose = active && !interactionPaused && !session.ownChoice && !session.waitingForPeer && !turnExpired
  let visitActionLabel = 'Waiting for your friend…'
  if (canChoose) visitActionLabel = 'Complete visit'
  if (interactionPaused) visitActionLabel = 'Play is paused'
  useEffect(() => {
    if (!active || session.activity !== 'battle') return undefined
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active, session.activity])
  return <article className="lanpet-session">
    <div className="lanpet-session-heading"><div><span className="lanpet-eyebrow">{activityLabels[session.activity] || 'Together'}</span><h3>With {session.peerName || 'your friend'}</h3></div><span className="lanpet-badge">{statusLabels[session.status] || readableLabel(session.status)}</span></div>
    {active && interactive && <>
      <p className="lanpet-game-rules">{session.activity === 'battle' ? 'Focus beats Spark. Spark beats Guard. Guard beats Focus. Five rounds, 15 seconds each. No move means Rest.' : 'Pick a light together in each of three rounds. Every combination counts; there is no wrong answer.'}</p>
      <div className="lanpet-game-progress"><span>ROUND {session.turn || 1} / {totalTurns}</span><span>{session.ownChoice ? `You chose ${choiceLabels[session.ownChoice] || session.ownChoice}` : 'Choose your move'}</span>{session.activity === 'battle' && Number.isFinite(secondsRemaining) && <span>{secondsRemaining}s</span>}</div>
      <div className="lanpet-move-grid">{Object.entries(choiceLabels).map(([choice, label]) => <button key={choice} className={`lanpet-move ${session.ownChoice === choice ? 'is-selected' : ''}`} disabled={busy || !canChoose} onClick={() => command({ type: 'action', sessionId: session.sessionId, choice })}><span aria-hidden="true">{{ focus: '◎', guard: '◇', spark: '✦' }[choice]}</span>{label}</button>)}</div>
      {(session.ownChoice || session.waitingForPeer) && <p role="status" className="lanpet-secondary">Move sent. Waiting for your friend…</p>}
      {turnExpired && !session.ownChoice && <p role="status" className="lanpet-secondary">Time is up. Waiting for this round to finish…</p>}
      {session.lastRound && <p className="lanpet-round-result">Last round: {choiceLabels[session.lastRound.ownChoice]} / {choiceLabels[session.lastRound.peerChoice]} · {session.lastRound.ownScore}–{session.lastRound.peerScore}</p>}
    </>}
    {active && session.activity === 'visit' && <div className="lanpet-visit"><LanpetAvatar small stage="sprout" /><p>A little company makes a good day.</p><button className="lanpet-button is-primary" disabled={busy || !canChoose} onClick={() => command({ type: 'action', sessionId: session.sessionId, choice: 'focus' })}>{visitActionLabel}</button></div>}
    {session.result && <div className="lanpet-result"><Sparkles size={19} /><div><strong>{outcomeLabels[session.result.outcome] || 'A moment to remember'}</strong>{session.activity === 'battle' && <p>Final score · {session.result.ownScore}–{session.result.peerScore}</p>}<p>Your pet and items stay with you.</p></div></div>}
    {session.settlementPending && <p className="lanpet-notice">Result saved here. Waiting for your friend to confirm.</p>}
    {['resultUnknown', 'reconciliationNeeded', 'keyChanged'].includes(session.status) && <p className="lanpet-notice">The result is not confirmed. Reconnect with your friend to recover this session. No outcome will be guessed.</p>}
    {active && <button className="lanpet-button is-quiet" disabled={busy} onClick={() => command({ type: 'end', sessionId: session.sessionId })}>End session</button>}
  </article>
}

function Friends({ snapshot, command, busy }) {
  const peers = snapshot.peers || []
  const interactionPaused = !snapshot.enabled || !snapshot.sharingEnabled || !snapshot.isWorkingTime || Boolean(snapshot.pet?.napEndsAt) || !['active', 'visiting'].includes(snapshot.pet?.lifecycleState)
  return <div className="lanpet-section-stack">
    <div className="lanpet-section-heading"><div><span className="lanpet-eyebrow">A NEIGHBORHOOD, CLOSE BY</span><h2>Good company.</h2><p>Meet the pets of people on your local network.</p></div><span className="lanpet-badge">{peers.filter(peer => peer.available).length} ready</span></div>
    {!snapshot.sharingEnabled && <div className="lanpet-notice"><Shield size={18} /><div><strong>Your pet is private.</strong><p>Turn on sharing to exchange invitations. Your choice only applies to Lanpet.</p><button className="lanpet-button" disabled={busy} onClick={() => command({ type: 'settings', sharingEnabled: true })}>Enable pet sharing</button></div></div>}
    <NapNotice pet={snapshot.pet} />
    {!snapshot.isWorkingTime && <p className="lanpet-notice">Your pet can play with friends again during your office hours.</p>}
    {snapshot.pet?.lifecycleState === 'restingAway' && <p className="lanpet-notice">Welcome your pet back in My pet before playing together.</p>}
    {(snapshot.invitations || []).map(invitation => <Invitation key={invitation.sessionId} invitation={invitation} command={command} busy={busy} interactionPaused={interactionPaused} />)}
    {(snapshot.sessions || []).map(session => <Session key={session.sessionId} session={session} command={command} busy={busy} interactionPaused={interactionPaused} />)}
    {!peers.length && <div className="lanpet-empty"><Users size={28} /><h3>Your neighborhood is quiet.</h3><p>Friends appear here when LAN Chat discovers them. Both apps need Lanpet, pet sharing, and a trusted connection.</p></div>}
    <div className="lanpet-peer-grid">{peers.map(peer => {
      const blockedPeerIds = snapshot.blockedPeerIds || []
      const blocked = blockedPeerIds.includes(peer.peerId) || peer.blocked === true
      const status = peerStatus(peer, blocked)
      const nextBlockedPeerIds = blocked ? blockedPeerIds.filter(peerId => peerId !== peer.peerId) : [...blockedPeerIds, peer.peerId]
      return <article className="lanpet-peer" key={peer.peerId}><div className="lanpet-peer-heading"><div className="lanpet-peer-avatar"><LanpetAvatar stage={peer.stage} appearanceId={peer.appearanceId} small resting={!peer.available} /></div><div><h3>{peer.petName || peer.name || 'Nearby friend'}</h3><p>{peer.petName && peer.name}</p><span className={`lanpet-peer-status ${status.disabled ? '' : 'is-ready'}`}>{status.label}</span></div></div>{status.hint && <p className="lanpet-secondary">{status.hint}</p>}<div className="lanpet-peer-actions">{Object.entries(activityLabels).map(([activity, label]) => <button key={activity} className="lanpet-button" title={activityDescriptions[activity]} disabled={busy || interactionPaused || status.disabled || snapshot[activitySettings[activity]] === false || !peer.activities?.includes(activity)} onClick={() => command({ type: 'invite', peerId: peer.peerId, activity })}>{label}</button>)}</div><button className="lanpet-button is-quiet lanpet-peer-block" disabled={busy} onClick={() => command({ type: 'settings', blockedPeerIds: nextBlockedPeerIds })}>{blocked ? 'Unblock invitations' : 'Block invitations'}</button></article>
    })}</div>
  </div>
}

function Journal({ snapshot }) {
  const memories = snapshot.history || []
  const detailedSessionIds = new Set(memories.filter(event => event.activity && event.sessionId).map(event => event.sessionId))
  // 같은 교류의 보상 이벤트와 세션 결과가 함께 오면 친구 정보가 있는 결과 한 건만 보여준다.
  const history = memories.filter(event => !(event.type?.startsWith('social.') && detailedSessionIds.has(event.sessionId)))
  const inventory = snapshot.inventory || []
  return <div className="lanpet-section-stack"><div className="lanpet-section-heading"><div><span className="lanpet-eyebrow">LITTLE THINGS WORTH KEEPING</span><h2>Your field journal.</h2><p>Shared moments and keepsakes, saved with your pet.</p></div><History size={24} /></div><section><h3 className="lanpet-subheading">Keepsakes <span>{inventory.length}</span></h3>{inventory.length ? <div className="lanpet-keepsakes">{inventory.map((item, index) => <article key={item.itemType || index}><Gift size={22} /><strong>{item.itemType === 'friendshipStar' ? 'Friendship star' : readableLabel(item.itemType) || 'Friendship keepsake'}</strong><span>{item.quantity ? `×${item.quantity}` : 'A shared memory'}</span></article>)}</div> : <p className="lanpet-empty-note">Your first keepsake is waiting to become a story.</p>}</section><section><h3 className="lanpet-subheading">Memories <span>{history.length}</span></h3>{history.length ? <ol className="lanpet-timeline">{history.map((event, index) => {
    const activity = event.activity || event.type?.replace(/^social\./, '')
    const outcome = event.result?.outcome || event.payload?.outcome
    const detail = outcomeLabels[outcome] || statusLabels[event.status]
    return <li key={event.eventId || event.sessionId || event.id || index}><span className="lanpet-timeline-dot" /><div><strong>{activityLabels[activity] || memoryLabels[event.type] || 'A little moment'}{event.peerName ? ` with ${event.peerName}` : ''}</strong>{detail && <p>{detail}</p>}<time>{timeLabel(event.completedAt || event.endedAt || event.startedAt || event.createdAt)}</time></div></li>
  })}</ol> : <p className="lanpet-empty-note">Visit a friend or finish a game to start your journal.</p>}</section></div>
}

function Preferences({ snapshot, command, busy, onDeleted }) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  return <div className="lanpet-section-stack"><div className="lanpet-section-heading"><div><span className="lanpet-eyebrow">MAKE YOURSELF AT HOME</span><h2>Your pet, your pace.</h2></div><Settings size={24} /></div><label className="lanpet-checkbox"><input type="checkbox" checked={snapshot.enabled} disabled={busy} onChange={event => command({ type: 'settings', enabled: event.target.checked })} /><span><strong>Enable Lanpet</strong><small>Pause your pet and its social activities when you need a break.</small></span></label><label className="lanpet-checkbox"><input type="checkbox" checked={snapshot.sharingEnabled} disabled={busy || !snapshot.enabled} onChange={event => command({ type: 'settings', sharingEnabled: event.target.checked })} /><span><strong>Share my pet with nearby friends</strong><small>Let peers see your pet and send invitations. Turning this off stops sharing; it does not delete your pet.</small></span></label><section><h3 className="lanpet-subheading">Play your way</h3><p className="lanpet-secondary">Choose the activities you want to share with friends.</p><div className="lanpet-activity-settings">{Object.entries(activitySettings).map(([activity, setting]) => <label key={setting} className="lanpet-checkbox"><input type="checkbox" checked={snapshot[setting] !== false} disabled={busy || !snapshot.enabled} onChange={event => command({ type: 'settings', [setting]: event.target.checked })} /><span><strong>{activityLabels[activity]}</strong><small>{activityDescriptions[activity]}</small></span></label>)}</div></section><section className="lanpet-settings-note"><h3>Room to rest.</h3><OfficeHours snapshot={snapshot} /><p>Chatting more never earns extra pet points. Care and social activities happen through your own choices.</p></section><section className="lanpet-delete-section"><h3>Say goodbye to this pet</h3><p>Delete your local pet, keepsakes, and Lanpet history. This cannot be undone. Memories already saved by friends may remain on their devices.</p>{!confirmDelete && <button className="lanpet-button is-danger" disabled={busy} onClick={() => setConfirmDelete(true)}>Delete pet…</button>}{confirmDelete && <div className="lanpet-delete-confirm" role="group" aria-label="Confirm pet deletion"><strong>Delete {snapshot.pet.name} and their local memories?</strong><div className="lanpet-action-row"><button className="lanpet-button" disabled={busy} onClick={() => setConfirmDelete(false)}>Keep my pet</button><button className="lanpet-button is-danger" disabled={busy} onClick={async () => { if (await command({ type: 'delete' })) onDeleted() }}>Delete permanently</button></div></div>}</section></div>
}

export default function LanpetPanel({ onClose }) {
  const { snapshot, loading, busy, error, command, refresh, retry } = useLanpet()
  const [tab, setTab] = useState('home')
  const dialogReference = useRef(null)

  useEffect(() => {
    const dialog = dialogReference.current
    if (dialog.showModal) dialog.showModal()
    else dialog.setAttribute('open', '')
    return () => { if (dialog.open && dialog.close) dialog.close() }
  }, [])

  const tabs = [{ id: 'home', label: 'My pet', icon: Leaf }, { id: 'friends', label: 'Friends', icon: Users }, { id: 'journal', label: 'Journal', icon: History }, { id: 'settings', label: 'Settings', icon: Settings }]
  const invitationCount = (snapshot?.invitations || []).filter(invitation => invitation.direction === 'incoming').length

  return <dialog ref={dialogReference} className="lanpet-dialog" aria-labelledby="lanpet-title" onCancel={event => { event.preventDefault(); onClose() }}>
    <header className="lanpet-header"><div className="lanpet-wordmark"><span className="lanpet-brand-icon"><Leaf size={20} /></span><div><h1 id="lanpet-title">Lanpet<span>POCKET COMPANION</span></h1></div></div><div className="lanpet-header-actions"><span className="lanpet-local-label"><span />LOCAL ONLY</span><button type="button" className="lanpet-icon-button" aria-label="Close Lanpet" onClick={onClose} autoFocus><X size={20} /></button></div></header>
    {snapshot?.pet && <nav className="lanpet-tabs" aria-label="Lanpet sections">{tabs.map(item => <button key={item.id} type="button" className={tab === item.id ? 'is-active' : ''} aria-current={tab === item.id ? 'page' : undefined} onClick={() => setTab(item.id)}><item.icon size={16} /><span>{item.label}</span>{item.id === 'friends' && invitationCount > 0 && <span className="lanpet-count">{invitationCount}</span>}</button>)}</nav>}
    <div className="lanpet-content" aria-busy={busy || loading}>
      {(error || snapshot?.error) && <div className="lanpet-error" role="alert"><div><strong>Something needs attention.</strong><p>{(error || snapshot.error).message}</p></div><button className="lanpet-button" disabled={busy || loading} onClick={retry}><RefreshCw size={15} />Retry</button></div>}
      {loading && !snapshot && <div className="lanpet-empty" role="status"><Leaf size={28} /><p>Opening your little world…</p></div>}
      {snapshot && !snapshot.pet && !snapshot.error && <Onboarding snapshot={snapshot} command={command} busy={busy} />}
      {snapshot?.pet && <>
        {!snapshot.enabled && <div className="lanpet-notice"><Moon size={19} /><div><strong>Lanpet is paused.</strong><p>Your pet is taking a quiet break.</p><button className="lanpet-button" disabled={busy} onClick={() => command({ type: 'settings', enabled: true })}>Resume Lanpet</button></div></div>}
        {tab === 'home' && <PetHome snapshot={snapshot} command={command} busy={busy} />}
        {tab === 'friends' && <Friends snapshot={snapshot} command={command} busy={busy} />}
        {tab === 'journal' && <Journal snapshot={snapshot} />}
        {tab === 'settings' && <Preferences snapshot={snapshot} command={command} busy={busy} onDeleted={() => setTab('home')} />}
      </>}
      {snapshot?.pet && tab === 'friends' && <button className="lanpet-button is-quiet lanpet-refresh" disabled={loading || busy} onClick={refresh}><RefreshCw size={14} />Refresh neighborhood</button>}
    </div>
    <footer className="lanpet-footer"><span>{busy ? 'Saving your moment…' : 'Small moments. Good company.'}</span><span>LAN CHAT × LANPET</span></footer>
  </dialog>
}
