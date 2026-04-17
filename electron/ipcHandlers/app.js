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

function registerAppHandlers(ctx) {
  // 링크 프리뷰 OG 메타데이터 추출 — 메인 프로세스에서 fetch (CORS 제한 없음)
  ipcMain.handle('fetch-link-preview', async (_, url) => {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
        signal: AbortSignal.timeout(5000),
      })
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
        const { net } = require('electron')
        const buffer = await new Promise((resolve, reject) => {
          const request = net.request(imageUrl)
          const chunks = []
          request.on('response', (response) => {
            response.on('data', (chunk) => chunks.push(chunk))
            response.on('end', () => resolve(Buffer.concat(chunks)))
            response.on('error', reject)
          })
          request.on('error', reject)
          request.end()
        })
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
