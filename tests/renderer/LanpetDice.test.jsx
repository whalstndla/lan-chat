import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import LanpetRace from '../../src/components/lanpet/LanpetRace'
import { Notice, PeerLimit, ReadyTime, usePetClock } from '../../src/components/lanpet/LanpetNotice'
import { WorldShop } from '../../src/components/lanpet/LanpetWorld'
import { FOODS, DECORATIONS } from '../../electron/lanpet/world'

describe('Lanpet dice controls and explained limits', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date('2026-09-08T01:00:00Z')) })
  afterEach(() => jest.useRealTimers())

  test('race sends only a roll request and prevents a second roll while waiting', () => {
    const command = jest.fn()
    const session = { sessionId: 'race', ruleVersion: 2, activity: 'race', status: 'inProgress', turn: 1, turnEndsAt: Date.now() + 15000, serverNow: Date.now(), peerName: '친구', raceProgress: { own: 0, peer: 0 } }
    const view = render(<LanpetRace session={session} command={command} />)
    fireEvent.click(screen.getByRole('button', { name: '주사위 굴리기' }))
    expect(command).toHaveBeenCalledWith({ type: 'action', sessionId: 'race', choice: 'roll' })
    expect(screen.queryByRole('button', { name: '달리기' })).not.toBeInTheDocument()
    view.rerender(<LanpetRace session={{ ...session, ownChoice: 'roll' }} command={command} />)
    expect(screen.getByRole('button', { name: '친구의 주사위를 기다리는 중…' })).toBeDisabled()
    expect(screen.getByText(/15초 안에 누르지 않으면 자동/)).toBeInTheDocument()
  })

  test('expired turns explain automatic rolling and do not accept a late click', () => {
    const session = { sessionId: 'race', ruleVersion: 2, status: 'inProgress', turn: 1, turnEndsAt: Date.now() + 15000, serverNow: Date.now() }
    render(<LanpetRace session={session} command={jest.fn()} />)
    act(() => jest.advanceTimersByTime(15000))
    expect(screen.getByRole('button', { name: '주사위 굴리기' })).toBeDisabled()
    expect(screen.getByText(/시간이 끝나 자동으로 굴리고/)).toBeInTheDocument()
  })

  test('uses main-process time and counts down to an exact next-use boundary', () => {
    const server = Date.now() + 3 * 3600000
    function Timer() { const now = usePetClock(server); return <ReadyTime at={server + 61000} now={now} /> }
    render(<Timer />)
    expect(screen.getByText('1분 1초 남음')).toBeInTheDocument()
    act(() => jest.advanceTimersByTime(2000))
    expect(screen.getByText('59초 남음')).toBeInTheDocument()
    act(() => jest.advanceTimersByTime(59000))
    expect(screen.queryByText(/초 남음/)).not.toBeInTheDocument()
  })

  test('shows the reason and exact 10-minute legacy cooldown before the user retries', () => {
    render(<PeerLimit peer={{ inviteCooldownSeconds: 600, supportsDice: false, inviteReadyAt: Date.now() + 600000 }} now={Date.now()} />)
    expect(screen.getByText(/활동 종류와 관계없이 최초 초대 후 10분/)).toBeInTheDocument()
    expect(screen.getByText('10분 0초 남음')).toBeInTheDocument()
    expect(screen.getByText(/친구도 v0.15.0 이상/)).toBeInTheDocument()
  })

  test('feed and free snack have separate visible deadlines and unlock at the right time', () => {
    const snapshot = { enabled: true, isWorkingTime: true, serverNow: Date.now(), pet: { lifecycleState: 'active' }, world: { balance: 100, foods: FOODS, decorations: DECORATIONS, room: {}, bag: { rice: 2 }, owned: [], feedReadyAt: Date.now() + 300000, snackReadyAt: Date.now() + 3600000 } }
    render(<WorldShop snapshot={snapshot} command={jest.fn()} />)
    expect(screen.getAllByRole('button', { name: '먹이 주기' })[0]).toBeDisabled()
    expect(screen.getByRole('button', { name: '무료 간식 주기' })).toBeDisabled()
    act(() => jest.advanceTimersByTime(300000))
    expect(screen.getAllByRole('button', { name: '먹이 주기' })[0]).toBeEnabled()
    expect(screen.getByRole('button', { name: '무료 간식 주기' })).toBeDisabled()
    expect(screen.getByText('55분 0초 남음')).toBeInTheDocument()
  })

  test('rejected commands show a readable reason and retry time rather than a generic failure', () => {
    render(<Notice notice={{ kind: 'error', message: '초대 대기시간이 적용됐어요.', explanation: '취소한 초대는 30초를 기다려요.', retryAt: Date.now() + 30000 }} now={Date.now()} />)
    expect(screen.getByRole('alert')).toHaveTextContent('취소한 초대는 30초')
    expect(screen.getByText('30초 남음')).toBeInTheDocument()
  })
})
