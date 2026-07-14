// electron/utils/downloadUtils.js
// 다운로드 저장 파일명 결정 순수 로직 — Electron 런타임 의존성 없음 (단위 테스트 용이성을 위해 분리)

const path = require('path')

// 저장 다이얼로그에 표시할 기본 파일명을 결정한다.
// 원본 file_name 이 있으면 그대로 사용하고, 없으면 캐시 파일 경로의 basename 으로 폴백,
// 그마저도 없으면 'download' 를 반환한다.
function resolveDownloadFileName(fileName, cachedFilePath) {
  if (fileName && fileName.trim()) return fileName
  if (cachedFilePath) return path.basename(cachedFilePath)
  return 'download'
}

module.exports = { resolveDownloadFileName }
