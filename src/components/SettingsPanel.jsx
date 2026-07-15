// src/components/SettingsPanel.jsx
import React, { useState, useRef, useEffect, useMemo } from 'react'
import { X, LogOut, Camera, Check, Volume2, Play, Trash2, User, Bell, Database, Info, ChevronLeft, Download, HardDrive, FolderOpen, FileDown, Monitor } from 'lucide-react'
import useAuthStore from '../store/useAuthStore'
import useUserStore from '../store/useUserStore'
import usePeerStore from '../store/usePeerStore'
import useChatStore from '../store/useChatStore'
import useNotificationSound from '../hooks/useNotificationSound'

// 설정 메뉴 항목 정의
const MENU_ITEMS = [
  { id: 'profile', label: '프로필', icon: User },
  { id: 'notification', label: '알림', icon: Bell },
  { id: 'display', label: '화면', icon: Monitor },
  { id: 'data', label: '데이터 관리', icon: Database },
  { id: 'app', label: '앱 정보', icon: Info },
]

// 테마 옵션(#73) — 다크가 기본값. '시스템'은 OS 다크모드 선호(prefers-color-scheme)를 따른다.
const THEME_OPTIONS_UI = [
  { value: 'dark', label: '다크' },
  { value: 'light', label: '라이트' },
  { value: 'system', label: '시스템' },
]

const SOUND_OPTIONS = [
  { value: 'notification1', label: '소리 1' },
  { value: 'notification2', label: '소리 2' },
  { value: 'notification3', label: '소리 3' },
  { value: 'notification4', label: '소리 4' },
  { value: 'custom', label: '직접 업로드' },
]

// 알림 범위 옵션(#29) — '멘션만'은 내가 언급된 메시지에만 알림을 받는다.
// notificationPolicy.shouldNotify 의 scope='mention' 분기와 매핑된다.
const NOTIFICATION_SCOPE_OPTIONS = [
  { value: 'all', label: '전체' },
  { value: 'dm', label: 'DM만' },
  { value: 'mention', label: '멘션만' },
  { value: 'off', label: '끄기' },
]

// 채팅 내보내기(#74) 옵션 — 범위(전체채팅/DM) + 형식(txt/json)
const EXPORT_SCOPE_OPTIONS = [
  { value: 'global', label: '전체채팅' },
  { value: 'dm', label: 'DM' },
]
const EXPORT_FORMAT_OPTIONS = [
  { value: 'txt', label: 'TXT' },
  { value: 'json', label: 'JSON' },
]

