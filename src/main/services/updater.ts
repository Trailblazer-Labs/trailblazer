import { app, BrowserWindow } from 'electron'
import { createRequire } from 'node:module'
import { IPC } from '@shared/ipc'
import type { UpdateStatus } from '@shared/types'

interface UpdateInfo {
  version?: string
}

interface ProgressInfo {
  percent?: number
}

interface AppUpdater {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  allowPrerelease: boolean
  checkForUpdates: () => Promise<unknown>
  downloadUpdate: () => Promise<unknown>
  quitAndInstall: (isSilent?: boolean, isForceRunAfter?: boolean) => void
  on: (event: string, listener: (...args: unknown[]) => void) => AppUpdater
}

const require = createRequire(__filename)

let updater: AppUpdater | null = null
let mainWindow: BrowserWindow | null = null
let startupCheckTimer: NodeJS.Timeout | null = null
let status: UpdateStatus = {
  state: 'idle',
  currentVersion: app.getVersion(),
  availableVersion: null,
  downloadedVersion: null,
  percent: null,
  message: null,
  checkedAt: null
}

function publish(next: Partial<UpdateStatus>) {
  status = {
    ...status,
    ...next,
    currentVersion: app.getVersion()
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.updaterEvent, status)
  }
}

function setDisabled(message: string) {
  publish({
    state: 'disabled',
    message,
    availableVersion: null,
    downloadedVersion: null,
    percent: null
  })
}

function loadUpdater(): AppUpdater | null {
  if (!app.isPackaged) {
    setDisabled('Update checks run in packaged builds.')
    return null
  }

  try {
    const mod = require('electron-updater') as { autoUpdater: AppUpdater }
    return mod.autoUpdater
  } catch (e) {
    setDisabled(e instanceof Error ? e.message : 'electron-updater is not installed.')
    return null
  }
}

export function initUpdater(win: BrowserWindow) {
  mainWindow = win
  if (updater) return

  updater = loadUpdater()
  if (!updater) return

  updater.autoDownload = false
  updater.autoInstallOnAppQuit = true
  updater.allowPrerelease = true

  updater.on('checking-for-update', () => {
    publish({
      state: 'checking',
      message: null,
      percent: null,
      checkedAt: new Date().toISOString()
    })
  })

  updater.on('update-available', (info) => {
    const version = (info as UpdateInfo).version ?? null
    publish({
      state: 'available',
      availableVersion: version,
      downloadedVersion: null,
      percent: null,
      message: null
    })
  })

  updater.on('update-not-available', () => {
    publish({
      state: 'not-available',
      availableVersion: null,
      downloadedVersion: null,
      percent: null,
      message: null
    })
  })

  updater.on('download-progress', (progress) => {
    publish({
      state: 'downloading',
      percent: Math.round(((progress as ProgressInfo).percent ?? 0) * 10) / 10,
      message: null
    })
  })

  updater.on('update-downloaded', (info) => {
    const version = (info as UpdateInfo).version ?? status.availableVersion
    publish({
      state: 'downloaded',
      downloadedVersion: version,
      availableVersion: version,
      percent: 100,
      message: null
    })
  })

  updater.on('error', (error) => {
    publish({
      state: 'error',
      message: error instanceof Error ? error.message : String(error),
      percent: null
    })
  })

  if (startupCheckTimer) clearTimeout(startupCheckTimer)
  startupCheckTimer = setTimeout(() => {
    void checkForUpdates()
  }, 10_000)
}

export function getUpdateStatus(): UpdateStatus {
  return status
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  if (!updater) return status
  if (status.state === 'checking' || status.state === 'downloading') return status
  await updater.checkForUpdates()
  return status
}

export async function downloadUpdate(): Promise<UpdateStatus> {
  if (!updater) return status
  if (status.state !== 'available') return status
  publish({ state: 'downloading', percent: 0, message: null })
  await updater.downloadUpdate()
  return status
}

export function quitAndInstall() {
  if (!updater || status.state !== 'downloaded') return status
  updater.quitAndInstall(false, true)
  return status
}
