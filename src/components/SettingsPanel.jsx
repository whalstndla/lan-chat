// src/components/SettingsPanel.jsx
import React, { useState, useRef } from 'react'
import { X, LogOut, Camera, Check, Volume2, Play, Trash2, User, Bell, Database, Info, ChevronLeft, Download } from 'lucide-react'
import useAuthStore from '../store/useAuthStore'
import useUserStore from '../store/useUserStore'
import usePeerStore from '../store/usePeerStore'
import useChatStore from '../store/useChatStore'
import useNotificationSound from '../hooks/useNotificationSound'

// 설정 메뉴 항목 정의
const MENU_ITEMS = [
  { id: 'profile', label: '프로필', icon: User },
  { id: 'notification', label: '알림', icon: Bell },
  { id: 'data', label: '데이터 관리', icon: Database },
  { id: 'app', label: '앱 정보', icon: Info },
]

export default function SettingsPanel({ onClose }) {
  const { setAuthStatus } = useAuthStore()
  const { myNickname, myProfileImageUrl, updateMyNickname, updateMyProfileImageUrl, reset: resetUser } = useUserStore()
  const { clearAllPeers, clearPastDMPeers } = usePeerStore()
  const { resetAll } = useChatStore()

  const notificationSound = useUserStore(state => state.notificationSound)
  const notificationVolume = useUserStore(state => state.notificationVolume)
  const { setNotificationSettings } = useUserStore()
  const { play: playNotification } = useNotificationSound()

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
  const fileInputRef = useRef(null)
  const soundFileInputRef = useRef(null)

  const SOUND_OPTIONS = [
    { value: 'notification1', label: '소리 1' },
    { value: 'notification2', label: '소리 2' },
    { value: 'notification3', label: '소리 3' },
    { value: 'notification4', label: '소리 4' },
    { value: 'custom', label: '직접 업로드' },
  ]

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
    // 업데이트 이벤트는 App.jsx에서 처리되지만, 상태 표시를 위해 타이머 설정
    setTimeout(() => {
      if (updateState === 'checking') setUpdateState('not-available')
    }, 10000)
  }

  // 서브 페이지 헤더
  function SubPageHeader({ title }) {
    return (
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
  }

  // ─── 프로필 페이지 ───
  function ProfilePage() {
    return (
      <>
        <SubPageHeader title="프로필" />
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
    )
  }

  // ─── 알림 페이지 ───
  function NotificationPage() {
    return (
      <>
        <SubPageHeader title="알림" />
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
        </div>
      </>
    )
  }

  // ─── 데이터 관리 페이지 ───
  function DataPage() {
    return (
      <>
        <SubPageHeader title="데이터 관리" />
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
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
    )
  }

  // ─── 앱 정보 페이지 (업데이트 확인 포함) ───
  function AppPage() {
    const updateLabel = {
      idle: '업데이트 확인',
      checking: '확인 중...',
      'not-available': '최신 버전입니다',
      error: '확인 실패 — 재시도',
    }[updateState] ?? '업데이트 확인'

    const isDisabled = updateState === 'checking'

    return (
      <>
        <SubPageHeader title="앱 정보" />
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
          {/* 버전 정보 */}
          <div className="bg-vsc-panel rounded p-3 space-y-1">
            <p className="text-xs text-vsc-text font-semibold">LAN Chat</p>
            <p className="text-xs text-vsc-muted">사내 LAN 기반 P2P 채팅</p>
          </div>

          {/* 업데이트 확인 */}
          <div>
            <label className="text-vsc-muted text-xs block mb-2">업데이트</label>
            <button
              onClick={handleCheckUpdate}
              disabled={isDisabled}
              className="cursor-pointer w-full flex items-center gap-2 px-3 py-2 rounded text-xs bg-vsc-panel border border-vsc-border text-vsc-text hover:bg-vsc-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Download size={13} />
              {updateLabel}
            </button>
          </div>
        </div>
      </>
    )
  }

  // ─── 메인 메뉴 목록 ───
  function MenuList() {
    return (
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
    )
  }

  // ─── 렌더링 ───
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {activeMenu === null && <MenuList />}
      {activeMenu === 'profile' && <ProfilePage />}
      {activeMenu === 'notification' && <NotificationPage />}
      {activeMenu === 'data' && <DataPage />}
      {activeMenu === 'app' && <AppPage />}
    </div>
  )
}
