import { useCallback, useEffect, useRef, useState } from 'react'

export default function useLanpet() {
  const [snapshot, setSnapshot] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const active = useRef(true)
  const busyReference = useRef(false)
  const snapshotSequence = useRef(0)
  const failedCommand = useRef(null)
  const api = window.electronAPI?.lanpet

  const refresh = useCallback(async ({ silent = false } = {}) => {
    if (!api?.getSnapshot) {
      setError({ code: 'unavailable', message: 'Lanpet is unavailable in this app version. Update LAN Chat and reopen this panel.' })
      setLoading(false)
      return
    }
    const sequence = snapshotSequence.current
    if (!silent) setLoading(true)
    try {
      const nextSnapshot = await api.getSnapshot()
      if (!active.current) return
      if (nextSnapshot?.ok === false) throw new Error(nextSnapshot.message || 'Unable to load Lanpet.')
      if (sequence === snapshotSequence.current) setSnapshot(nextSnapshot)
      setError(null)
    } catch (failure) {
      if (active.current) setError({ code: 'loadFailed', message: failure.message || 'Unable to load Lanpet. Please try again.' })
    } finally {
      if (active.current && !silent) setLoading(false)
    }
  }, [api])

  useEffect(() => {
    active.current = true
    const unsubscribe = api?.onChanged?.((nextSnapshot) => {
      if (!active.current) return
      snapshotSequence.current += 1
      setSnapshot(nextSnapshot)
    })
    refresh()
    // 열린 패널이 보일 때만 시각 경계를 갱신하고 숨겨진 창에서는 DB 조회를 멈춘다.
    const refreshWhenVisible = () => {
      if (document.visibilityState !== 'hidden') refresh({ silent: true })
    }
    const refreshTimer = setInterval(refreshWhenVisible, 30000)
    window.addEventListener('focus', refreshWhenVisible)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      active.current = false
      unsubscribe?.()
      clearInterval(refreshTimer)
      window.removeEventListener('focus', refreshWhenVisible)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [api, refresh])

  const command = useCallback(async (payload, retry = false) => {
    if (busyReference.current || !api?.command) return false
    const request = retry ? payload : { ...payload, requestId: window.crypto.randomUUID() }
    busyReference.current = true
    setBusy(true)
    setError(null)
    failedCommand.current = null
    try {
      const result = await api.command(request)
      if (!active.current) return false
      if (!result?.ok) {
        setError({ code: result?.code || 'commandFailed', message: result?.message || 'This action could not be completed.' })
        return false
      }
      if (result.snapshot) {
        snapshotSequence.current += 1
        setSnapshot(result.snapshot)
      }
      return true
    } catch (failure) {
      if (active.current) {
        // 응답이 유실된 재시도는 같은 식별자로 보내 중복 보상을 막는다.
        failedCommand.current = request
        setError({ code: 'connectionLost', message: failure.message || 'The result could not be confirmed. Retry safely with the same request.' })
      }
      return false
    } finally {
      busyReference.current = false
      if (active.current) setBusy(false)
    }
  }, [api])

  const retry = () => {
    if (failedCommand.current) return command(failedCommand.current, true)
    return refresh()
  }

  return { snapshot, loading, busy, error, command, refresh, retry }
}
