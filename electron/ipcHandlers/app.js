// electron/ipcHandlers/app.js
// 앱 기능 관련 IPC 핸들러 — 링크 프리뷰, 외부 링크, 클립보드, 패치노트, 버전, 업데이트

const { ipcMain, shell, nativeImage, app } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { v4: uuidv4 } = require('uuid')
const { spawn } = require('child_process')
const { autoUpdater } = require('electron-updater')
const { sendToRenderer, loadChangelog } = require('../utils/appUtils')
const { isBlockedUrlAsync } = require('../utils/urlGuard')
const { getLinkPreviewEnabled } = require('../storage/profile')

// SSRF 가드가 적용된 fetch — 각 리다이렉트 홉의 목적지까지 재검증한다(#66).
// redirect:'manual' 로 3xx 를 직접 따라가며 매 홉마다 스킴/사설 IP/DNS(rebinding)를 검사해,
// "공개 URL → 리다이렉트 → 내부 IP" 우회를 막는다.
// 반환: 리다이렉트가 아닌 최종 Response, 또는 null(차단/에러/과다 리다이렉트).
async function guardedFetch(url, options = {}, maxRedirects = 5) {
  let currentUrl = url
  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (await isBlockedUrlAsync(currentUrl)) return null
    let response
    try {
      response = await fetch(currentUrl, { ...options, redirect: 'manual' })
    } catch {
      return null
    }
    const location = response.headers.get('location')
    if (response.status >= 300 && response.status < 400 && location) {
      try {
        currentUrl = new URL(location, currentUrl).toString() // 상대 Location 절대화
      } catch {
        return null
      }
      continue
    }
    return response
  }
  return null // 리다이렉트 과다 → 차단
}

