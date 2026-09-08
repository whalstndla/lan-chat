import React, { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import useLanpet from './useLanpet'
import LanpetPanel, { Invitation, Session } from './LanpetPanel'
import { PetRoom } from './LanpetWorld'
import './Lanpet.css'
import './LanpetWorld.css'

function DrawerContent({ currentRoom, openPanel }) {
  const { snapshot, busy, error, command, loading } = useLanpet()
  if (loading && !snapshot) return <p className="pet-drawer-note">친구들이 놀이방으로 오는 중…</p>
  if (!snapshot?.pet) return <div className="pet-drawer-note"><p>여섯 종류의 작은 친구 중 누가 찾아올까요?</p><button className="lanpet-button is-primary" onClick={() => openPanel('home')}>내 첫 랜펫 만나기</button></div>
  const paused = !snapshot.enabled || !snapshot.isWorkingTime || snapshot.pet.lifecycleState !== 'active'
  const inRoom = peer => currentRoom.type === 'global' || peer.peerId === currentRoom.peerId
  const peers = (snapshot.peers || []).filter(peer => inRoom(peer) && peer.available && peer.petName)
  const invitations = (snapshot.invitations || []).filter(inRoom)
  const sessions = (snapshot.sessions || []).filter(inRoom).slice(0, 1)
  return <div className="pet-drawer-body">
    <div className="pet-drawer-scene"><PetRoom pet={snapshot.pet} peers={peers} room={snapshot.world?.room} roaming resting={paused} /></div>
    <div className="pet-drawer-controls"><div className="pet-drawer-heading"><strong>{snapshot.pet.name}의 놀이방</strong><span>✦ {snapshot.world?.balance || 0}</span></div>
      <p>{peers.length ? '현재 채팅방 친구들과 함께 쉬어 가요.' : '이 채팅방에서 펫을 공개한 친구가 오면 함께 놀아요.'}</p>
      <div className="lanpet-action-row"><button className="lanpet-button" disabled={busy || paused} onClick={() => command({ type: 'feed', itemId: 'snack' })}>간식 주기</button><button className="lanpet-button" onClick={() => openPanel('shop')}>상점·꾸미기</button><button className="lanpet-button" onClick={() => openPanel('games')}>미니게임</button></div>
      {peers.map(peer => <div className="pet-drawer-peer" key={peer.peerId}><span>{peer.petName}</span><button className="lanpet-button" disabled={busy || paused || snapshot.allowCooperativePlay === false || !peer.activities?.includes('race')} onClick={() => command({ type: 'invite', peerId: peer.peerId, activity: 'race' })}>경주 초대</button><button className="lanpet-button" disabled={busy || paused || !peer.activities?.includes('cooperativePlay')} onClick={() => command({ type: 'invite', peerId: peer.peerId, activity: 'cooperativePlay' })}>같이 놀기</button></div>)}
      {invitations.map(invitation => <Invitation key={invitation.sessionId} invitation={invitation} command={command} busy={busy} interactionPaused={paused} />)}
      {sessions.map(session => <Session key={session.sessionId} session={session} command={command} busy={busy} interactionPaused={paused} />)}
      {error && <p role="alert">{error.message}</p>}
      {paused && <p>월–금 09–18시, 펫이 깨어 있을 때 활동할 수 있어요.</p>}
    </div>
  </div>
}

export default function LanpetDrawer({ currentRoom }) {
  const [open, setOpen] = useState(false)
  const [panel, setPanel] = useState(null)
  useEffect(() => {
    window.electronAPI?.lanpet?.setDrawerExpanded?.(open)?.catch?.(() => {})
    return () => { window.electronAPI?.lanpet?.setDrawerExpanded?.(false)?.catch?.(() => {}) }
  }, [open])
  return <section className="lanpet-drawer">
    <button className="pet-drawer-toggle" aria-expanded={open} aria-controls="lanpet-chat-yard" onClick={() => setOpen(value => !value)}><span>✦ 랜펫 놀이방 <small>친구와 쉬어 가는 작은 공간</small></span>{open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}</button>
    {open && <div id="lanpet-chat-yard"><DrawerContent currentRoom={currentRoom} openPanel={setPanel} /></div>}
    {panel && <LanpetPanel initialTab={panel} onClose={() => setPanel(null)} />}
  </section>
}
