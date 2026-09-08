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
    await waitFor(() => expect(screen.queryByText('Opening your little world…')).not.toBeInTheDocument())
    return result
  }

  it('shows an explicit unavailable state instead of a simulated pet when the API is absent', async () => {
    window.electronAPI = {}
    render(<LanpetPanel onClose={jest.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Lanpet is unavailable')
    expect(screen.queryByText('Moss')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Welcome home' })).not.toBeInTheDocument()
  })

  it('does not offer onboarding when the main process reports a closed session', async () => {
    snapshot = makeSnapshot({ pet: null, error: { code: 'SESSION_CLOSED', message: 'Please sign in again.' } })
    await openPanel()
    expect(screen.getByRole('alert')).toHaveTextContent('Please sign in again.')
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument()
  })

  it('creates through the API after three steps and keeps sharing private unless selected', async () => {
    snapshot = makeSnapshot({ pet: null, enabled: false })
    api.command.mockImplementation(async request => {
      snapshot = makeSnapshot({ pet: { ...makeSnapshot().pet, name: request.name } })
      return { ok: true, snapshot }
    })
    await openPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.change(screen.getByLabelText('Pet name'), { target: { value: 'Pebble' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByRole('checkbox')).not.toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Welcome home' }))
    expect(await screen.findByRole('heading', { name: 'Pebble' })).toBeInTheDocument()
    expect(api.command).toHaveBeenCalledTimes(1)
    expect(api.command).toHaveBeenCalledWith({ type: 'create', name: 'Pebble', requestId: 'request-ui-1' })
  })

  it('does not allow duplicated care while a command is in flight and reads the returned state', async () => {
    let resolveCommand
    api.command.mockImplementation(() => new Promise(resolve => { resolveCommand = resolve }))
    await openPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Care' }))
    fireEvent.click(screen.getByRole('button', { name: 'Care' }))
    expect(api.command).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled()
    await act(async () => resolveCommand({ ok: true, snapshot: makeSnapshot({ pet: { ...snapshot.pet, care: 91 } }) }))
    expect(screen.getByRole('meter', { name: 'Care' })).toHaveAttribute('value', '91')
    expect(screen.getByRole('button', { name: 'Care' })).toBeEnabled()
  })

  it('freezes care outside office hours and offers a return action only for a resting-away pet', async () => {
    snapshot = makeSnapshot({ isWorkingTime: false, pet: { ...snapshot.pet, lifecycleState: 'resting' } })
    await openPanel()
    expect(screen.getByRole('button', { name: 'Care' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Welcome back' })).not.toBeInTheDocument()
    act(() => changed(makeSnapshot({ pet: { ...snapshot.pet, lifecycleState: 'restingAway' } })))
    fireEvent.click(screen.getByRole('button', { name: 'Welcome back' }))
    await waitFor(() => expect(api.command).toHaveBeenCalledWith(expect.objectContaining({ type: 'care', action: 'welcomeBack' })))
  })

  it('presents growth appearances and sends the exact offered choice without exposing its internal id', async () => {
    snapshot = makeSnapshot({ pet: { ...snapshot.pet, growthChoices: [{ choiceId: 'grown.calm.a', stage: 'grown', appearanceId: 'grown-calm-a', family: 'calm' }] } })
    await openPanel()
    expect(screen.queryByText('grown.calm.a')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Grow into Willow keeper' }))
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
    expect(screen.getByRole('status')).toHaveTextContent('30 minutes of office time. Ready around')
    expect(screen.getByRole('button', { name: 'Care' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /Friends/ }))
    expect(screen.getByRole('button', { name: 'Visit' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Accept' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Focus' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Decline' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'End session' })).toBeEnabled()
    act(() => changed({ ...snapshot, pet: { ...snapshot.pet, lifecycleState: 'active', napEndsAt: null } }))
    expect(screen.queryByText(/30 minutes of office time/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Visit' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Accept' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Focus' })).toBeEnabled()
  })

  it('requires pet sharing and disables offline, unsupported, and untrusted peers', async () => {
    const peer = { name: 'Alex', petName: 'Fern', stage: 'grown', online: true, supported: true, available: true, pendingKeyChange: false, activities: ['visit', 'cooperativePlay', 'gift', 'battle'] }
    snapshot = makeSnapshot({ peers: [{ ...peer, peerId: 'ready' }, { ...peer, peerId: 'offline', name: 'Offline friend', petName: 'Acorn', online: false }, { ...peer, peerId: 'old', name: 'Old friend', petName: 'Bud', supported: false }, { ...peer, peerId: 'key', name: 'Key friend', petName: 'Sprig', pendingKeyChange: true }] })
    await openPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Friends' }))
    expect(screen.getAllByRole('button', { name: 'Friendly battle' }).every(button => button.disabled)).toBe(true)
    act(() => changed({ ...snapshot, sharingEnabled: true }))
    const readyCard = screen.getByRole('heading', { name: 'Fern' }).closest('article')
    fireEvent.click(within(readyCard).getByRole('button', { name: 'Friendly battle' }))
    await waitFor(() => expect(api.command).toHaveBeenCalledWith(expect.objectContaining({ type: 'invite', peerId: 'ready', activity: 'battle' })))
    expect(screen.getByText('Identity check needed')).toBeInTheDocument()
    expect(screen.getByText('Update needed')).toBeInTheDocument()
    expect(screen.getByText('Offline')).toBeInTheDocument()
  })

  it('accepts and declines invitations using the session identity', async () => {
    snapshot = makeSnapshot({ sharingEnabled: true, invitations: [{ sessionId: 'invite-1', peerId: 'peer-1', peerName: 'Alex', activity: 'visit', direction: 'incoming', status: 'incomingPending' }] })
    await openPanel()
    fireEvent.click(screen.getByRole('button', { name: /Friends/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(api.command).toHaveBeenCalledWith(expect.objectContaining({ type: 'respond', sessionId: 'invite-1', response: 'accept' })))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Decline' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }))
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
    fireEvent.click(screen.getByRole('button', { name: /Friends/ }))
    expect(screen.getByRole('button', { name: 'Visit' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Accept' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Play is paused' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Decline' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'End session' })).toBeEnabled()
  })

  it('persists activity preferences and blocks invitations without changing chat settings', async () => {
    snapshot = makeSnapshot({ sharingEnabled: true, peers: [{ peerId: 'peer-1', name: 'Alex', petName: 'Fern', online: true, supported: true, available: true, activities: ['visit', 'cooperativePlay', 'gift', 'battle'] }] })
    await openPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Friendly battle/ }))
    await waitFor(() => expect(api.command).toHaveBeenCalledWith(expect.objectContaining({ type: 'settings', allowBattle: false })))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /Friendly battle/ })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Friends' }))
    fireEvent.click(screen.getByRole('button', { name: 'Block invitations' }))
    await waitFor(() => expect(api.command).toHaveBeenCalledWith(expect.objectContaining({ type: 'settings', blockedPeerIds: ['peer-1'] })))
    act(() => changed({ ...snapshot, blockedPeerIds: ['peer-1'] }))
    expect(screen.getByRole('button', { name: 'Visit' })).toBeDisabled()
    expect(screen.getByText('Invitations blocked')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Unblock invitations' }))
    await waitFor(() => expect(api.command).toHaveBeenCalledWith(expect.objectContaining({ type: 'settings', blockedPeerIds: [] })))
  })

  it('sends a real battle choice and locks moves until the peer resolves the round', async () => {
    const session = { sessionId: 'battle-1', peerName: 'Alex', activity: 'battle', status: 'inProgress', turn: 1, totalTurns: 5, ownChoice: null, waitingForPeer: false, turnEndsAt: Date.now() + 15000 }
    snapshot = makeSnapshot({ sharingEnabled: true, sessions: [session] })
    api.command.mockImplementation(async () => ({ ok: true, snapshot: { ...snapshot, sessions: [{ ...session, ownChoice: 'focus', waitingForPeer: true }] } }))
    await openPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Friends' }))
    expect(screen.getByText('ROUND 1 / 5')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Focus' }))
    await waitFor(() => expect(api.command).toHaveBeenCalledWith(expect.objectContaining({ type: 'action', sessionId: 'battle-1', choice: 'focus' })))
    expect(await screen.findByText('Move sent. Waiting for your friend…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Spark' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'End session' }))
    await waitFor(() => expect(api.command).toHaveBeenCalledWith(expect.objectContaining({ type: 'end', sessionId: 'battle-1' })))
  })

  it('retries an uncertain command with its original request id', async () => {
    api.command.mockRejectedValueOnce(new Error('Response interrupted'))
    await openPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Tidy' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Response interrupted')
    const firstRequest = api.command.mock.calls[0][0]
    window.crypto.randomUUID.mockReturnValue('a-different-id')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(api.command).toHaveBeenCalledTimes(2))
    expect(api.command.mock.calls[1][0]).toEqual(firstRequest)
  })

  it('shows real inventory and requires a separate confirmation before deletion', async () => {
    snapshot = makeSnapshot({ inventory: [{ itemType: 'friendshipStar', quantity: 2, updatedAt: Date.now() }] })
    await openPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Journal' }))
    expect(screen.getByText('Friendship star')).toBeInTheDocument()
    expect(screen.getByText('×2')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete pet…' }))
    expect(api.command).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Keep my pet' }))
    expect(screen.queryByRole('button', { name: 'Delete permanently' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Delete pet…' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'Journal' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(screen.getByText('Send keepsake with Fern')).toBeInTheDocument()
    expect(screen.getByText('A new friend arrived')).toBeInTheDocument()
    expect(screen.getByText('Visit')).toBeInTheDocument()
    expect(screen.queryByText('social.gift')).not.toBeInTheDocument()
    expect(screen.queryByText('pet.created')).not.toBeInTheDocument()
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
    expect(screen.getByRole('button', { name: 'Care' })).toBeDisabled()
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
