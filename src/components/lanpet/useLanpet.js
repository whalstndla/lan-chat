import { useCallback, useEffect, useRef, useState } from 'react'

export default function useLanpet() {
  const [snapshot, setSnapshot] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [effect, setEffect] = useState(null)
  const snapshotReference = useRef(null)
  snapshotReference.current = snapshot
  const active = useRef(true)
  const busyReference = useRef(false)
  const snapshotSequence = useRef(0)
  const failedCommand = useRef(null)
  const api = window.electronAPI?.lanpet

  const refresh = useCallback(async ({ silent = false } = {}) => {
    if (!api?.getSnapshot) {
      setError({ code: 'unavailable', message: '이 앱 버전에서는 랜펫을 사용할 수 없어요. 랜챗을 업데이트한 뒤 다시 열어 주세요.' })
      setLoading(false)
      return
    }
    const sequence = snapshotSequence.current
    if (!silent) setLoading(true)
    try {
      const nextSnapshot = await api.getSnapshot()
      if (!active.current) return
      if (nextSnapshot?.ok === false) throw new Error('LANPET_LOAD_FAILED')
      if (sequence === snapshotSequence.current) setSnapshot(nextSnapshot)
      setError(null)
    } catch {
      if (active.current) setError({ code: 'loadFailed', message: '랜펫을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.' })
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
        setError({ code: result?.code || 'commandFailed', kind: 'error', message: result?.message || '이 활동을 마치지 못했어요. 다시 시도해 주세요.', retryAt: result?.retryAt, explanation: result?.explanation })
        setNotice(null)
        return false
      }
      if (result.snapshot) {
        const before = snapshotReference.current
        const after = result.snapshot
        const feedback = successfulNotice(payload, before, after)
        if (feedback) setNotice(feedback)
        if (['care', 'feed', 'grow', 'equip', 'lottery', 'gameAction'].includes(payload.type)) setEffect({ id: request.requestId, kind: payload.action || payload.type })
        snapshotSequence.current += 1
        setSnapshot(result.snapshot)
      }
      return true
    } catch {
      if (active.current) {
        // 응답이 유실된 재시도는 같은 식별자로 보내 중복 보상을 막는다.
        failedCommand.current = request
        setError({ code: 'connectionLost', message: '결과를 확인하지 못했어요. 다시 시도를 누르면 같은 요청으로 안전하게 확인해요.' })
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

  return { snapshot, loading, busy, error, notice, effect, dismissNotice: () => { setError(null); setNotice(null) }, command, refresh, retry }
}

function successfulNotice(input, before, after) {
  const now = after.serverNow || Date.now()
  const feedback = { kind: 'success', title: '완료했어요' }
  if (input.type === 'feed') return { ...feedback, title: '맛있게 먹었어요!', message: '돌봄·즐거움·에너지가 회복됐어요. 먹이는 5분마다, 무료 간식은 1시간마다 줄 수 있어요.', retryAt: input.itemId === 'snack' ? after.world?.snackReadyAt : after.world?.feedReadyAt }
  if (input.type === 'care') {
    if (input.action === 'rest') return { ...feedback, title: '포근한 낮잠을 시작했어요', message: '업무시간 기준 30분 동안 돌봄과 교류를 쉬어요. 낮잠을 마치면 에너지가 회복돼요.', retryAt: after.pet?.napEndsAt }
    const repeated = before?.careRepeatReadyAt?.[input.action] > now
    return { ...feedback, title: '마음이 전해졌어요', message: repeated ? '같은 돌봄을 30분 안에 반복해서 효과가 기본의 25%로 적용됐어요. 충분히 쉰 뒤에는 온전한 효과를 받을 수 있어요.' : '펫의 상태와 성장에 반영했어요. 같은 돌봄을 30분 안에 반복하면 효과는 25%예요. 유대·성장에는 최근 24시간 한도가 있어요.', retryAt: after.careRepeatReadyAt?.[input.action], readyLabel: '온전한 효과' }
  }
  if (input.type === 'buy') return { ...feedback, title: '가방에 담았어요', message: '구입한 먹이는 먹이 주기를, 가구와 벽지는 방에 놓기를 눌러 사용해요.' }
  if (input.type === 'equip') return { ...feedback, title: '우리 방이 달라졌어요', message: '구입한 장식은 계속 보관돼요. 언제든 다른 장식으로 바꿀 수 있어요.' }
  if (input.type === 'grow') return { ...feedback, title: '새로운 모습으로 자랐어요!', message: `${after.pet?.formName || '친구'}의 새 모습을 만나 보세요. 최종 진화의 경로는 함께한 활동으로 결정돼요.` }
  if (input.type === 'lottery') return { ...feedback, title: `${after.world?.lotteryPrize} 코인 당첨!`, message: '코인은 바로 지갑에 들어갔어요. 다음 무료 복권은 지금부터 24시간 뒤에 열 수 있어요.', retryAt: after.world?.lotteryReadyAt }
  if (input.type === 'gameStart') return { ...feedback, title: '놀이를 시작했어요', message: '60초 안에 5턴을 마쳐 주세요. 두 미니게임을 합해 최근 24시간에 5회 도전할 수 있고, 중도 종료도 1회로 계산돼요.' }
  if (input.type === 'gameAction' && after.world?.game?.status === 'completed') return { ...feedback, title: `${after.world.game.reward} 코인을 받았어요!`, message: '결과와 코인을 저장했어요. 다시 눌러도 같은 게임의 보상은 한 번만 지급돼요.' }
  if (input.type === 'invite') return { ...feedback, title: '초대를 보냈어요', message: input.activity === 'gift' ? '기념품은 24시간 안에 수락할 수 있어요. 최근 24시간에 최대 3개, 같은 친구에게는 1개를 보낼 수 있어요.' : '친구가 2분 안에 수락하면 시작해요. 경주·함께 놀기·배틀은 각각 에너지 6이 필요해요.' }
  if (input.type === 'settings') return { ...feedback, title: '설정을 저장했어요', message: '선택한 공개 범위와 활동 허용 설정이 적용됐어요.' }
  return null
}
