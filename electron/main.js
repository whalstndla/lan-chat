// electron/main.js
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const os = require('os')
const { v4: uuidv4 } = require('uuid')
const { 데이터베이스초기화 } = require('./storage/database')
const { 메시지저장, 전체채팅기록조회, DM기록조회 } = require('./storage/queries')
const { 프로필저장, 프로필조회, 비밀번호검증 } = require('./storage/profile')
const { 피어발견시작, 피어발견중지 } = require('./peer/discovery')
const { 웹소켓서버시작, 웹소켓서버중지 } = require('./peer/wsServer')
const { 피어연결, 메시지전송, 전체전송 } = require('./peer/wsClient')
const { 파일서버시작, 파일서버중지, 파일포트조회 } = require('./peer/fileServer')
const { 키쌍생성또는로드, 공개키내보내기, 공개키가져오기 } = require('./crypto/keyManager')
const { SharedSecret도출, DM암호화, DM복호화 } = require('./crypto/encryption')
const fs = require('fs')

const 개발모드 = process.env.NODE_ENV !== 'production'

// 앱 데이터 경로
const 앱데이터경로 = app.getPath('userData')
const 임시파일경로 = path.join(앱데이터경로, 'files')
const 데이터베이스경로 = path.join(앱데이터경로, 'chat.db')

let 메인윈도우 = null
let 데이터베이스 = null
let 웹소켓서버정보 = null
let 내개인키객체 = null                 // 내 ECDH 개인키
let 내공개키Base64 = null               // 네트워크 전송용 공개키
const 피어공개키맵 = new Map()          // 피어아이디 → 공개키 객체

function 렌더러에이벤트전송(채널, 데이터) {
  if (메인윈도우) 메인윈도우.webContents.send(채널, 데이터)
}

async function 앱초기화() {
  // 임시 파일 폴더 생성
  if (!fs.existsSync(임시파일경로)) fs.mkdirSync(임시파일경로, { recursive: true })

  // ECDH 키 쌍 로드 (최초 실행 시 자동 생성)
  const { 개인키객체, 공개키객체 } = 키쌍생성또는로드(앱데이터경로)
  내개인키객체 = 개인키객체
  내공개키Base64 = 공개키내보내기(공개키객체)

  // SQLite 초기화
  데이터베이스 = 데이터베이스초기화(데이터베이스경로)

  // 파일 서버 시작
  await 파일서버시작(임시파일경로)

  // WebSocket 서버 시작
  웹소켓서버정보 = 웹소켓서버시작({
    메시지수신콜백: (메시지) => {
      // 키 교환 메시지 처리 (저장 없음)
      if (메시지.type === 'key-exchange') {
        try {
          const 공개키객체 = 공개키가져오기(메시지.publicKey)
          피어공개키맵.set(메시지.fromId, 공개키객체)
        } catch {
          // 잘못된 공개키 무시
        }
        return
      }

      // DM: 암호문 복호화 후 렌더러 전달
      if (메시지.type === 'dm' && 메시지.encryptedPayload) {
        const 발신자공개키 = 피어공개키맵.get(메시지.fromId)
        if (!발신자공개키) return // 공개키 미수신 시 무시

        try {
          const sharedSecret = SharedSecret도출(내개인키객체, 발신자공개키)
          const 복호화된페이로드 = DM복호화(메시지.encryptedPayload, sharedSecret)

          메시지저장(데이터베이스, {
            id: 메시지.id,
            type: 메시지.type,
            from_id: 메시지.fromId,
            from_name: 메시지.from,
            to_id: 메시지.to,
            content: null,                          // DB에는 평문 저장 안 함
            content_type: 복호화된페이로드.contentType,
            encrypted_payload: 메시지.encryptedPayload, // 암호문 상태로 보관
            file_url: 복호화된페이로드.fileUrl || null,
            file_name: 복호화된페이로드.fileName || null,
            timestamp: 메시지.timestamp,
          })

          // 렌더러에는 복호화된 내용 전달
          렌더러에이벤트전송('메시지수신', {
            ...메시지,
            content: 복호화된페이로드.content,
            contentType: 복호화된페이로드.contentType,
            fileUrl: 복호화된페이로드.fileUrl,
            fileName: 복호화된페이로드.fileName,
          })
        } catch {
          // 복호화 실패 시 무시
        }
        return
      }

      // 전체채팅 메시지 (평문 저장)
      메시지저장(데이터베이스, {
        id: 메시지.id,
        type: 메시지.type,
        from_id: 메시지.fromId,
        from_name: 메시지.from,
        to_id: null,
        content: 메시지.content || null,
        content_type: 메시지.contentType,
        encrypted_payload: null,
        file_url: 메시지.fileUrl || null,
        file_name: 메시지.fileName || null,
        timestamp: 메시지.timestamp,
      })
      렌더러에이벤트전송('메시지수신', 메시지)
    },
  })
}

