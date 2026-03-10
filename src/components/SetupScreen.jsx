// src/components/SetupScreen.jsx
import React, { useState } from 'react'
import { MessageCircle } from 'lucide-react'
import useAuthStore from '../store/useAuthStore'

export default function SetupScreen() {
  const [닉네임, 닉네임설정] = useState('')
  const [아이디, 아이디설정] = useState('')
  const [비밀번호, 비밀번호설정] = useState('')
  const [비밀번호확인, 비밀번호확인설정] = useState('')
  const [오류메시지, 오류메시지설정] = useState('')
  const [로딩중, 로딩중설정] = useState(false)
  const { 인증완료 } = useAuthStore()

  async function 가입처리() {
    오류메시지설정('')

    if (!닉네임.trim() || !아이디.trim() || !비밀번호) {
      오류메시지설정('모든 항목을 입력해주세요.')
      return
    }
    if (비밀번호 !== 비밀번호확인) {
      오류메시지설정('비밀번호가 일치하지 않습니다.')
      return
    }
    if (비밀번호.length < 4) {
      오류메시지설정('비밀번호는 4자 이상이어야 합니다.')
      return
    }

    로딩중설정(true)
    const 결과 = await window.electronAPI.회원가입({ username: 아이디.trim(), nickname: 닉네임.trim(), password: 비밀번호 })
    로딩중설정(false)

    if (결과.success) {
      인증완료(닉네임.trim())
    } else {
      오류메시지설정(결과.error)
    }
  }

  return (
    <div className="flex h-screen bg-vsc-bg items-center justify-center">
      <div className="w-80 bg-vsc-sidebar border border-vsc-border rounded-lg p-6">
        <div className="flex items-center gap-2 mb-1">
          <MessageCircle size={18} className="text-vsc-accent" />
          <h1 className="text-vsc-text text-lg font-semibold">LAN Chat</h1>
        </div>
        <p className="text-vsc-muted text-xs mb-5">처음 실행되었습니다. 프로필을 설정해주세요.</p>

        <div className="space-y-3">
          <div>
            <label className="text-vsc-muted text-xs block mb-1">닉네임 <span className="text-vsc-muted">(채팅에서 표시됨)</span></label>
            <input
              value={닉네임}
              onChange={e => 닉네임설정(e.target.value)}
              placeholder="홍길동"
              className="w-full bg-vsc-panel border border-vsc-border rounded px-3 py-2 text-sm text-vsc-text outline-none focus:border-vsc-accent"
            />
          </div>
          <div>
            <label className="text-vsc-muted text-xs block mb-1">아이디 <span className="text-vsc-muted">(로컬 로그인용)</span></label>
            <input
              value={아이디}
              onChange={e => 아이디설정(e.target.value)}
              placeholder="hong"
              className="w-full bg-vsc-panel border border-vsc-border rounded px-3 py-2 text-sm text-vsc-text outline-none focus:border-vsc-accent"
            />
          </div>
          <div>
            <label className="text-vsc-muted text-xs block mb-1">비밀번호</label>
            <input
              type="password"
              value={비밀번호}
              onChange={e => 비밀번호설정(e.target.value)}
              className="w-full bg-vsc-panel border border-vsc-border rounded px-3 py-2 text-sm text-vsc-text outline-none focus:border-vsc-accent"
            />
          </div>
          <div>
            <label className="text-vsc-muted text-xs block mb-1">비밀번호 확인</label>
            <input
              type="password"
              value={비밀번호확인}
              onChange={e => 비밀번호확인설정(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && 가입처리()}
              className="w-full bg-vsc-panel border border-vsc-border rounded px-3 py-2 text-sm text-vsc-text outline-none focus:border-vsc-accent"
            />
          </div>
        </div>

        {오류메시지 && (
          <p className="text-red-400 text-xs mt-3">{오류메시지}</p>
        )}

        <button
          onClick={가입처리}
          disabled={로딩중}
          className="w-full mt-4 bg-vsc-accent text-vsc-bg font-semibold py-2 rounded text-sm hover:opacity-80 disabled:opacity-40 transition-opacity"
        >
          {로딩중 ? '설정 중...' : '시작하기'}
        </button>

        <p className="text-vsc-muted text-xs mt-3 text-center">아이디와 비밀번호는 이 PC에만 저장됩니다.</p>
      </div>
    </div>
  )
}
