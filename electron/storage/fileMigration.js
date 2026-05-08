// 부팅 시 1회 실행되는 평문 파일 → ciphertext 마이그레이션.
// 대상: appDataPath/files/, appDataPath/file_cache/ 의 모든 파일.
// 이미 암호화된 파일(magic LCEF)은 건너뛴다.
//
// 디스크에 평문이 남아 있으면 OS 계정만 뚫리면 그대로 노출되므로,
// "디스크 직접 접근 시 암호화 유지" 약속을 지키기 위해 반드시 1회 통과해야 한다.

const fs = require('fs')
const path = require('path')
const { encryptBuffer, isEncryptedFile } = require('../crypto/fileEncryption')

function encryptDirectoryInPlace(dirPath, masterKey) {
  if (!fs.existsSync(dirPath)) return { converted: 0, skipped: 0, failed: 0 }

  const entries = fs.readdirSync(dirPath)
  let converted = 0
  let skipped = 0
  let failed = 0

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry)
    let stat
    try { stat = fs.statSync(fullPath) } catch { failed++; continue }
    if (!stat.isFile()) { skipped++; continue }

    let raw
    try { raw = fs.readFileSync(fullPath) } catch { failed++; continue }

    if (isEncryptedFile(raw)) { skipped++; continue }

    try {
      const ciphertext = encryptBuffer(raw, masterKey)
      // 원자적 교체 — 임시파일에 쓰고 rename
      const tmpPath = `${fullPath}.tmp-enc-${process.pid}`
      fs.writeFileSync(tmpPath, ciphertext, { mode: 0o600 })
      fs.renameSync(tmpPath, fullPath)
      converted++
    } catch {
      failed++
    }
  }

  return { converted, skipped, failed }
}

function migratePlaintextFiles(appDataPath, masterKey) {
  if (!masterKey) throw new Error('masterKey 가 없으면 마이그레이션 불가')
  const dirs = [
    path.join(appDataPath, 'files'),
    path.join(appDataPath, 'file_cache'),
  ]
  const summary = { converted: 0, skipped: 0, failed: 0 }
  for (const dir of dirs) {
    const result = encryptDirectoryInPlace(dir, masterKey)
    summary.converted += result.converted
    summary.skipped += result.skipped
    summary.failed += result.failed
  }
  return summary
}

module.exports = { migratePlaintextFiles, encryptDirectoryInPlace }
