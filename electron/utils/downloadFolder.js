// electron/utils/downloadFolder.js
// 기본 다운로드 폴더 설정(#74) — 사용자가 지정한 폴더를 파일로 영속 저장(autoLaunch.js 와 동일한
// "appData 에 JSON 1개" 패턴). electron/ipcHandlers/file.js 의 download-file IPC 가 저장 다이얼로그
// 기본 경로로 사용하며, 미설정/유효하지 않으면(폴더가 삭제된 경우 등) OS 기본 다운로드 폴더로 폴백한다.

const fs = require('fs')
const path = require('path')

const DOWNLOAD_FOLDER_PREFERENCE_FILENAME = 'download-folder.json'

function downloadFolderPreferencePath(appDataPath) {
  return path.join(appDataPath, DOWNLOAD_FOLDER_PREFERENCE_FILENAME)
}

// 저장된 다운로드 폴더 경로 로드 — 파일 없음/파싱 실패/경로가 더 이상 존재하지 않으면 null
// (null 이면 호출부가 OS 기본 다운로드 폴더로 폴백한다).
function loadDownloadFolderPath(appDataPath) {
  try {
    const raw = fs.readFileSync(downloadFolderPreferencePath(appDataPath), 'utf8')
    const parsed = JSON.parse(raw)
    const folderPath = typeof parsed?.folderPath === 'string' ? parsed.folderPath : null
    if (folderPath && fs.existsSync(folderPath)) return folderPath
    return null
  } catch {
    return null
  }
}

// 다운로드 폴더 경로 저장 — 실패해도 무시(다음 실행은 OS 기본값으로 폴백할 뿐 치명적이지 않음).
function saveDownloadFolderPath(appDataPath, folderPath) {
  try {
    fs.writeFileSync(downloadFolderPreferencePath(appDataPath), JSON.stringify({ folderPath: folderPath || null }))
  } catch { /* 저장 실패 무시 */ }
}

// download-file IPC 가 사용할 기본 다운로드 폴더 — 사용자 지정 폴더가 유효하면 그것을,
// 아니면 OS 기본 다운로드 폴더(osDownloadsPath)로 폴백한다.
function resolveDownloadFolderPath(appDataPath, osDownloadsPath) {
  return loadDownloadFolderPath(appDataPath) || osDownloadsPath
}

module.exports = {
  DOWNLOAD_FOLDER_PREFERENCE_FILENAME,
  downloadFolderPreferencePath,
  loadDownloadFolderPath,
  saveDownloadFolderPath,
  resolveDownloadFolderPath,
}
