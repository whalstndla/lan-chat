import React from 'react'
import { act, fireEvent, render, waitFor } from '@testing-library/react'
import useAuthStore from '../../src/store/useAuthStore'
import SettingsPanel from '../../src/components/SettingsPanel'

jest.mock('../../src/assets/logo.png', () => 'logo.png')
jest.mock('../../src/hooks/useChatSubscriptions', () => ({ __esModule: true, default: jest.fn() }))
jest.mock('../../src/components/SetupScreen', () => ({ __esModule: true, default: () => <div /> }))
jest.mock('../../src/components/LoginScreen', () => ({ __esModule: true, default: () => <div /> }))
jest.mock('../../src/components/Sidebar', () => ({ __esModule: true, default: () => <div /> }))
jest.mock('../../src/components/ChatWindow', () => ({ __esModule: true, default: () => <div /> }))
jest.mock('../../src/components/PatchNotes', () => ({ __esModule: true, default: () => <div /> }))
jest.mock('../../src/components/KeyChangeWarningModal', () => ({ __esModule: true, default: () => <div /> }))
jest.mock('../../src/components/lanpet/LanpetLauncher', () => ({ __esModule: true, default: () => <div /> }))

let listeners
let App

beforeEach(() => {
  listeners = {}
  const subscribe = channel => callback => {
    listeners[channel] = callback
    return () => { delete listeners[channel] }
  }
  window.electronAPI = {
    platform: 'darwin',
    onUpdateAvailable: subscribe('available'),
    onUpdateNotAvailable: subscribe('not-available'),
    onUpdateDownloaded: subscribe('downloaded'),
    onUpdateError: subscribe('error'),
    onDownloadProgress: subscribe('progress'),
    checkForUpdates: jest.fn(async () => { listeners['not-available']?.() }),
    checkProfileExists: jest.fn().mockResolvedValue(false),
  }
  useAuthStore.setState({ authStatus: 'loading', authenticatedNickname: null })
  App = require('../../src/App').default
})

it('allows a manual recheck after the initial latest-version result', async () => {
  const { container } = render(<App />)
  await waitFor(() => expect(useAuthStore.getState().authStatus).toBe('setup'))
  act(() => useAuthStore.getState().completeAuth('Update QA'))
  const button = container.querySelector('button')
  expect(button).toBeEnabled()
  await act(async () => fireEvent.click(button))
  expect(window.electronAPI.checkForUpdates).toHaveBeenCalledTimes(2)
  expect(window.electronAPI.checkProfileExists).toHaveBeenCalledTimes(1)
})

it('handles an IPC rejection without leaving settings stuck checking', async () => {
  window.electronAPI.checkForUpdates.mockRejectedValue(new Error('Update service unavailable'))
  const { container } = render(<SettingsPanel onClose={jest.fn()} />)
  fireEvent.click(container.querySelector('.lucide-info').closest('button'))
  const button = container.querySelector('.lucide-download').closest('button')
  await act(async () => fireEvent.click(button))
  expect(button).toBeEnabled()
  expect(container).toHaveTextContent('Update service unavailable')
})
