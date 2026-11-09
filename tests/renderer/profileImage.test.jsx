import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import Sidebar from '../../src/components/Sidebar'
import usePeerStore from '../../src/store/usePeerStore'

jest.mock('../../src/components/SettingsPanel', () => () => null)
jest.mock('../../src/components/BookmarksPanel', () => () => null)

describe('profile image recovery', () => {
  beforeEach(() => {
    window.electronAPI = { onPeerConnecting: jest.fn(() => () => {}) }
    usePeerStore.setState({ onlinePeers: [{ peerId: 'peer', nickname: 'Peer', profileImageUrl: 'http://127.0.0.1:1111/profile/avatar.png' }], pastDMPeers: [] })
  })

  it('shows an updated image after the previous URL failed', () => {
    render(<Sidebar onShowPatchNotes={() => {}} />)
    fireEvent.error(screen.getByAltText('Peer'))
    act(() => usePeerStore.getState().updatePeer('peer', { profileImageUrl: 'http://127.0.0.1:2222/profile/avatar.png' }))
    const image = screen.getByAltText('Peer')
    fireEvent.load(image)
    expect(image).toBeVisible()
    expect(image.src).toContain(':2222/')
  })
})
