// src/hooks/useFileDownload.js
// 파일/이미지 다운로드 공용 로직 — IPC 호출 + 저장 완료 후 "폴더에서 보기" 상태 관리.
// Message.jsx(첨부파일·비디오 저장) 와 ImageLightbox.jsx("다른 이름으로 저장") 에서 공용으로 사용한다.

import { useCallback, useEffect, useRef, useState } from 'react'

const SAVED_TOAST_AUTO_HIDE_MS = 5000

export default function useFileDownload() {
  const [savedPath, setSavedPath] = useState(null)
  const hideTimerRef = useRef(null)

  useEffect(() => () => clearTimeout(hideTimerRef.current), [])

  const dismissSaved = useCallback(() => {
    clearTimeout(hideTimerRef.current)
    setSavedPath(null)
  }, [])

  // messageId 로 원본 파일을 복호화해 사용자가 선택한 위치에 저장 ("다른 이름으로 저장" 다이얼로그)
  const downloadFile = useCallback(async (messageId) => {
    const result = await window.electronAPI.downloadFile(messageId)
    if (!result || result.canceled) return
    if (!result.ok) {
      window.alert('파일 저장에 실패했습니다.')
      return
    }
    setSavedPath(result.path)
    clearTimeout(hideTimerRef.current)
    hideTimerRef.current = setTimeout(() => setSavedPath(null), SAVED_TOAST_AUTO_HIDE_MS)
  }, [])

  // 저장된 파일을 OS 파일 탐색기에서 보여주기
  const revealInFolder = useCallback(() => {
    if (!savedPath) return
    window.electronAPI.showItemInFolder(savedPath)
    dismissSaved()
  }, [savedPath, dismissSaved])

  return { downloadFile, savedPath, revealInFolder, dismissSaved }
}