// IPC 핸들러 등록
function IPC핸들러등록(피어아이디, 닉네임) {
  // 프로필 존재 여부 확인 (앱 시작 시 첫 화면 결정용)
  ipcMain.handle('프로필존재확인', () => {
    return 프로필조회(데이터베이스) !== null
  })

  // 최초 설정 — 닉네임·아이디·비밀번호 저장
  ipcMain.handle('회원가입', (_, { username, nickname, password }) => {
    if (프로필조회(데이터베이스)) {
      return { success: false, error: '이미 설정된 프로필이 있습니다.' }
    }
    if (!username?.trim() || !nickname?.trim() || !password) {
      return { success: false, error: '모든 항목을 입력해주세요.' }
    }
    try {
      프로필저장(데이터베이스, { username: username.trim(), nickname: nickname.trim(), password })
      return { success: true }
    } catch (에러) {
      return { success: false, error: 에러.message }
    }
  })

  // 로그인 — 아이디·비밀번호 검증
  ipcMain.handle('로그인', (_, { username, password }) => {
    const 검증결과 = 비밀번호검증(데이터베이스, username, password)
    if (!검증결과) return { success: false, error: '아이디 또는 비밀번호가 틀렸습니다.' }

    const 프로필 = 프로필조회(데이터베이스)
    return { success: true, nickname: 프로필.nickname }
  })

  // 내 정보 조회 (프로필 닉네임 우선)
  ipcMain.handle('내정보조회', () => {
    const 프로필 = 프로필조회(데이터베이스)
    return {
      피어아이디,
      닉네임: 프로필?.nickname || 닉네임,
    }
  })

  // 피어 발견 시작 — 닉네임은 클로저의 값을 사용 (렌더러 파라미터 무시)
  ipcMain.handle('피어발견시작', (_이벤트, _파라미터) => {
    const 현재닉네임 = 프로필조회(데이터베이스)?.nickname || 닉네임
    피어발견시작({
      닉네임: 현재닉네임,
      피어아이디,
      웹소켓포트: 웹소켓서버정보.포트,
      파일포트: 파일포트조회(),
      피어발견콜백: async (피어정보) => {
        await 피어연결({
          피어아이디: 피어정보.피어아이디,
          호스트: 피어정보.호스트,
          웹소켓포트: 피어정보.웹소켓포트,
        })
        // 연결 직후 내 공개키 전송 (키 교환)
        메시지전송(피어정보.피어아이디, {
          type: 'key-exchange',
          fromId: 피어아이디,
          publicKey: 내공개키Base64,
        })
        렌더러에이벤트전송('피어발견', 피어정보)
      },
      피어퇴장콜백: (퇴장피어아이디) => {
        렌더러에이벤트전송('피어퇴장', 퇴장피어아이디)
      },
    })
  })

  // 전체채팅 메시지 전송
  ipcMain.handle('전체메시지전송', (_, { content, contentType, fileUrl, fileName }) => {
    const 현재닉네임 = 프로필조회(데이터베이스)?.nickname || 닉네임
    const 메시지 = {
      id: uuidv4(),
      type: 'message',
      from: 현재닉네임,
      fromId: 피어아이디,
      to: null,
      content: content || null,
      contentType,
      fileUrl: fileUrl || null,
      fileName: fileName || null,
      timestamp: Date.now(),
    }
    전체전송(메시지)
    // 내 메시지도 로컬 저장
    메시지저장(데이터베이스, {
      id: 메시지.id, type: 메시지.type,
      from_id: 메시지.fromId, from_name: 메시지.from,
      to_id: null, content: 메시지.content,
      content_type: 메시지.contentType,
      encrypted_payload: null,
      file_url: 메시지.fileUrl, file_name: 메시지.fileName,
      timestamp: 메시지.timestamp,
    })
    return 메시지
  })

  // DM 전송 (E2E 암호화)
  ipcMain.handle('DM전송', (_, { 수신자피어아이디, content, contentType, fileUrl, fileName }) => {
    const 수신자공개키 = 피어공개키맵.get(수신자피어아이디)
    if (!수신자공개키) throw new Error('수신자 공개키 미수신 — 키 교환 완료 전')

    const sharedSecret = SharedSecret도출(내개인키객체, 수신자공개키)
    const 암호화된페이로드 = DM암호화(
      { content: content || null, contentType, fileUrl: fileUrl || null, fileName: fileName || null },
      sharedSecret
    )

    const 현재닉네임 = 프로필조회(데이터베이스)?.nickname || 닉네임
    const 메시지 = {
      id: uuidv4(),
      type: 'dm',
      from: 현재닉네임,
      fromId: 피어아이디,
      to: 수신자피어아이디,
      content: null,              // 평문은 네트워크로 전송하지 않음
      contentType,
      encryptedPayload: 암호화된페이로드,
      fileUrl: null,
      fileName: null,
      timestamp: Date.now(),
    }
    메시지전송(수신자피어아이디, 메시지)

    // 내 DB에는 암호문 저장
    메시지저장(데이터베이스, {
      id: 메시지.id, type: 메시지.type,
      from_id: 메시지.fromId, from_name: 메시지.from,
      to_id: 메시지.to, content: null,
      content_type: contentType,
      encrypted_payload: 암호화된페이로드,
      file_url: fileUrl || null, file_name: fileName || null,
      timestamp: 메시지.timestamp,
    })

    // 렌더러에는 복호화된 내용으로 반환 (내가 방금 보낸 내용이므로 알고 있음)
    return { ...메시지, content: content || null, fileUrl: fileUrl || null, fileName: fileName || null }
  })

  // 채팅 기록 조회
  ipcMain.handle('전체채팅기록조회', () => 전체채팅기록조회(데이터베이스))
  ipcMain.handle('DM기록조회', (_, { 피어아이디1, 피어아이디2 }) =>
    DM기록조회(데이터베이스, 피어아이디1, 피어아이디2)
  )

  // 파일 임시 저장 후 URL 반환
  // 주의: Electron IPC에서 ArrayBuffer는 Uint8Array로 전달해야 안전하게 직렬화됨
  ipcMain.handle('파일저장', (_, { 파일버퍼, 파일이름 }) => {
    const 확장자 = path.extname(파일이름)
    const 저장파일명 = `${uuidv4()}${확장자}`
    const 저장경로 = path.join(임시파일경로, 저장파일명)
    fs.writeFileSync(저장경로, Buffer.from(new Uint8Array(파일버퍼)))
    // 로컬 IP 기반 URL (같은 LAN에서 접근 가능)
    const 로컬IP = Object.values(os.networkInterfaces())
      .flat()
      .find(인터페이스 => 인터페이스.family === 'IPv4' && !인터페이스.internal)?.address || 'localhost'
    return `http://${로컬IP}:${파일포트조회()}/files/${저장파일명}`
  })
}

async function 윈도우생성() {
  await 앱초기화()

  const 피어아이디 = uuidv4()
  const 닉네임 = os.userInfo().username // 기본값: OS 사용자명 (로그인 후 프로필 닉네임으로 대체)

  IPC핸들러등록(피어아이디, 닉네임)

  메인윈도우 = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 700,
    minHeight: 500,
    backgroundColor: '#1e1e1e',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (개발모드) {
    메인윈도우.loadURL('http://localhost:5173')
  } else {
    메인윈도우.loadFile(path.join(__dirname, '../dist/renderer/index.html'))
  }
}

app.whenReady().then(윈도우생성)

app.on('window-all-closed', () => {
  피어발견중지()
  파일서버중지()
  if (웹소켓서버정보) 웹소켓서버중지(웹소켓서버정보)
  if (데이터베이스) 데이터베이스.close()
  app.quit()
})