function registerAppHandlers(ctx) {
  // 링크 프리뷰 OG 메타데이터 추출 — 메인 프로세스에서 fetch (CORS 제한 없음)
  ipcMain.handle('fetch-link-preview', async (_, url) => {
    try {
      // 링크 미리보기가 꺼져 있으면 외부 요청 자체를 하지 않는다(완전 단절 모드).
      if (!getLinkPreviewEnabled(ctx.state.database)) return null
      // 단일 5초 예산을 모든 리다이렉트 홉에 공유(총 소요 시간 상한).
      const response = await guardedFetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
        signal: AbortSignal.timeout(5000),
      })
      if (!response || !response.ok) return null
      const html = await response.text()
      // og 태그에서 content 속성이 property 앞/뒤 어디에 있든 매칭
      const getOgContent = (property) => {
        const regex = new RegExp(
          `<meta[^>]*(?:property=["']og:${property}["'][^>]*content=["']([^"']*)["']|content=["']([^"']*)["'][^>]*property=["']og:${property}["'])`,
          'i'
        )
        const match = html.match(regex)
        return match?.[1] || match?.[2] || null
      }
      const title = getOgContent('title')
        || html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]
        || null
      const description = getOgContent('description')
      const image = getOgContent('image')
      // 제목조차 없으면 프리뷰 불가
      if (!title) return null
      return { title, description, image, url }
    } catch {
      return null
    }
  })

  // 외부 링크 IPC 핸들러 — http/https URL만 OS 기본 브라우저로 열기
  ipcMain.handle('open-external', (_, url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      shell.openExternal(url)
    }
  })

  // 이미지 클립보드 복사 — URL 또는 로컬 파일 경로의 이미지를 클립보드에 복사
  ipcMain.handle('copy-image-to-clipboard', async (_, imageUrl) => {
    const { clipboard } = require('electron')
    try {
      let image
      if (/^https?:\/\//i.test(imageUrl)) {
        // SSRF 가드 적용 fetch 로 통일 — 사설/메타데이터/루프백 및 리다이렉트 우회 차단(#66).
        const response = await guardedFetch(imageUrl, { signal: AbortSignal.timeout(5000) })
        if (!response || !response.ok) return false
        const buffer = Buffer.from(await response.arrayBuffer())
        image = nativeImage.createFromBuffer(buffer)
      } else {
        // 로컬 파일 경로
        const filePath = imageUrl.startsWith('file://') ? imageUrl.replace('file://', '') : imageUrl
        image = nativeImage.createFromPath(decodeURIComponent(filePath))
      }
      if (image.isEmpty()) return false
      clipboard.writeImage(image)
      return true
    } catch {
      return false
    }
  })

  // 패치노트 조회 — 전체 changelog 반환
  ipcMain.handle('get-changelog', () => loadChangelog(ctx))

  // 앱 버전 + 업데이트 여부 조회 — 일회성 소비 (재로그인 시 중복 표시 방지)
  ipcMain.handle('get-app-version-info', () => {
    const result = {
      currentVersion: app.getVersion(),
      updatedFromVersion: ctx.state.updatedFromVersion,
    }
    ctx.state.updatedFromVersion = null
    return result
  })

  // 업데이트 확인 IPC 핸들러 — dev에서는 즉시 not-available 반환
  ipcMain.handle('check-for-updates', async () => {
    if (ctx.config.isDev) {
      sendToRenderer(ctx, 'update-not-available')
      return
    }
    try {
      await autoUpdater.checkForUpdates()
    } catch (error) {
      // app-update.yml 누락 등 업데이트 확인 실패 시 에러 이벤트 전달
      console.error('[autoUpdater] 업데이트 확인 실패:', error.message)
      sendToRenderer(ctx, 'update-error', error.message || '업데이트 확인 실패')
    }
  })

  // 업데이트 설치 IPC 핸들러
  // macOS: ad-hoc 서명 앱은 Squirrel.Mac이 파일 교체를 거부하므로 shell script로 직접 교체
  ipcMain.handle('install-update', () => {
    if (process.platform === 'darwin' && ctx.state.downloadedUpdateFile && fs.existsSync(ctx.state.downloadedUpdateFile)) {
      const exePath = app.getPath('exe')
      const appBundlePath = exePath.includes('/Contents/MacOS/')
        ? exePath.split('/Contents/MacOS/')[0]
        : null

      if (appBundlePath) {
        // UUID로 고유 경로 생성 — symlink 공격 방지
        const updateId = uuidv4()
        const tempDir = path.join(os.tmpdir(), `lan-chat-update-${updateId}`)
        const scriptPath = path.join(os.tmpdir(), `lan-chat-update-${updateId}.sh`)

        const script = [
          '#!/bin/bash',
          'sleep 2',
          `TEMP_DIR="${tempDir}"`,
          `mkdir -p "$TEMP_DIR"`,
          `unzip -o "${ctx.state.downloadedUpdateFile}" -d "$TEMP_DIR"`,
          `APP=$(find "$TEMP_DIR" -name "*.app" | head -1)`,
          `if [ -n "$APP" ]; then`,
          // 기존 앱 백업 — 실패 시 롤백용
          `  BACKUP="${appBundlePath}.backup"`,
          `  cp -R "${appBundlePath}" "$BACKUP" 2>/dev/null`,
          `  rm -rf "${appBundlePath}"`,
          `  if ditto "$APP" "${appBundlePath}"; then`,
          `    rm -rf "$BACKUP"`,
          `    rm -f "${ctx.state.downloadedUpdateFile}"`,
          `    open "${appBundlePath}"`,
          `  else`,
          // 업데이트 실패 시 백업 복원
          `    rm -rf "${appBundlePath}"`,
          `    mv "$BACKUP" "${appBundlePath}" 2>/dev/null`,
          `    open "${appBundlePath}"`,
          `  fi`,
          `fi`,
          `rm -rf "$TEMP_DIR"`,
          `rm -f "${scriptPath}"`,
        ].join('\n')

        try {
          fs.writeFileSync(scriptPath, script, { mode: 0o755 })
          const child = spawn('bash', [scriptPath], {
            detached: true,
            stdio: 'ignore',
          })
          // 오류 이벤트 핸들러 등록 — 없으면 unhandled error로 main process crash
          child.on('error', (err) => {
            console.error('[install-update] 스크립트 실행 오류:', err.message)
          })
          child.unref()
          setTimeout(() => app.quit(), 500)
          return
        } catch (err) {
          console.error('[install-update] 스크립트 쓰기/실행 실패, fallback으로 전환:', err.message)
        }
      }
    }

    // macOS shell script 방식이 불가한 경우 fallback
    try {
      autoUpdater.quitAndInstall(false, true)
    } catch (err) {
      console.error('[install-update] quitAndInstall 실패, 강제 종료:', err.message)
      setTimeout(() => app.quit(), 500)
    }
  })
}

module.exports = { registerAppHandlers }