export default function SettingsPanel({ onClose }) {
  const { setAuthStatus } = useAuthStore()
  const { myNickname, myProfileImageUrl, updateMyNickname, updateMyProfileImageUrl, reset: resetUser } = useUserStore()
  const { clearAllPeers, clearPastDMPeers } = usePeerStore()
  const { resetAll } = useChatStore()

  const notificationSound = useUserStore(state => state.notificationSound)
  const notificationVolume = useUserStore(state => state.notificationVolume)
  const notificationScope = useUserStore(state => state.notificationScope)
  const notificationHideBody = useUserStore(state => state.notificationHideBody)
  const { setNotificationSettings } = useUserStore()
  const { play: playNotification } = useNotificationSound()

  // 테마(#73)
  const theme = useUserStore(state => state.theme)
  const { setTheme } = useUserStore()

  // 현재 선택된 메뉴 (null이면 메뉴 목록 표시)
  const [activeMenu, setActiveMenu] = useState(null)

  const [nicknameInput, setNicknameInput] = useState(myNickname || '')
  const [isSaving, setIsSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordMessage, setPasswordMessage] = useState(null)
  const [confirmAction, setConfirmAction] = useState(null)
  const [updateState, setUpdateState] = useState('idle') // 'idle' | 'checking' | 'available' | 'downloaded' | 'not-available' | 'error'
  const [updateErrorMessage, setUpdateErrorMessage] = useState(null)
  const fileInputRef = useRef(null)
  const soundFileInputRef = useRef(null)

  // 링크 미리보기(외부 서버 OG 요청) 사용 여부 — 기본 on, 마운트 시 main 에서 로드(#66)
  const [linkPreviewEnabled, setLinkPreviewEnabled] = useState(true)
  useEffect(() => {
    let cancelled = false
    window.electronAPI.getLinkPreviewEnabled?.().then((value) => {
      if (!cancelled) setLinkPreviewEnabled(value !== false) // 미정의/실패 시 기본 on
    })
    return () => { cancelled = true }
  }, [])

  async function handleLinkPreviewToggle(nextEnabled) {
    setLinkPreviewEnabled(nextEnabled)
    await window.electronAPI.setLinkPreviewEnabled?.(nextEnabled)
  }

  // 로그인 시 자동 시작(#71) — supported 는 OS 지원 여부(Linux 는 false), 마운트 시 main 에서 로드
  const [autoLaunchSettings, setAutoLaunchSettings] = useState({ supported: true, openAtLogin: false, startHidden: false })
  useEffect(() => {
    let cancelled = false
    window.electronAPI.getAutoLaunchSettings?.().then((value) => {
      if (!cancelled && value) setAutoLaunchSettings(value)
    })
    return () => { cancelled = true }
  }, [])

  async function handleAutoLaunchToggle(nextOpenAtLogin) {
    // 자동 시작을 끄면 "숨김 시작"도 의미가 없으므로 함께 끈다.
    const nextSettings = { openAtLogin: nextOpenAtLogin, startHidden: nextOpenAtLogin && autoLaunchSettings.startHidden }
    setAutoLaunchSettings((prev) => ({ ...prev, ...nextSettings }))
    const result = await window.electronAPI.setAutoLaunchSettings?.(nextSettings)
    if (result) setAutoLaunchSettings(result)
  }

  async function handleStartHiddenToggle(nextStartHidden) {
    const nextSettings = { openAtLogin: autoLaunchSettings.openAtLogin, startHidden: nextStartHidden }
    setAutoLaunchSettings((prev) => ({ ...prev, ...nextSettings }))
    const result = await window.electronAPI.setAutoLaunchSettings?.(nextSettings)
    if (result) setAutoLaunchSettings(result)
  }

  // 저장소 사용량(#74) — DB(+ -wal/-shm), files/, file_cache/, sounds/ 각 크기. '데이터 관리' 탭
  // 진입 시에만 조회한다(다른 탭에서는 굳이 디스크를 스캔할 필요 없음).
  const [storageUsage, setStorageUsage] = useState(null)
  const [confirmClearCache, setConfirmClearCache] = useState(false)
  const [cacheClearMessage, setCacheClearMessage] = useState(null)

  async function refreshStorageUsage() {
    const usage = await window.electronAPI.getStorageUsage?.()
    if (usage) setStorageUsage(usage)
  }

  useEffect(() => {
    if (activeMenu !== 'data') return
    let cancelled = false
    window.electronAPI.getStorageUsage?.().then((usage) => { if (!cancelled) setStorageUsage(usage) })
    return () => { cancelled = true }
  }, [activeMenu])

  // 캐시 비우기(#74) — file_cache/ 표시용 캐시만 지운다. 메시지·DB 는 그대로 유지되며,
  // 다음 열람 시 상대가 온라인이면 자동으로 재요청해 복구된다("메시지 삭제"와는 다르다).
  async function handleClearFileCache() {
    const result = await window.electronAPI.clearFileCache?.()
    setConfirmClearCache(false)
    setCacheClearMessage(
      result?.ok ? `캐시 파일 ${result.removedCount}개를 삭제했습니다.` : '캐시 비우기에 실패했습니다.'
    )
    await refreshStorageUsage()
    setTimeout(() => setCacheClearMessage(null), 3000)
  }

  // 기본 다운로드 폴더 설정(#74) — 미지정 시 OS 기본 다운로드 폴더 사용
  const [downloadFolder, setDownloadFolderInfo] = useState(null) // { folderPath, osDefaultPath }
  useEffect(() => {
    let cancelled = false
    window.electronAPI.getDownloadFolder?.().then((value) => { if (!cancelled) setDownloadFolderInfo(value) })
    return () => { cancelled = true }
  }, [])

  async function handleChooseDownloadFolder() {
    const result = await window.electronAPI.setDownloadFolder?.()
    if (result?.ok) setDownloadFolderInfo((prev) => ({ ...prev, folderPath: result.folderPath }))
  }

  // 채팅 내보내기(#74) — 범위(전체채팅/DM) + 형식(txt/json) 선택 후 저장 다이얼로그로 내보낸다.
  const pastDMPeers = usePeerStore(state => state.pastDMPeers)
  const onlinePeers = usePeerStore(state => state.onlinePeers)
  const dmPeerOptions = useMemo(() => {
    const peerMap = new Map()
    pastDMPeers.forEach(peer => peerMap.set(peer.peerId, peer.nickname))
    onlinePeers.forEach(peer => peerMap.set(peer.peerId, peer.nickname))
    return Array.from(peerMap.entries()).map(([peerId, nickname]) => ({ peerId, nickname }))
  }, [pastDMPeers, onlinePeers])

  const [exportScope, setExportScope] = useState('global')
  const [exportPeerId, setExportPeerId] = useState('')
  const [exportFormat, setExportFormat] = useState('txt')
  const [exportStatus, setExportStatus] = useState(null) // { type: 'loading'|'success'|'error', text }

  async function handleExportChatHistory() {
    if (exportScope === 'dm' && !exportPeerId) {
      setExportStatus({ type: 'error', text: 'DM 상대를 선택해주세요.' })
      return
    }
    setExportStatus({ type: 'loading', text: '내보내는 중...' })
    const result = await window.electronAPI.exportChatHistory?.({
      scope: exportScope,
      peerId: exportScope === 'dm' ? exportPeerId : undefined,
      format: exportFormat,
    })
    if (result?.ok) {
      setExportStatus({ type: 'success', text: `저장 완료: ${result.path}` })
    } else if (result?.canceled) {
      setExportStatus(null)
    } else {
      setExportStatus({ type: 'error', text: '내보내기에 실패했습니다.' })
    }
  }

  // 핸들러들
  async function handleNicknameSave() {
    const trimmed = nicknameInput.trim()
    if (!trimmed || trimmed === myNickname) return
    setIsSaving(true)
    const result = await window.electronAPI.updateNickname(trimmed)
    setIsSaving(false)
    if (result.success) {
      updateMyNickname(trimmed)
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 2000)
    }
  }

  async function handleImageSelect(event) {
    const file = event.target.files?.[0]
    if (!file) return
    const buffer = await file.arrayBuffer()
    const result = await window.electronAPI.saveProfileImage(new Uint8Array(buffer))
    if (result.url) updateMyProfileImageUrl(`${result.url}?t=${Date.now()}`)
    event.target.value = ''
  }

  async function handleSoundChange(newSound) {
    setNotificationSettings({ sound: newSound, volume: notificationVolume })
    await window.electronAPI.saveNotificationSettings({ sound: newSound, volume: notificationVolume })
  }

  async function handleVolumeChange(newVolume) {
    setNotificationSettings({ sound: notificationSound, volume: newVolume })
    await window.electronAPI.saveNotificationSettings({ sound: notificationSound, volume: newVolume })
  }

  async function handleCustomSoundUpload(event) {
    const file = event.target.files?.[0]
    if (!file) return
    const extension = file.name.split('.').pop().toLowerCase()
    const buffer = await file.arrayBuffer()
    await window.electronAPI.saveCustomNotificationSound(buffer, extension)
    setNotificationSettings({ sound: 'custom', volume: notificationVolume, customSoundBuffer: new Uint8Array(buffer) })
    await window.electronAPI.saveNotificationSettings({ sound: 'custom', volume: notificationVolume })
    event.target.value = ''
  }

  async function handleScopeChange(newScope) {
    setNotificationSettings({ sound: notificationSound, volume: notificationVolume, scope: newScope })
    await window.electronAPI.saveNotificationSettings({ sound: notificationSound, volume: notificationVolume, scope: newScope })
  }

  async function handleHideBodyToggle(newValue) {
    setNotificationSettings({ sound: notificationSound, volume: notificationVolume, hideBody: newValue })
    await window.electronAPI.saveNotificationSettings({ sound: notificationSound, volume: notificationVolume, hideBody: newValue })
  }

  const handlePasswordChange = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordMessage({ type: 'error', text: '모든 항목을 입력해주세요.' })
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordMessage({ type: 'error', text: '새 비밀번호가 일치하지 않습니다.' })
      return
    }
    if (newPassword.length < 4) {
      setPasswordMessage({ type: 'error', text: '비밀번호는 4자 이상이어야 합니다.' })
      return
    }
    const result = await window.electronAPI.updatePassword({ currentPassword, newPassword })
    if (result.success) {
      setPasswordMessage({ type: 'success', text: '비밀번호가 변경됐습니다.' })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } else {
      setPasswordMessage({ type: 'error', text: result.error || '변경에 실패했습니다.' })
    }
  }

  async function handleClearAllMessages() {
    await window.electronAPI.clearAllMessages()
    resetAll()
    clearPastDMPeers()
    setConfirmAction(null)
  }

  async function handleClearAllDMs() {
    await window.electronAPI.clearAllDMs()
    useChatStore.setState({ dmMessages: {}, unreadCounts: {}, typingUsers: {}, currentRoom: { type: 'global' } })
    clearPastDMPeers()
    setConfirmAction(null)
  }

  async function handleLogout() {
    await window.electronAPI.logout()
    clearAllPeers()
    resetAll()
    resetUser()
    setAuthStatus('login')
  }

  function handleCheckUpdate() {
    setUpdateState('checking')
    window.electronAPI.checkForUpdates()

    // 업데이트 이벤트 리스너 등록
    setUpdateErrorMessage(null)
    window.electronAPI.onUpdateAvailable(() => setUpdateState('available'))
    window.electronAPI.onUpdateNotAvailable(() => setUpdateState('not-available'))
    window.electronAPI.onUpdateError((message) => {
      setUpdateState('error')
      setUpdateErrorMessage(message || '업데이트 확인 실패')
    })
    window.electronAPI.onUpdateDownloaded?.(() => setUpdateState('downloaded'))
  }

  // ─── 서브 페이지 헤더 ───
  // NOTE: 과거에는 SubPageHeader 등을 SettingsPanel 안의 중첩 함수 컴포넌트로 두었는데,
  // 그러면 부모가 리렌더될 때마다 새 함수 레퍼런스가 만들어져 React 가 unmount/mount 사이클을
  // 돌렸다 → 닉네임 input 한 글자 입력마다 focus 가 사라지고 채팅 에디터가 글로벌 keydown
  // 자동포커스 핸들러로 채팅창으로 빨려 들어가는 버그가 있었음. 그래서 모든 서브 페이지를
  // 일반 JSX 표현식으로 인라인했음. 컴포넌트 정의가 아니라 단순 JSX 라서 reconciliation 이
  // 안정적이고 input 의 DOM identity 가 유지됨.
  const renderSubPageHeader = (title) => (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-vsc-border">
      <button
        onClick={() => setActiveMenu(null)}
        className="cursor-pointer p-0.5 rounded text-vsc-muted hover:text-vsc-text hover:bg-vsc-hover transition-colors"
      >
        <ChevronLeft size={14} />
      </button>
      <span className="text-vsc-text text-xs font-semibold">{title}</span>
      <div className="flex-1" />
      <button
        onClick={onClose}
        className="cursor-pointer p-0.5 rounded text-vsc-muted hover:text-vsc-text hover:bg-vsc-hover transition-colors"
      >
        <X size={13} />
      </button>
    </div>
  )

  const updateLabel = {
    idle: '업데이트 확인',
    checking: '확인 중...',
    'not-available': '최신 버전입니다',
    error: '확인 실패 — 재시도',
  }[updateState] ?? '업데이트 확인'
  const isUpdateDisabled = updateState === 'checking'

  // ─── 렌더링 ───
  return (
    <div data-prevent-editor-autofocus="true" className="flex flex-col h-full overflow-hidden">
      {activeMenu === null && (
        <>
          <div className="flex items-center justify-between px-3 py-2 border-b border-vsc-border">
            <span className="text-vsc-muted text-xs uppercase tracking-wider">설정</span>
            <button onClick={onClose} className="cursor-pointer p-0.5 rounded text-vsc-muted hover:text-vsc-text hover:bg-vsc-hover transition-colors">
              <X size={13} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto py-1">
            {MENU_ITEMS.map(item => {
              const Icon = item.icon
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveMenu(item.id)}
                  className="cursor-pointer w-full flex items-center gap-3 px-4 py-2.5 text-xs text-vsc-text hover:bg-vsc-hover transition-colors"
                >
                  <Icon size={14} className="text-vsc-muted" />
                  {item.label}
                </button>
              )
            })}
          </div>
          {/* 로그아웃 */}
          <div className="px-3 pb-3 border-t border-vsc-border pt-2">
            <button onClick={handleLogout} className="cursor-pointer w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded text-xs text-red-400 hover:bg-vsc-hover transition-colors">
              <LogOut size={13} />로그아웃
            </button>
          </div>
        </>
      )}

      {activeMenu === 'profile' && (
        <>
          {renderSubPageHeader('프로필')}
          <div className="flex-1 overflow-y-auto">
            {/* 프로필 이미지 */}
            <div className="flex flex-col items-center py-5 gap-1">
              <div onClick={() => fileInputRef.current?.click()} className="relative cursor-pointer group">
                <div className="w-16 h-16 rounded-full overflow-hidden bg-vsc-border flex items-center justify-center">
                  {myProfileImageUrl ? (
                    <img src={myProfileImageUrl} alt="프로필" className="w-full h-full object-cover" onError={(e) => { e.target.style.display = 'none' }} />
                  ) : null}
                  <span className="text-xl font-bold text-vsc-accent absolute" style={{ display: myProfileImageUrl ? 'none' : 'block' }}>
                    {myNickname?.[0]?.toUpperCase() || '?'}
                  </span>
                </div>
                <div className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <Camera size={16} className="text-white" />
                </div>
              </div>
              <span className="text-vsc-muted text-xs mt-1">클릭하여 변경</span>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageSelect} />
            </div>

            {/* 닉네임 */}
            <div className="px-3 space-y-1">
              <label className="text-vsc-muted text-xs block">닉네임</label>
              <div className="flex gap-1">
                <input
                  value={nicknameInput}
                  onChange={e => setNicknameInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleNicknameSave()}
                  className="flex-1 bg-vsc-panel border border-vsc-border rounded px-2 py-1 text-xs text-vsc-text outline-none focus:border-vsc-accent"
                />
                <button
                  onClick={handleNicknameSave}
                  disabled={isSaving || !nicknameInput.trim() || nicknameInput.trim() === myNickname}
                  className="cursor-pointer px-2 py-1 rounded bg-vsc-accent text-vsc-bg text-xs font-semibold hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity flex items-center gap-1"
                >
                  {saveSuccess ? <Check size={12} /> : '저장'}
                </button>
              </div>
            </div>

            {/* 비밀번호 변경 */}
            <div className="px-3 py-3 mt-3 border-t border-vsc-border">
              <p className="text-vsc-muted text-xs uppercase tracking-wider mb-2">비밀번호 변경</p>
              <div className="flex flex-col gap-2">
                <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="현재 비밀번호"
                  className="w-full bg-vsc-bg border border-vsc-border rounded px-2 py-1 text-sm text-vsc-text placeholder-vsc-muted focus:outline-none focus:border-vsc-accent" />
                <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="새 비밀번호"
                  className="w-full bg-vsc-bg border border-vsc-border rounded px-2 py-1 text-sm text-vsc-text placeholder-vsc-muted focus:outline-none focus:border-vsc-accent" />
                <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="새 비밀번호 확인"
                  onKeyDown={(e) => e.key === 'Enter' && handlePasswordChange()}
                  className="w-full bg-vsc-bg border border-vsc-border rounded px-2 py-1 text-sm text-vsc-text placeholder-vsc-muted focus:outline-none focus:border-vsc-accent" />
                <button onClick={handlePasswordChange} className="cursor-pointer w-full py-1 rounded bg-vsc-accent hover:opacity-90 text-white text-sm transition-opacity">변경</button>
                {passwordMessage && (
                  <p className={`text-xs ${passwordMessage.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>{passwordMessage.text}</p>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {activeMenu === 'notification' && (
        <>
          {renderSubPageHeader('알림')}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
            {/* 소리 선택 */}
            <div>
              <label className="text-vsc-muted text-xs block mb-2">알림 소리</label>
              <div className="flex flex-col gap-1">
                {SOUND_OPTIONS.map(option => (
                  <div key={option.value} className="flex items-center gap-2">
                    <button
                      onClick={() => option.value !== 'custom' && handleSoundChange(option.value)}
                      className={`flex-1 text-left px-2 py-1 rounded text-xs transition-colors cursor-pointer ${
                        notificationSound === option.value ? 'bg-vsc-selected text-vsc-text' : 'text-vsc-muted hover:bg-vsc-hover hover:text-vsc-text'
                      }`}
                    >{option.label}</button>
                    {option.value === 'custom' ? (
                      <button onClick={() => soundFileInputRef.current?.click()}
                        className="cursor-pointer px-2 py-1 rounded text-xs bg-vsc-panel border border-vsc-border text-vsc-muted hover:text-vsc-text transition-colors">파일 선택</button>
                    ) : (
                      <button onClick={() => { handleSoundChange(option.value); setTimeout(playNotification, 50) }} title="미리듣기"
                        className="cursor-pointer p-1 rounded text-vsc-muted hover:text-vsc-text hover:bg-vsc-hover transition-colors"><Play size={11} /></button>
                    )}
                  </div>
                ))}
                <input ref={soundFileInputRef} type="file" accept="audio/*" className="hidden" onChange={handleCustomSoundUpload} />
              </div>
            </div>

            {/* 볼륨 */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-vsc-muted text-xs flex items-center gap-1"><Volume2 size={11} />볼륨</label>
                <span className="text-vsc-muted text-xs">{Math.round(notificationVolume * 100)}%</span>
              </div>
              <input type="range" min="0" max="1" step="0.05" value={notificationVolume} onChange={e => handleVolumeChange(Number(e.target.value))} className="w-full accent-vsc-accent cursor-pointer" />
            </div>

            {/* 알림 범위 */}
            <div className="space-y-1">
              <label className="text-vsc-muted text-xs block">알림 범위</label>
              <div className="flex gap-1">
                {NOTIFICATION_SCOPE_OPTIONS.map(option => (
                  <button
                    key={option.value}
                    onClick={() => handleScopeChange(option.value)}
                    className={`flex-1 px-2 py-1 rounded text-xs transition-colors cursor-pointer ${
                      notificationScope === option.value ? 'bg-vsc-selected text-vsc-text' : 'text-vsc-muted hover:bg-vsc-hover hover:text-vsc-text'
                    }`}
                  >{option.label}</button>
                ))}
              </div>
            </div>

            {/* OS 알림 본문 숨김 */}
            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-vsc-muted text-xs">OS 알림에 메시지 내용 숨기기</span>
              <input
                type="checkbox"
                checked={notificationHideBody}
                onChange={e => handleHideBodyToggle(e.target.checked)}
                className="accent-vsc-accent cursor-pointer"
              />
            </label>
          </div>
        </>
      )}

      {activeMenu === 'display' && (
        <>
          {renderSubPageHeader('화면')}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
            {/* 테마(#73) — 다크가 기본값. '시스템'은 OS 다크모드 선호를 따른다. */}
            <div className="space-y-1">
              <label className="text-vsc-muted text-xs block">테마</label>
              <div className="flex gap-1">
                {THEME_OPTIONS_UI.map(option => (
                  <button
                    key={option.value}
                    onClick={() => setTheme(option.value)}
                    className={`flex-1 px-2 py-1 rounded text-xs transition-colors cursor-pointer ${
                      theme === option.value ? 'bg-vsc-selected text-vsc-text' : 'text-vsc-muted hover:bg-vsc-hover hover:text-vsc-text'
                    }`}
                  >{option.label}</button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {activeMenu === 'data' && (
        <>
          {renderSubPageHeader('데이터 관리')}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
            {/* 저장소 사용량(#74) — DB/파일/캐시/사운드 각 크기 표시 + 캐시 비우기 */}
            <div className="pb-3 mb-1 border-b border-vsc-border space-y-2">
              <label className="text-vsc-muted text-xs flex items-center gap-1"><HardDrive size={11} />저장소 사용량</label>
              {storageUsage ? (
                <div className="bg-vsc-panel rounded p-2 space-y-1 text-[11px]">
                  <div className="flex justify-between text-vsc-muted"><span>메시지 DB</span><span className="text-vsc-text">{storageUsage.database.readable}</span></div>
                  <div className="flex justify-between text-vsc-muted"><span>보낸 파일</span><span className="text-vsc-text">{storageUsage.files.readable}</span></div>
                  <div className="flex justify-between text-vsc-muted"><span>받은 파일 캐시</span><span className="text-vsc-text">{storageUsage.fileCache.readable}</span></div>
                  <div className="flex justify-between text-vsc-muted"><span>알림 소리</span><span className="text-vsc-text">{storageUsage.sounds.readable}</span></div>
                  <div className="flex justify-between font-semibold pt-1 border-t border-vsc-border"><span className="text-vsc-text">합계</span><span className="text-vsc-accent">{storageUsage.total.readable}</span></div>
                </div>
              ) : (
                <p className="text-[10px] text-vsc-muted">계산 중...</p>
              )}

              {confirmClearCache ? (
                <div className="bg-vsc-panel border border-vsc-border rounded p-2 space-y-2">
                  <p className="text-[10px] text-vsc-muted leading-relaxed">
                    받은 이미지/파일의 표시용 캐시만 삭제합니다. 채팅 기록이나 메시지는 지워지지 않으며,
                    다음에 열람하면 상대가 온라인일 때 자동으로 다시 받아옵니다.
                  </p>
                  <div className="flex gap-2">
                    <button onClick={handleClearFileCache}
                      className="cursor-pointer flex-1 py-1 rounded bg-red-600 hover:bg-red-500 text-white text-xs transition-colors">캐시 비우기</button>
                    <button onClick={() => setConfirmClearCache(false)}
                      className="cursor-pointer flex-1 py-1 rounded bg-vsc-border hover:bg-vsc-sidebar text-vsc-muted text-xs transition-colors">취소</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setConfirmClearCache(true)}
                  className="cursor-pointer w-full flex items-center gap-2 px-2 py-2 rounded text-xs text-vsc-muted hover:bg-vsc-hover hover:text-vsc-text transition-colors">
                  <Trash2 size={12} />캐시 비우기 (메시지는 삭제되지 않음)
                </button>
              )}
              {cacheClearMessage && <p className="text-[10px] text-green-400">{cacheClearMessage}</p>}
            </div>

            {/* 기본 다운로드 폴더 설정(#74) */}
            <div className="pb-3 mb-1 border-b border-vsc-border space-y-1">
              <label className="text-vsc-muted text-xs flex items-center gap-1"><FolderOpen size={11} />다운로드 폴더</label>
              <p className="text-[10px] text-vsc-muted break-all">
                {downloadFolder?.folderPath || `OS 기본값 사용 중${downloadFolder?.osDefaultPath ? ` (${downloadFolder.osDefaultPath})` : ''}`}
              </p>
              <button onClick={handleChooseDownloadFolder}
                className="cursor-pointer w-full px-2 py-1.5 rounded text-xs bg-vsc-panel border border-vsc-border text-vsc-text hover:bg-vsc-hover transition-colors">
                폴더 선택
              </button>
            </div>

            {/* 채팅 내보내기(#74) — 전체채팅/DM 기록을 txt/json 파일로 백업 */}
            <div className="pb-3 mb-1 border-b border-vsc-border space-y-2">
              <label className="text-vsc-muted text-xs flex items-center gap-1"><FileDown size={11} />채팅 내보내기</label>
              <div className="flex gap-1">
                {EXPORT_SCOPE_OPTIONS.map(option => (
                  <button key={option.value} onClick={() => setExportScope(option.value)}
                    className={`flex-1 px-2 py-1 rounded text-xs transition-colors cursor-pointer ${
                      exportScope === option.value ? 'bg-vsc-selected text-vsc-text' : 'text-vsc-muted hover:bg-vsc-hover hover:text-vsc-text'
                    }`}
                  >{option.label}</button>
                ))}
              </div>
              {exportScope === 'dm' && (
                <select
                  value={exportPeerId}
                  onChange={e => setExportPeerId(e.target.value)}
                  className="w-full bg-vsc-panel border border-vsc-border rounded px-2 py-1 text-xs text-vsc-text outline-none focus:border-vsc-accent"
                >
                  <option value="">DM 상대 선택</option>
                  {dmPeerOptions.map(peer => (
                    <option key={peer.peerId} value={peer.peerId}>{peer.nickname}</option>
                  ))}
                </select>
              )}
              <div className="flex gap-1">
                {EXPORT_FORMAT_OPTIONS.map(option => (
                  <button key={option.value} onClick={() => setExportFormat(option.value)}
                    className={`flex-1 px-2 py-1 rounded text-xs transition-colors cursor-pointer ${
                      exportFormat === option.value ? 'bg-vsc-selected text-vsc-text' : 'text-vsc-muted hover:bg-vsc-hover hover:text-vsc-text'
                    }`}
                  >{option.label}</button>
                ))}
              </div>
              <button onClick={handleExportChatHistory} disabled={exportStatus?.type === 'loading'}
                className="cursor-pointer w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded text-xs bg-vsc-accent text-vsc-bg font-semibold hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity">
                <Download size={12} />내보내기
              </button>
              {exportStatus && (
                <p className={`text-[10px] break-all ${exportStatus.type === 'error' ? 'text-red-400' : exportStatus.type === 'success' ? 'text-green-400' : 'text-vsc-muted'}`}>
                  {exportStatus.text}
                </p>
              )}
            </div>

            {/* 링크 미리보기 토글 — 끄면 외부 서버로의 OG 요청을 완전히 막는다(완전 단절 모드) */}
            <div className="pb-3 mb-1 border-b border-vsc-border">
              <label className="flex items-center justify-between cursor-pointer">
                <span className="text-vsc-text text-xs">링크 미리보기</span>
                <input
                  type="checkbox"
                  checked={linkPreviewEnabled}
                  onChange={e => handleLinkPreviewToggle(e.target.checked)}
                  className="accent-vsc-accent cursor-pointer"
                />
              </label>
              <p className="text-[10px] text-vsc-muted mt-1 leading-relaxed">
                끄면 채팅 속 링크의 미리보기를 위해 외부 서버로 요청하지 않습니다.
              </p>
            </div>
            {confirmAction === null ? (
              <>
                <button onClick={() => setConfirmAction('clearAll')}
                  className="cursor-pointer w-full flex items-center gap-2 px-2 py-2 rounded text-xs text-vsc-muted hover:bg-vsc-hover hover:text-vsc-text transition-colors">
                  <Trash2 size={12} />전체 채팅 기록 삭제
                </button>
                <button onClick={() => setConfirmAction('clearDMs')}
                  className="cursor-pointer w-full flex items-center gap-2 px-2 py-2 rounded text-xs text-vsc-muted hover:bg-vsc-hover hover:text-vsc-text transition-colors">
                  <Trash2 size={12} />DM 기록 삭제
                </button>
              </>
            ) : (
              <div className="bg-vsc-panel border border-vsc-border rounded p-3 space-y-2">
                <p className="text-xs text-red-400">
                  {confirmAction === 'clearAll'
                    ? '모든 채팅 기록(전체채팅 + DM)이 삭제됩니다. 복구할 수 없습니다.'
                    : 'DM 대화 기록이 모두 삭제됩니다. 복구할 수 없습니다.'}
                </p>
                <div className="flex gap-2">
                  <button onClick={confirmAction === 'clearAll' ? handleClearAllMessages : handleClearAllDMs}
                    className="cursor-pointer flex-1 py-1 rounded bg-red-600 hover:bg-red-500 text-white text-xs transition-colors">삭제</button>
                  <button onClick={() => setConfirmAction(null)}
                    className="cursor-pointer flex-1 py-1 rounded bg-vsc-border hover:bg-vsc-sidebar text-vsc-muted text-xs transition-colors">취소</button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {activeMenu === 'app' && (
        <>
          {renderSubPageHeader('앱 정보')}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
            {/* 버전 정보 */}
            <div className="bg-vsc-panel rounded p-3 space-y-1">
              <p className="text-xs text-vsc-text font-semibold">LAN Chat</p>
              <p className="text-xs text-vsc-muted">사내 LAN 기반 P2P 채팅</p>
            </div>

            {/* 시작 설정 — 로그인 시 자동 시작(#71) */}
            <div>
              <label className="text-vsc-muted text-xs block mb-2">시작 설정</label>
              {autoLaunchSettings.supported ? (
                <div className="space-y-2">
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-vsc-text text-xs">로그인 시 자동 시작</span>
                    <input
                      type="checkbox"
                      checked={autoLaunchSettings.openAtLogin}
                      onChange={e => handleAutoLaunchToggle(e.target.checked)}
                      className="accent-vsc-accent cursor-pointer"
                    />
                  </label>
                  <label className={`flex items-center justify-between ${autoLaunchSettings.openAtLogin ? 'cursor-pointer' : 'cursor-not-allowed opacity-40'}`}>
                    <span className="text-vsc-text text-xs">창 숨김으로 시작 (트레이)</span>
                    <input
                      type="checkbox"
                      checked={autoLaunchSettings.startHidden}
                      disabled={!autoLaunchSettings.openAtLogin}
                      onChange={e => handleStartHiddenToggle(e.target.checked)}
                      className="accent-vsc-accent cursor-pointer"
                    />
                  </label>
                </div>
              ) : (
                <p className="text-[10px] text-vsc-muted leading-relaxed">
                  현재 OS에서는 로그인 시 자동 시작을 지원하지 않습니다.
                </p>
              )}
            </div>

            {/* 업데이트 확인 */}
            <div>
              <label className="text-vsc-muted text-xs block mb-2">업데이트</label>
              <button
                onClick={handleCheckUpdate}
                disabled={isUpdateDisabled}
                className="cursor-pointer w-full flex items-center gap-2 px-3 py-2 rounded text-xs bg-vsc-panel border border-vsc-border text-vsc-text hover:bg-vsc-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Download size={13} />
                {updateLabel}
              </button>
              {updateState === 'error' && updateErrorMessage && (
                <p className="text-[10px] text-red-400 mt-1 px-1 break-all">{updateErrorMessage}</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
