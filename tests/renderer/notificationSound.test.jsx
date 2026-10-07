import React from 'react'
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import SettingsPanel from '../../src/components/SettingsPanel'
import useNotificationSound from '../../src/hooks/useNotificationSound'
import useUserStore from '../../src/store/useUserStore'

describe('notification sound settings', () => {
  let audioInstances
  let audioConstructor
  let createObjectURL

  beforeEach(() => {
    jest.useFakeTimers()
    useUserStore.setState({
      notificationSound: 'notification1',
      notificationVolume: 0.7,
      notificationCustomSoundBuffer: null,
      notificationScope: 'all',
      notificationHideBody: false,
    })
    audioInstances = []
    audioConstructor = jest.spyOn(window, 'Audio').mockImplementation(source => {
      const audio = { source, volume: 1, play: jest.fn().mockResolvedValue(), addEventListener: jest.fn() }
      audioInstances.push(audio)
      return audio
    })
    createObjectURL = URL.createObjectURL
    URL.createObjectURL = jest.fn().mockReturnValue('blob:custom-notification')
    window.electronAPI = { saveNotificationSettings: jest.fn().mockResolvedValue() }
  })

  afterEach(() => {
    jest.useRealTimers()
    audioConstructor.mockRestore()
    URL.createObjectURL = createObjectURL
  })

  it('previews the selected sound on the first click', async () => {
    const { container } = render(<SettingsPanel onClose={jest.fn()} />)
    fireEvent.click(container.querySelector('.lucide-bell').closest('button'))
    fireEvent.click(container.querySelectorAll('.lucide-play')[1].closest('button'))
    await act(async () => jest.advanceTimersByTime(50))

    expect(useUserStore.getState().notificationSound).toBe('notification2')
    expect(audioInstances).toHaveLength(1)
    expect(audioInstances[0].source).toBe('./assets/sounds/notification2.mp3')
    expect(audioInstances[0].play).toHaveBeenCalledTimes(1)
  })

  it('keeps uploaded audio playable after adjusting the volume', async () => {
    const customSoundBuffer = new Uint8Array([1, 2, 3])
    useUserStore.setState({ notificationSound: 'custom', notificationCustomSoundBuffer: customSoundBuffer })
    const { container } = render(<SettingsPanel onClose={jest.fn()} />)
    fireEvent.click(container.querySelector('.lucide-bell').closest('button'))
    fireEvent.change(screen.getByRole('slider'), { target: { value: '0.5' } })
    const { result } = renderHook(() => useNotificationSound())
    await act(async () => result.current.play())

    expect(audioInstances[0].source).toBe('blob:custom-notification')
    expect(audioInstances[0].volume).toBe(0.5)
    expect(useUserStore.getState().notificationCustomSoundBuffer).toBe(customSoundBuffer)
  })

  it('keeps uploaded audio when updating scope and allows explicit removal', () => {
    const customSoundBuffer = new Uint8Array([1, 2, 3])
    useUserStore.setState({ notificationSound: 'custom', notificationCustomSoundBuffer: customSoundBuffer })
    useUserStore.getState().setNotificationSettings({ sound: 'custom', volume: 0.7, scope: 'dm', hideBody: true })
    expect(useUserStore.getState().notificationCustomSoundBuffer).toBe(customSoundBuffer)

    useUserStore.getState().setNotificationSettings({ sound: 'custom', volume: 0.7, customSoundBuffer: null })
    expect(useUserStore.getState().notificationCustomSoundBuffer).toBeNull()
  })
})
