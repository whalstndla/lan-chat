import React, { useEffect, useRef, useState } from 'react'

export default function LanpetScene({ mode = 'room', residents = [], room, roaming = false, resting = false, effect, distances, die, rolling, cue, label = '랜펫 입체 놀이방' }) {
  const host = useRef(null)
  const canvas = useRef(null)
  const runtime = useRef(null)
  const latest = useRef(null)
  const [status, setStatus] = useState('loading')
  const [retry, setRetry] = useState(0)
  latest.current = { residents, room, roaming, resting, effect, distances, die, rolling, cue }
  useEffect(() => {
    if (!window.WebGL2RenderingContext) { setStatus('unavailable'); return undefined }
    let canceled = false
    let intersection = true
    let observer
    let resizeObserver
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')
    const syncActive = () => runtime.current?.setActive(intersection && document.visibilityState !== 'hidden', reduce.matches)
    const resize = () => { const bounds = host.current?.getBoundingClientRect(); if (bounds) runtime.current?.resize(bounds.width, bounds.height) }
    const lost = event => { event.preventDefault(); runtime.current?.setActive(false); host.current.dataset.failure = 'context-lost'; setStatus('unavailable') }
    setStatus('loading')
    import('./three/scene').then(({ createPetScene }) => {
      if (canceled) return
      try {
        runtime.current = createPetScene(canvas.current, { mode })
        runtime.current.update(latest.current)
        resize(); syncActive()
        delete host.current.dataset.failure
        setStatus('ready')
        resizeObserver = new ResizeObserver(resize); resizeObserver.observe(host.current)
        observer = new IntersectionObserver(entries => { intersection = entries[0].isIntersecting; syncActive() }); observer.observe(host.current)
      } catch (error) { if (host.current) host.current.dataset.failure = error.message; runtime.current?.dispose(); runtime.current = null; setStatus('unavailable') }
    }).catch(error => { if (!canceled) { if (host.current) host.current.dataset.failure = error.message; setStatus('unavailable') } })
    const target = canvas.current
    target.addEventListener('webglcontextlost', lost)
    document.addEventListener('visibilitychange', syncActive)
    reduce.addEventListener?.('change', syncActive)
    return () => {
      canceled = true; observer?.disconnect(); resizeObserver?.disconnect()
      target.removeEventListener('webglcontextlost', lost)
      document.removeEventListener('visibilitychange', syncActive)
      reduce.removeEventListener?.('change', syncActive)
      runtime.current?.dispose(); runtime.current = null
    }
  }, [mode, retry])
  useEffect(() => { runtime.current?.update(latest.current) })
  return <div ref={host} className={`lanpet-three-scene scene-${mode}`} data-renderer={status}>
    <canvas key={`${mode}:${retry}`} ref={canvas} role="img" aria-label={label} />
    {status === 'loading' && <span className="pet-scene-loading" role="status">작은 세상을 여는 중…</span>}
    {status === 'unavailable' && <div className="pet-scene-fallback" role="status"><strong>입체 화면을 잠시 쉬고 있어요</strong><p>그래픽 화면을 열지 못했어요. 아래 버튼으로 돌봄과 게임은 계속할 수 있어요.</p><button className="lanpet-button" onClick={() => setRetry(value => value + 1)}>입체 화면 다시 열기</button></div>}
  </div>
}
