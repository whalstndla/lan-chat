// tests/utils/downloadFolder.test.js
// 기본 다운로드 폴더 설정(#74) 순수 로직 단위 테스트 — Electron 런타임 불필요.
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  loadDownloadFolderPath, saveDownloadFolderPath, resolveDownloadFolderPath, downloadFolderPreferencePath,
} = require('../../electron/utils/downloadFolder')

describe('다운로드 폴더 설정(downloadFolder)', () => {
  let appDataDir
  let chosenFolderDir

  beforeEach(() => {
    appDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lan-chat-download-folder-appdata-'))
    chosenFolderDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lan-chat-download-folder-chosen-'))
  })

  afterEach(() => {
    fs.rmSync(appDataDir, { recursive: true, force: true })
    fs.rmSync(chosenFolderDir, { recursive: true, force: true })
  })

  it('저장된 설정이 없으면 null 을 반환한다', () => {
    expect(loadDownloadFolderPath(appDataDir)).toBeNull()
  })

  it('저장한 폴더 경로를 그대로 읽어온다', () => {
    saveDownloadFolderPath(appDataDir, chosenFolderDir)
    expect(loadDownloadFolderPath(appDataDir)).toBe(chosenFolderDir)
  })

  it('손상된 JSON 이면 null 로 폴백한다', () => {
    fs.writeFileSync(downloadFolderPreferencePath(appDataDir), '{broken')
    expect(loadDownloadFolderPath(appDataDir)).toBeNull()
  })

  it('저장된 폴더가 더 이상 존재하지 않으면 null 로 폴백한다', () => {
    saveDownloadFolderPath(appDataDir, chosenFolderDir)
    fs.rmSync(chosenFolderDir, { recursive: true, force: true })
    expect(loadDownloadFolderPath(appDataDir)).toBeNull()
  })

  it('null 로 저장하면(초기화) 이후 조회 시 null 을 반환한다', () => {
    saveDownloadFolderPath(appDataDir, chosenFolderDir)
    saveDownloadFolderPath(appDataDir, null)
    expect(loadDownloadFolderPath(appDataDir)).toBeNull()
  })

  describe('resolveDownloadFolderPath', () => {
    it('사용자 지정 폴더가 있으면 그 경로를 사용한다', () => {
      saveDownloadFolderPath(appDataDir, chosenFolderDir)
      expect(resolveDownloadFolderPath(appDataDir, '/os/default/downloads')).toBe(chosenFolderDir)
    })

    it('사용자 지정 폴더가 없으면 OS 기본 다운로드 폴더로 폴백한다', () => {
      expect(resolveDownloadFolderPath(appDataDir, '/os/default/downloads')).toBe('/os/default/downloads')
    })
  })
})
