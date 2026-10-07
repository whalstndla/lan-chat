import React from 'react'
import { act, render, waitFor } from '@testing-library/react'
import LanpetScene from '../../src/components/lanpet/LanpetScene'
import { createPetScene } from '../../src/components/lanpet/three/scene'

jest.mock('../../src/components/lanpet/three/scene', () => ({ createPetScene: jest.fn() }))

describe('Three scene ownership', () => {
  let intersection
  let visibility
  let runtimes
  beforeEach(() => {
    runtimes = []
    createPetScene.mockImplementation(() => {
      const runtime = { update: jest.fn(), resize: jest.fn(), setActive: jest.fn(), dispose: jest.fn() }
      runtimes.push(runtime)
      return runtime
    })
    visibility = Object.getOwnPropertyDescriptor(document, 'visibilityState')
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    window.WebGL2RenderingContext = class {}
    window.matchMedia = () => ({ matches: false, addEventListener: jest.fn(), removeEventListener: jest.fn() })
    global.ResizeObserver = class { observe() {} disconnect() {} }
    global.IntersectionObserver = class { constructor(callback) { intersection = callback } observe() {} disconnect() {} }
  })
  afterEach(() => {
    delete window.WebGL2RenderingContext
    delete global.ResizeObserver
    delete global.IntersectionObserver
    if (visibility) Object.defineProperty(document, 'visibilityState', visibility)
    else delete document.visibilityState
    jest.clearAllMocks()
  })

  test('mode changes replace the canvas so a disposed WebGL context is never reused', async () => {
    const view = render(<LanpetScene mode="race" />)
    await waitFor(() => expect(createPetScene).toHaveBeenCalledTimes(1))
    const firstCanvas = view.container.querySelector('canvas')
    view.rerender(<LanpetScene mode="memory" />)
    await waitFor(() => expect(createPetScene).toHaveBeenCalledTimes(2))
    expect(view.container.querySelector('canvas')).not.toBe(firstCanvas)
    expect(runtimes[0].dispose).toHaveBeenCalledTimes(1)
    view.unmount()
    expect(runtimes[1].dispose).toHaveBeenCalledTimes(1)
  })

  test('pauses rendering outside the viewport and when the document is hidden', async () => {
    const view = render(<LanpetScene />)
    await waitFor(() => expect(createPetScene).toHaveBeenCalledTimes(1))
    act(() => intersection([{ isIntersecting: false }]))
    expect(runtimes[0].setActive).toHaveBeenLastCalledWith(false, false)
    act(() => intersection([{ isIntersecting: true }]))
    expect(runtimes[0].setActive).toHaveBeenLastCalledWith(true, false)
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    expect(runtimes[0].setActive).toHaveBeenLastCalledWith(false, false)
    view.unmount()
  })
})
