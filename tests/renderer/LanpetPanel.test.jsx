import React from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import LanpetPanel from '../../src/components/lanpet/LanpetPanel'

function makeSnapshot(overrides = {}) {
  return {
    enabled: true,
    sharingEnabled: false,
    allowVisit: true, allowCooperativePlay: true, allowGift: true, allowBattle: true,
    blockedPeerIds: [],
    workHours: { startHour: 9, endHour: 18, weekdays: [1, 2, 3, 4, 5] },
    isWorkingTime: true,
    pet: { petId: 'pet-local', name: 'Moss', stage: 'young', lifecycleState: 'active', care: 75, joy: 65, energy: 80, bond: 40, growthPoints: 12, growthChoices: [] },
    peers: [], invitations: [], sessions: [], history: [], inventory: [],
    ...overrides,
  }
}

describe('Lanpet panel', () => {
  let snapshot
  let changed
  let unsubscribe
  let api

  beforeEach(() => {
    snapshot = makeSnapshot()
    unsubscribe = jest.fn()
    window.crypto.randomUUID = jest.fn().mockReturnValue('request-ui-1')
    api = {
      getSnapshot: jest.fn(async () => snapshot),
      command: jest.fn(async () => ({ ok: true, snapshot })),
      onChanged: jest.fn(callback => { changed = callback; return unsubscribe }),
    }
    window.electronAPI = { lanpet: api }
  })

  async function openPanel() {
    const result = render(<LanpetPanel onClose={jest.fn()} />)
    await waitFor(() => expect(api.getSnapshot).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByText('작은 친구의 공간을 여는 중…')).not.toBeInTheDocument())
    return result
  }

  it('shows an explicit unavailable state instead of a simulated pet when the API is absent', async () => {
    window.electronAPI = {}
    render(<LanpetPanel onClose={jest.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('이 앱 버전에서는 랜펫을 사용할 수 없어요')
    expect(screen.queryByText('Moss')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '친구 맞이하기' })).not.toBeInTheDocument()
  })

  it('does not offer onboarding when the main process reports a closed session', async () => {
    snapshot = makeSnapshot({ pet: null, error: { code: 'SESSION_CLOSED', message: '다시 로그인해 주세요.' } })
    await openPanel()
    expect(screen.getByRole('alert')).toHaveTextContent('다시 로그인해 주세요.')
    expect(screen.queryByRole('button', { name: '다음' })).not.toBeInTheDocument()
  })

  it('creates through the API after three steps and keeps sharing private unless selected', async () => {
    snapshot = makeSnapshot({ pet: null, enabled: false })
    api.command.mockImplementation(async request => {
      snapshot = makeSnapshot({ pet: { ...makeSnapshot().pet, name: request.name } })
      return { ok: true, snapshot }
    })
    await openPanel()
    fireEvent.click(screen.getByRole('button', { name: '다음' }))
    fireEvent.change(screen.getByLabelText('펫 이름'), { target: { value: 'Pebble' } })
    fireEvent.click(screen.getByRole('button', { name: '다음' }))
    expect(screen.getByRole('checkbox')).not.toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: '친구 맞이하기' }))
    expect(await screen.findByRole('heading', { name: 'Pebble' })).toBeInTheDocument()
    expect(api.command).toHaveBeenCalledTimes(1)
    expect(api.command).toHaveBeenCalledWith({ type: 'create', name: 'Pebble', requestId: 'request-ui-1' })
  })

  it('does not allow duplicated care while a command is in flight and reads the returned state', async () => {
    let resolveCommand
    api.command.mockImplementation(() => new Promise(resolve => { resolveCommand = resolve }))
    await openPanel()
    fireEvent.click(screen.getByRole('button', { name: '돌보기' }))
    fireEvent.click(screen.getByRole('button', { name: '돌보기' }))
    expect(api.command).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '놀아주기' })).toBeDisabled()
    await act(async () => resolveCommand({ ok: true, snapshot: makeSnapshot({ pet: { ...snapshot.pet, care: 91 } }) }))
    expect(screen.getByRole('meter', { name: '돌봄' })).toHaveAttribute('value', '91')
    expect(screen.getByRole('button', { name: '돌보기' })).toBeEnabled()
  })

  it('freezes care outside office hours and offers a return action only for a resting-away pet', async () => {
    snapshot = makeSnapshot({ isWorkingTime: false, pet: { ...snapshot.pet, lifecycleState: 'resting' } })
    await openPanel()
    expect(screen.getByRole('button', { name: '돌보기' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: '다시 만나기' })).not.toBeInTheDocument()
    act(() => changed(makeSnapshot({ pet: { ...snapshot.pet, lifecycleState: 'restingAway' } })))
    fireEvent.click(screen.getByRole('button', { name: '다시 만나기' }))
    await waitFor(() => expect(api.command).toHaveBeenCalledWith(expect.objectContaining({ type: 'care', action: 'welcomeBack' })))
  })

  it('presents growth appearances and sends the exact offered choice without exposing its internal id', async () => {
    snapshot = makeSnapshot({ pet: { ...snapshot.pet, growthChoices: [{ choiceId: 'grown.calm.a', stage: 'grown', appearanceId: 'grown-calm-a', family: 'calm' }] } })
    await openPanel()
    expect(screen.queryByText('grown.calm.a')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '버들 지킴이 모습으로 성장하기' }))
    await waitFor(() => expect(api.command).toHaveBeenCalledWith(expect.objectContaining({ type: 'grow', choiceId: 'grown.calm.a' })))
  })

  it('explains the scheduled nap and pauses care and social input while keeping exit actions available', async () => {
    snapshot = makeSnapshot({
      sharingEnabled: true,
      pet: { ...snapshot.pet, lifecycleState: 'resting', napEndsAt: Date.now() + 30 * 60000 },
      peers: [{ peerId: 'peer-1', petName: 'Fern', online: true, supported: true, available: true, activities: ['visit', 'battle'] }],
      invitations: [{ sessionId: 'invite-1', activity: 'visit', direction: 'incoming', status: 'incomingPending' }],
      sessions: [{ sessionId: 'battle-1', activity: 'battle', status: 'inProgress', turn: 1, turnEndsAt: Date.now() + 15000 }],
    })
    await openPanel()
    expect(screen.getByText(/업무시간 기준 30분 동안 낮잠/)).toHaveAttribute('role', 'status')
    expect(screen.getByRole('button', { name: '돌보기' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /친구/ }))
    expect(screen.getByRole('button', { name: '방문하기' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '수락' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '집중' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '거절' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '활동 끝내기' })).toBeEnabled()
    act(() => changed({ ...snapshot, pet: { ...snapshot.pet, lifecycleState: 'active', napEndsAt: null } }))
    expect(screen.queryByText(/업무시간 기준 30분/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '방문하기' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '수락' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '집중' })).toBeEnabled()
  })

  it('requires pet sharing and disables offline, unsupported, and untrusted peers', async () => {
    const peer = { name: 'Alex', petName: 'Fern', stage: 'grown', online: true, supported: true, available: true, pendingKeyChange: false, activities: ['visit', 'cooperativePlay', 'gift', 'battle'] }
    snapshot = makeSnapshot({ peers: [{ ...peer, peerId: 'ready' }, { ...peer, peerId: 'offline', name: 'Offline friend', petName: 'Acorn', online: false }, { ...peer, peerId: 'old', name: 'Old friend', petName: 'Bud', supported: false }, { ...peer, peerId: 'key', name: 'Key friend', petName: 'Sprig', pendingKeyChange: true }] })
    await openPanel()
    fireEvent.click(screen.getByRole('button', { name: '친구' }))
    expect(screen.getAllByRole('button', { name: '친선 배틀' }).every(button => button.disabled)).toBe(true)
    act(() => changed({ ...snapshot, sharingEnabled: true }))
    const readyCard = screen.getByRole('heading', { name: 'Fern' }).closest('article')
    fireEvent.click(within(readyCard).getByRole('button', { name: '친선 배틀' }))
    await waitFor(() => expect(api.command).toHaveBeenCalledWith(expect.objectContaining({ type: 'invite', peerId: 'ready', activity: 'battle' })))
    expect(screen.getByText('신원 확인 필요')).toBeInTheDocument()
    expect(screen.getByText('업데이트 필요')).toBeInTheDocument()
    expect(screen.getByText('접속하지 않음')).toBeInTheDocument()
  })

  it('accepts and declines invitations using the session identity', async () => {
    snapshot = makeSnapshot({ sharingEnabled: true, invitations: [{ sessionId: 'invite-1', peerId: 'peer-1', peerName: 'Alex', activity: 'visit', direction: 'incoming', status: 'incomingPending' }] })
    await openPanel()
    fireEvent.click(screen.getByRole('button', { name: /친구/ }))
    fireEvent.click(screen.getByRole('button', { name: '수락' }))
    await waitFor(() => expect(api.command).toHaveBeenCalledWith(expect.objectContaining({ type: 'respond', sessionId: 'invite-1', response: 'accept' })))
    await waitFor(() => expect(screen.getByRole('button', { name: '거절' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '거절' }))
    await waitFor(() => expect(api.command).toHaveBeenCalledWith(expect.objectContaining({ type: 'respond', sessionId: 'invite-1', response: 'decline' })))
  })

  it.each([
    ['outside office hours', { isWorkingTime: false }],
    ['Lanpet paused', { enabled: false }],
    ['pet sharing disabled', { sharingEnabled: false }],
    ['resting away', { pet: { ...makeSnapshot().pet, lifecycleState: 'restingAway' } }],
  ])('pauses local social interaction while %s even when the peer is ready', async (_reason, overrides) => {
    snapshot = makeSnapshot({
      sharingEnabled: true,
      peers: [{ peerId: 'peer-1', petName: 'Fern', online: true, supported: true, available: true, activities: ['visit'] }],
      invitations: [{ sessionId: 'invite-1', activity: 'visit', direction: 'incoming' }],
      sessions: [{ sessionId: 'visit-1', activity: 'visit', status: 'inProgress' }],
      ...overrides,
    })
    await openPanel()
    fireEvent.click(screen.getByRole('button', { name: /친구/ }))
    expect(screen.getByRole('button', { name: '방문하기' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '수락' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '놀이가 일시 중지됐어요' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '거절' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '활동 끝내기' })).toBeEnabled()
  })

  it('persists activity preferences and blocks invitations without changing chat settings', async () => {
    snapshot = makeSnapshot({ sharingEnabled: true, peers: [{ peerId: 'peer-1', name: 'Alex', petName: 'Fern', online: true, supported: true, available: true, activities: ['visit', 'cooperativePlay', 'gift', 'battle'] }] })
    await openPanel()
    fireEvent.click(screen.getByRole('button', { name: '설정' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /친선 배틀/ }))
    await waitFor(() => expect(api.command).toHaveBeenCalledWith(expect.objectContaining({ type: 'settings', allowBattle: false })))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /친선 배틀/ })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '친구' }))
    fireEvent.click(screen.getByRole('button', { name: '초대 차단' }))
    await waitFor(() => expect(api.command).toHaveBeenCalledWith(expect.objectContaining({ type: 'settings', blockedPeerIds: ['peer-1'] })))
    act(() => changed({ ...snapshot, blockedPeerIds: ['peer-1'] }))
    expect(screen.getByRole('button', { name: '방문하기' })).toBeDisabled()
    expect(screen.getByText('초대 차단됨')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '초대 차단 해제' }))
    await waitFor(() => expect(api.command).toHaveBeenCalledWith(expect.objectContaining({ type: 'settings', blockedPeerIds: [] })))
  })

  it('sends a real battle choice and locks moves until the peer resolves the round', async () => {
    const session = { sessionId: 'battle-1', peerName: 'Alex', activity: 'battle', status: 'inProgress', turn: 1, totalTurns: 5, ownChoice: null, waitingForPeer: false, turnEndsAt: Date.now() + 15000 }
    snapshot = makeSnapshot({ sharingEnabled: true, sessions: [session] })
    api.command.mockImplementation(async () => ({ ok: true, snapshot: { ...snapshot, sessions: [{ ...session, ownChoice: 'focus', waitingForPeer: true }] } }))
    await openPanel()
    fireEvent.click(screen.getByRole('button', { name: '친구' }))
    expect(screen.getByText('5판 중 1판')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '집중' }))
    await waitFor(() => expect(api.command).toHaveBeenCalledWith(expect.objectContaining({ type: 'action', sessionId: 'battle-1', choice: 'focus' })))
    expect(await screen.findByText('선택을 보냈어요. 친구를 기다리고 있어요…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '불꽃' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '활동 끝내기' }))
    await waitFor(() => expect(api.command).toHaveBeenCalledWith(expect.objectContaining({ type: 'end', sessionId: 'battle-1' })))
  })

  it('retries an uncertain command with its original request id', async () => {
    api.command.mockRejectedValueOnce(new Error('Response interrupted'))
    await openPanel()
    fireEvent.click(screen.getByRole('button', { name: '정리하기' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('결과를 확인하지 못했어요')
    expect(screen.getByRole('alert')).not.toHaveTextContent('Response interrupted')
    const firstRequest = api.command.mock.calls[0][0]
    window.crypto.randomUUID.mockReturnValue('a-different-id')
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    await waitFor(() => expect(api.command).toHaveBeenCalledTimes(2))
    expect(api.command.mock.calls[1][0]).toEqual(firstRequest)
  })

  it('shows real inventory and requires a separate confirmation before deletion', async () => {
    snapshot = makeSnapshot({ inventory: [{ itemType: 'friendshipStar', quantity: 2, updatedAt: Date.now() }] })
    await openPanel()
    fireEvent.click(screen.getByRole('button', { name: '추억' }))
    expect(screen.getByText('우정의 별')).toBeInTheDocument()
    expect(screen.getByText('×2')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '설정' }))
    fireEvent.click(screen.getByRole('button', { name: '펫 삭제…' }))
    expect(api.command).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '내 펫 간직하기' }))
    expect(screen.queryByRole('button', { name: '영구 삭제' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '펫 삭제…' }))
    fireEvent.click(screen.getByRole('button', { name: '영구 삭제' }))
    await waitFor(() => expect(api.command).toHaveBeenCalledWith(expect.objectContaining({ type: 'delete' })))
  })

  it('shows each shared memory once with a readable label instead of internal event types', async () => {
    snapshot = makeSnapshot({ history: [
      { eventId: 'reward-1', sessionId: 'gift-1', type: 'social.gift', payload: { outcome: 'completed' } },
      { sessionId: 'gift-1', activity: 'gift', peerName: 'Fern', status: 'completed', result: { outcome: 'completed' } },
      { eventId: 'created-1', type: 'pet.created' },
      { eventId: 'old-visit', type: 'social.visit', payload: { outcome: 'completed' } },
    ] })
    await openPanel()
    fireEvent.click(screen.getByRole('button', { name: '추억' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(screen.getByText('기념품 보내기 · Fern 님과 함께')).toBeInTheDocument()
    expect(screen.getByText('새 친구가 찾아왔어요')).toBeInTheDocument()
    expect(screen.getByText('방문하기')).toBeInTheDocument()
    expect(screen.queryByText('social.gift')).not.toBeInTheDocument()
    expect(screen.queryByText('pet.created')).not.toBeInTheDocument()
  })

  it('keeps system labels Korean for unknown states, timeout moves, and keepsakes without changing protocol values', async () => {
    snapshot = makeSnapshot({
      sharingEnabled: true,
      pet: { ...snapshot.pet, name: '이끼', stage: 'futureStage', temperament: 'futureTemperament' },
      inventory: [{ itemType: 'futureKeepsake', quantity: 1 }],
      sessions: [{ sessionId: 'battle-1', activity: 'battle', status: 'futureStatus', lastRound: { ownChoice: 'rest', peerChoice: 'focus', ownScore: 0, peerScore: 1 } }],
      history: [{ eventId: 'memory-1', type: 'futureMemory', createdAt: new Date(2026, 8, 8, 10, 0).getTime() }],
    })
    await openPanel()
    for (const tab of ['내 펫', '친구', '추억', '설정']) {
      fireEvent.click(screen.getByRole('button', { name: tab }))
      const dialog = screen.getByRole('dialog')
      expect(dialog.textContent).not.toMatch(/[A-Za-z]/)
      for (const element of dialog.querySelectorAll('[aria-label], [title]')) {
        expect(`${element.getAttribute('aria-label') || ''}${element.getAttribute('title') || ''}`).not.toMatch(/[A-Za-z]/)
      }
    }
    fireEvent.click(screen.getByRole('button', { name: '추억' }))
    expect(screen.getByText('우정의 기념품')).toBeInTheDocument()
    expect(screen.getByText(/9월 8일/)).toBeInTheDocument()
    act(() => changed({ ...snapshot, sessions: [{ ...snapshot.sessions[0], status: 'inProgress', ownChoice: 'rest' }] }))
    fireEvent.click(screen.getByRole('button', { name: '친구' }))
    expect(screen.getByText('내 선택: 쉬기')).toBeInTheDocument()
    expect(screen.getByText(/지난 판: 쉬기 \/ 집중/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '쉬기' })).not.toBeInTheDocument()
    expect(api.command).not.toHaveBeenCalled()
  })

  it('releases its change listener when the panel closes', async () => {
    const { unmount } = await openPanel()
    act(() => changed(makeSnapshot({ pet: { ...snapshot.pet, name: 'Fern' } })))
    expect(screen.getByRole('heading', { name: 'Fern' })).toBeInTheDocument()
    unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('refreshes office-hour boundaries only while visible and stops polling after unmount', async () => {
    const intervalSpy = jest.spyOn(window, 'setInterval')
    const clearIntervalSpy = jest.spyOn(window, 'clearInterval')
    const originalVisibility = Object.getOwnPropertyDescriptor(document, 'visibilityState')
    const { unmount } = await openPanel()
    const timerCall = intervalSpy.mock.calls.find(call => call[1] === 30000)
    expect(timerCall).toBeDefined()
    const initialReads = api.getSnapshot.mock.calls.length
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    await act(async () => timerCall[0]())
    expect(api.getSnapshot).toHaveBeenCalledTimes(initialReads)
    snapshot = makeSnapshot({ isWorkingTime: false, pet: { ...snapshot.pet, lifecycleState: 'resting' } })
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    await act(async () => window.dispatchEvent(new Event('focus')))
    expect(api.getSnapshot).toHaveBeenCalledTimes(initialReads + 1)
    expect(screen.getByRole('button', { name: '돌보기' })).toBeDisabled()
    unmount()
    expect(clearIntervalSpy).toHaveBeenCalled()
    const readsAfterUnmount = api.getSnapshot.mock.calls.length
    window.dispatchEvent(new Event('focus'))
    expect(api.getSnapshot).toHaveBeenCalledTimes(readsAfterUnmount)
    if (originalVisibility) Object.defineProperty(document, 'visibilityState', originalVisibility)
    else delete document.visibilityState
    intervalSpy.mockRestore()
    clearIntervalSpy.mockRestore()
  })
})
