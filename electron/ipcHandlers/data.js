// electron/ipcHandlers/data.js
// 데이터 관리 IPC 핸들러 — 전체 메시지 삭제, DM 삭제, 채팅 내보내기(#74)

const { ipcMain, dialog, app } = require('electron')
const fs = require('fs')
const path = require('path')
const {
  clearAllMessages, clearAllDMs,
  getGlobalMessagesForExport, getDMMessagesForExport,
} = require('../storage/queries')
const { deriveSharedSecretForPeer, decryptDMRecord } = require('./history')
const { formatMessagesAsText, formatMessageForJson } = require('../utils/exportFormatter')

// 삭제된 메시지가 참조하던 file_cache 파일들을 정리 — 다른 메시지가 참조할 수 없는
// messageId 1:1 캐시 파일이므로(cacheOwnFile/cacheReceivedFile 참고) 참조 카운트 없이
// 안전하게 삭제 가능 (#24, DB 행만 지우고 캐시 파일은 고아로 남던 문제).
function removeCachedFiles(cachedFilePaths) {
  for (const filePath of cachedFilePaths) {
    try { fs.unlinkSync(filePath) } catch { /* 이미 없거나 삭제 실패 시 무시 */ }
  }
}

// 채팅 내보내기(#74) 배치 크기 — 대량 채팅 대비 한 번에 메모리에 올리는 메시지 수를 제한하고,
// fs.createWriteStream 으로 배치마다 이어서 기록해(스트리밍) 파일 전체를 문자열로 합치지 않는다.
const EXPORT_BATCH_SIZE = 500

// scope/format 에 맞춰 배치 단위로 조회 → (DM 이면) 복호화 → 포맷 → 스트림에 기록.
// txt 는 배치마다 줄바꿈으로 이어붙이고, json 은 유효한 배열 문법을 유지하도록 콤마를 직접 관리한다.
function writeExportFile(ctx, { filePath, scope, peerId, format }) {
  return new Promise((resolve, reject) => {
    const writeStream = fs.createWriteStream(filePath, { encoding: 'utf8' })
    writeStream.on('error', reject)
    writeStream.on('finish', resolve)

    // DM 은 상대(peerId)가 고정이므로 공유키를 루프 밖에서 1회만 도출한다(history.js 와 동일 패턴).
    const sharedSecret = scope === 'dm' ? deriveSharedSecretForPeer(ctx, peerId) : null
    let offset = 0
    let isFirstJsonItem = true

    function finalizeAndEnd() {
      if (format === 'json') writeStream.write(isFirstJsonItem ? '[]' : '\n]\n')
      writeStream.end()
    }

    function pump() {
      const rawBatch = scope === 'dm'
        ? getDMMessagesForExport(ctx.state.database, ctx.state.peerId, peerId, EXPORT_BATCH_SIZE, offset)
        : getGlobalMessagesForExport(ctx.state.database, EXPORT_BATCH_SIZE, offset)

      if (rawBatch.length === 0) {
        finalizeAndEnd()
        return
      }

      const batch = scope === 'dm'
        ? rawBatch.map(msg => decryptDMRecord(ctx, msg, ctx.state.peerId, peerId, sharedSecret))
        : rawBatch

      if (format === 'txt') {
        writeStream.write(`${formatMessagesAsText(batch)}\n`)
      } else {
        const jsonChunk = batch.map((msg) => {
          const prefix = isFirstJsonItem ? '[\n' : ',\n'
          isFirstJsonItem = false
          return prefix + JSON.stringify(formatMessageForJson(msg), null, 2)
        }).join('')
        writeStream.write(jsonChunk)
      }

      offset += EXPORT_BATCH_SIZE
      if (rawBatch.length < EXPORT_BATCH_SIZE) {
        finalizeAndEnd()
      } else {
        // 재귀 대신 setImmediate 로 다음 배치를 예약해 대량 히스토리에서도 콜스택이 쌓이지 않게 한다.
        setImmediate(pump)
      }
    }

    pump()
  })
}

function registerDataHandlers(ctx) {
  // 전체 채팅 기록 삭제 (global + DM + pending 모두)
  ipcMain.handle('clear-all-messages', () => {
    const { cachedFilePaths } = clearAllMessages(ctx.state.database)
    removeCachedFiles(cachedFilePaths)
  })

  // DM 기록만 삭제
  ipcMain.handle('clear-all-dms', () => {
    const { cachedFilePaths } = clearAllDMs(ctx.state.database)
    removeCachedFiles(cachedFilePaths)
  })

  // 채팅 내보내기(#74) — 전체채팅/DM 기록을 txt(사람이 읽기 좋은 형식) 또는 json(구조화 배열)으로
  // 저장한다. DM 은 history.js 의 복호화 경로(deriveSharedSecretForPeer/decryptDMRecord)를 그대로
  // 재사용한다. 사용자가 명시적으로 내보내기를 요청한 것이므로 평문 파일 생성은 의도된 동작이다
  // (download-file 과 동일 성격 — LAN 전용 앱의 로컬 백업 용도).
  ipcMain.handle('export-chat-history', async (_, { scope, peerId, format } = {}) => {
    if (!ctx.state.database) return { ok: false, error: 'noDatabase' }
    if (scope !== 'global' && scope !== 'dm') return { ok: false, error: 'invalidScope' }
    if (scope === 'dm' && !peerId) return { ok: false, error: 'missingPeerId' }
    if (format !== 'txt' && format !== 'json') return { ok: false, error: 'invalidFormat' }

    const scopeLabel = scope === 'global' ? 'global' : `dm-${peerId}`
    const dateLabel = new Date().toISOString().slice(0, 10)
    const defaultFileName = `lan-chat-export-${scopeLabel}-${dateLabel}.${format}`
    const defaultPath = path.join(app.getPath('downloads'), defaultFileName)
    const dialogOptions = {
      defaultPath,
      filters: format === 'txt'
        ? [{ name: 'Text', extensions: ['txt'] }]
        : [{ name: 'JSON', extensions: ['json'] }],
    }

    const { canceled, filePath } = ctx.state.mainWindow
      ? await dialog.showSaveDialog(ctx.state.mainWindow, dialogOptions)
      : await dialog.showSaveDialog(dialogOptions)
    if (canceled || !filePath) return { ok: false, canceled: true }

    try {
      await writeExportFile(ctx, { filePath, scope, peerId, format })
      return { ok: true, path: filePath }
    } catch (err) {
      return { ok: false, error: 'writeError', message: err.message }
    }
  })
}

module.exports = { registerDataHandlers }
