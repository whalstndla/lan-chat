// src/components/LoginScreen.jsx
import React, { useState } from 'react'
import { MessageCircle } from 'lucide-react'
import useAuthStore from '../store/useAuthStore'

export default function LoginScreen() {
  const [아이디, 아이디설정] = useState('')
  const [비밀번호, 비밀번호설정] = useState('')
  const [오류메시지, 오류메시지설정] = useState('')
  const [로딩중, 로딩중설정] = useState(false)
  const { 인증완료 } = useAuthStore()

  async function 로그인처리() {
    if (!아이디.trim() || !비밀번호) {
      오류메시지설정('아이디와 비밀번호를 입력해주세요.')
      return
    }
    로딩중설정(true)
    오류메시지설정('')

    const 결과 = await window.electronAPI.로그인({ username: 아이디.trim(), password: 비밀번호 })
    로딩중설정(false)

    if (결과.success) {
      인증완료(결과.nickname)
    } else {
      오류메시지설정(결과.error)
    }
  }

  return (
    <div className="flex h-screen bg-vsc-bg items-center justify-center">
      <div className="w-72 bg-vsc-sidebar border border-vsc-border rounded-lg p-6">
        <div className="flex items-center gap-2 mb-1">
          <MessageCircle size={18} className="text-vsc-accent" />
          <h1 className="text-vsc-text text-lg font-semibold">LAN Chat</h1>
        </div>
        <p className="text-vsc-muted text-xs mb-5">로그인하여 채팅을 시작하세요.</p>

        <div className="space-y-3">
          <div>
            <label className="text-vsc-muted text-xs block mb-1">아이디</label>
            <input
              value={아이디}
              onChange={e => 아이디설정(e.target.value)}
              className="w-full bg-vsc-panel border border-vsc-border rounded px-3 py-2 text-sm text-vsc-text outline-none focus:border-vsc-accent"
            />
          </div>
          <div>
            <label className="text-vsc-muted text-xs block mb-1">비밀번호</label>
            <input
              type="password"
              value={비밀번호}
              onChange={e => 비밀번호설정(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && 로그인처리()}
              className="w-full bg-vsc-panel border border-vsc-border rounded px-3 py-2 text-sm text-vsc-text outline-none focus:border-vsc-accent"
            />
          </div>
        </div>

        {오류메시지 && (
          <p className="text-red-400 text-xs mt-3">{오류메시지}</p>
        )}

        <button
          onClick={로그인처리}
          disabled={로딩중}
          className="w-full mt-4 bg-vsc-accent text-vsc-bg font-semibold py-2 rounded text-sm hover:opacity-80 disabled:opacity-40 transition-opacity"
        >
          {로딩중 ? '확인 중...' : '로그인'}
        </button>
      </div>
    </div>
  )
}
