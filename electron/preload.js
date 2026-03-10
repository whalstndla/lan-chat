// electron/preload.js
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // 인증
  프로필존재확인: () => ipcRenderer.invoke('프로필존재확인'),
  회원가입: (data) => ipcRenderer.invoke('회원가입', data),
  로그인: (data) => ipcRenderer.invoke('로그인', data),

  // 내 정보
  내정보조회: () => ipcRenderer.invoke('내정보조회'),

  // 피어 발견
  피어발견시작: () => ipcRenderer.invoke('피어발견시작'),

  // 메시지 전송
  전체메시지전송: (payload) => ipcRenderer.invoke('전체메시지전송', payload),
  DM전송: (payload) => ipcRenderer.invoke('DM전송', payload),

  // 기록 조회
  전체채팅기록조회: () => ipcRenderer.invoke('전체채팅기록조회'),
  DM기록조회: (피어아이디1, 피어아이디2) => ipcRenderer.invoke('DM기록조회', { 피어아이디1, 피어아이디2 }),

  // 파일 저장 — ArrayBuffer를 Uint8Array로 변환 후 전송 (IPC 직렬화 안전)
  파일저장: (파일버퍼, 파일이름) => ipcRenderer.invoke('파일저장', { 파일버퍼: new Uint8Array(파일버퍼), 파일이름 }),

  // 이벤트 구독
  메시지수신구독: (콜백) => ipcRenderer.on('메시지수신', (_, 메시지) => 콜백(메시지)),
  피어발견구독: (콜백) => ipcRenderer.on('피어발견', (_, 피어정보) => 콜백(피어정보)),
  피어퇴장구독: (콜백) => ipcRenderer.on('피어퇴장', (_, 피어아이디) => 콜백(피어아이디)),

  // 이벤트 구독 해제
  모든구독해제: () => {
    ipcRenderer.removeAllListeners('메시지수신')
    ipcRenderer.removeAllListeners('피어발견')
    ipcRenderer.removeAllListeners('피어퇴장')
  },
})
