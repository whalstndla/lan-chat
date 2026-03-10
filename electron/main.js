const { app, BrowserWindow } = require('electron')
const path = require('path')

const 개발모드 = process.env.NODE_ENV !== 'production'

function 윈도우생성() {
  const 윈도우 = new BrowserWindow({
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
    윈도우.loadURL('http://localhost:5173')
  } else {
    윈도우.loadFile(path.join(__dirname, '../dist/renderer/index.html'))
  }
}

app.whenReady().then(윈도우생성)
app.on('window-all-closed', () => app.quit())
