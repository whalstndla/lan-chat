// loadOrCreateKeyPair는 appDataPath에 private_key.pem을 저장한다.
// 테스트에서는 각 노드별로 격리된 임시 디렉토리를 할당해 키쌍 충돌을 방지한다.

const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')

function createTempAppDataPath(suffix = '') {
  const id = crypto.randomBytes(6).toString('hex')
  const dir = path.join(os.tmpdir(), `lan-chat-test-${id}${suffix ? '-' + suffix : ''}`)
  fs.mkdirSync(dir, { recursive: true })
  fs.mkdirSync(path.join(dir, 'files'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'profile'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'file_cache'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'logs'), { recursive: true })
  return dir
}

function removeTempAppDataPath(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* 무시 */ }
}

module.exports = { createTempAppDataPath, removeTempAppDataPath }
