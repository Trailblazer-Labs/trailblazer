import { app, BrowserWindow, nativeImage, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { registerIpc } from './ipc'
import { getDb } from './services/db'
import { initUpdater } from './services/updater'
import { checkReleaseGate } from './services/releaseGate'

// Override the default "Electron" app name shown in the macOS menu bar and Dock during dev.
// In packaged builds this comes from CFBundleName in Info.plist (set via productName).
app.setName('Trailblazer')

// One-time migration: if userData previously lived under the default "Electron" folder
// (because the app shipped without setName), move it under "Trailblazer" so projects,
// auth and the local DB survive the rename.
migrateLegacyUserData()

function migrateLegacyUserData() {
  try {
    const appData = app.getPath('appData')
    const legacy = path.join(appData, 'Electron')
    const current = path.join(appData, 'Trailblazer')
    if (
      fs.existsSync(path.join(legacy, 'trailblazer.db')) &&
      !fs.existsSync(path.join(current, 'trailblazer.db'))
    ) {
      fs.mkdirSync(current, { recursive: true })
      for (const entry of fs.readdirSync(legacy)) {
        const from = path.join(legacy, entry)
        const to = path.join(current, entry)
        if (!fs.existsSync(to)) fs.renameSync(from, to)
      }
      // eslint-disable-next-line no-console
      console.log('[migration] moved userData from Electron → Trailblazer')
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[migration] failed:', e)
  }
}

function resolveIconPath(): string | null {
  // In dev, build/ lives next to the source. In packaged builds, electron-builder
  // bakes the icon into the .app and Electron resolves it from there — but dock
  // override during dev still benefits from this.
  const candidates = [
    path.join(app.getAppPath(), 'build/icon.png'),
    path.join(__dirname, '../../build/icon.png'),
    path.join(process.cwd(), 'build/icon.png')
  ]
  return candidates.find((p) => fs.existsSync(p)) ?? null
}

let win: BrowserWindow | null = null

function createWindow() {
  const iconPath = resolveIconPath()
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0f0f0f',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    icon: iconPath ?? undefined,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false
    }
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  registerIpc(win)
  initUpdater(win)
}

app.whenReady().then(() => {
  getDb() // init/migrate db
  void checkReleaseGate()
  if (process.platform === 'darwin') {
    const iconPath = resolveIconPath()
    if (iconPath) app.dock?.setIcon(nativeImage.createFromPath(iconPath))
  }
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
