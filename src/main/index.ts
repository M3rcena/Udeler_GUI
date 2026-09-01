import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { app, BrowserWindow, dialog, protocol, session, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import * as fs from 'fs-extra'
import * as path from 'path'
import { join } from 'path'
import { Readable } from 'stream'
import { Worker } from 'worker_threads'
import icon from '../../resources/icon.png?asset'
import {
  AppSettings,
  Course,
  CourseVolumeMapping,
  CurriculumItem,
  DownloadedFile,
  DownloadRequest,
  IntegrityIssue,
  SearchResult,
  VolumeRow
} from '../preload/types/ipc-types'
import {
  getAllVolumes,
  getBlobsForCourse,
  getCourseVolumeMappings,
  getStorageStats,
  initDb,
  pinCourseToVolume,
  registerVolume,
  runGarbageCollector,
  unpinCourseFromVolume,
  unregisterVolume
} from './database/db'
import { store } from './database/store'
import {
  cancelDownload,
  deleteLectureFile,
  pauseDownload,
  processDownload,
  scanExistingDownloads
} from './download'
import { initDownloadScheduler } from './network/scheduler'
import {
  handleSetProgressBar,
  handleSetRecentCourse,
  handleSetTrayTooltip,
  handleUpdateQueueMenu,
  setupOSIntegration
} from './os/os-integration'
import { handleSearchQuery, rebuildIndex } from './os/search-service'
import { getAuditStats, registerSecureIpc } from './security/audit'
import {
  decryptFileSync,
  decryptToken,
  encryptToken,
  getVaultKey,
  isFileEncrypted,
  VAULT_MAGIC_HEADER,
  VaultDecryptStream
} from './security/vault'
import { fetchCourseCurriculum, fetchSubscribedCourses } from './udemy'
import { startVolumeWatcher } from './workers/volume-watcher'

async function moveCourseFiles(
  courseId: number,
  courseTitle: string,
  sourceRoot: string,
  destRoot: string
): Promise<void> {
  const cleanCourseName = courseTitle.replace(/[<>:"/\\|?*]+/g, '-').trim()
  const sourceCourse = path.join(sourceRoot, cleanCourseName)
  const destCourse = path.join(destRoot, cleanCourseName)

  if (fs.existsSync(sourceCourse)) {
    try {
      await fs.move(sourceCourse, destCourse, { overwrite: true })
    } catch (err) {
      console.error('Failed to move course directory:', err)
    }
  }

  const blobsToMove = getBlobsForCourse(courseId)
  const sourceBlobsDir = path.join(sourceRoot, '.blobs')
  const destBlobsDir = path.join(destRoot, '.blobs')

  if (blobsToMove.length > 0 && fs.existsSync(sourceBlobsDir)) {
    await fs.ensureDir(destBlobsDir)
    for (const blob of blobsToMove) {
      const fileName = blob.hash + blob.ext
      const sourceBlob = path.join(sourceBlobsDir, fileName)
      const destBlob = path.join(destBlobsDir, fileName)

      if (fs.existsSync(sourceBlob)) {
        try {
          await fs.move(sourceBlob, destBlob, { overwrite: true })
        } catch (err) {
          console.error(`Failed to move blob ${fileName}:`, err)
        }
      }
    }
  }
}

// --- GLOBAL ERROR LOGGER ---
const debugLogs: string[] = []
const originalConsoleError = console.error
console.error = (...args) => {
  const timestamp = new Date().toISOString()
  const message = args
    .map((a) =>
      typeof a === 'object' && a !== null
        ? JSON.stringify(a, Object.getOwnPropertyNames(a))
        : String(a)
    )
    .join(' ')
  debugLogs.push(`[ERROR] [${timestamp}] ${message}`)
  originalConsoleError(...args)
}

process.on('uncaughtException', (error) => {
  console.error('UncaughtException:', error)
})
process.on('unhandledRejection', (reason) => {
  console.error('UnhandledRejection:', reason)
})

let mainWindow: BrowserWindow | null = null
let isQuitting = false

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    show: false,
    autoHideMenuBar: true,
    icon: icon,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow!.maximize()
    mainWindow!.show()
  })

  mainWindow.on('close', (event) => {
    const settings = store.get('app_settings') as AppSettings | undefined

    if (!isQuitting && settings?.closeToTray) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  setupOSIntegration(mainWindow, icon)
  initDownloadScheduler(mainWindow, store)

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  startVolumeWatcher(mainWindow)
}

function createUpdaterWindow(): void {
  const updaterWindow = new BrowserWindow({
    width: 320,
    height: 420,
    frame: false,
    transparent: true,
    resizable: false,
    show: false,
    icon: icon,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  })

  const updaterHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <style>
          body {
            font-family: system-ui, -apple-system, sans-serif;
            background: #09090e;
            color: white;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
            border-radius: 16px;
            border: 1px solid rgba(255,255,255,0.05);
            overflow: hidden;
            -webkit-app-region: drag;
            user-select: none;
            padding: 20px;
            box-sizing: border-box;
          }
          .logo {
            width: 60px;
            height: 60px;
            background: linear-gradient(to top right, #2563eb, #9333ea);
            border-radius: 20px;
            display: flex;
            align-items: center;
            justify-content: center;
            margin-bottom: 16px;
            box-shadow: 0 10px 25px rgba(37, 99, 235, 0.3);
          }
          .title { font-size: 20px; font-weight: 900; margin-bottom: 6px; letter-spacing: -0.5px; }
          .status { font-size: 13px; color: #9ca3af; font-weight: 500; margin-bottom: 12px; }
          .release-notes {
            width: 100%;
            max-height: 90px;
            overflow-y: auto;
            background: rgba(255,255,255,0.03);
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 8px;
            padding: 8px 12px;
            font-size: 11px;
            color: #d1d5db;
            margin-bottom: 16px;
            display: none;
            text-align: left;
            white-space: pre-wrap;
            box-sizing: border-box;
            user-select: text;
            -webkit-app-region: no-drag;
          }
          .progress-track { width: 220px; height: 6px; background: rgba(255,255,255,0.1); border-radius: 8px; overflow: hidden; }
          .progress-fill { height: 100%; background: linear-gradient(to right, #3b82f6, #a855f7); width: 0%; transition: width 0.2s ease-out; }
        </style>
      </head>
      <body>
        <div class="logo">
          <svg style="width: 32px; height: 32px; color: white;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path>
          </svg>
        </div>
        <div class="title">Udeler Reborn</div>
        <div class="status" id="status">Checking for updates...</div>
        <div class="release-notes" id="notes"></div>
        <div class="progress-track">
          <div class="progress-fill" id="fill"></div>
        </div>
        <script>
          const { ipcRenderer } = require('electron')
          ipcRenderer.on('update-status', (e, text) => { document.getElementById('status').innerText = text })
          ipcRenderer.on('update-notes', (e, notes) => {
            const el = document.getElementById('notes')
            if (notes) {
              el.innerText = notes
              el.style.display = 'block'
            }
          })
          ipcRenderer.on('update-progress', (e, percent) => { document.getElementById('fill').style.width = percent + '%' })
        </script>
      </body>
    </html>
  `

  updaterWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(updaterHtml)}`)

  updaterWindow.once('ready-to-show', () => {
    updaterWindow.show()
    autoUpdater.checkForUpdates()
  })

  autoUpdater.on('checking-for-update', () => {
    updaterWindow.webContents.send('update-status', 'Looking for updates...')
  })

  autoUpdater.on('update-available', () => {
    updaterWindow.webContents.send('update-status', 'Update found! Downloading...')
  })

  autoUpdater.on('update-not-available', () => {
    updaterWindow.webContents.send('update-status', 'Starting Udeler...')
    setTimeout(() => {
      updaterWindow.close()
      createWindow()
    }, 1000)
  })

  autoUpdater.on('error', (err) => {
    console.error('Updater Error:', err)
    updaterWindow.webContents.send('update-status', 'Update failed. Starting app...')
    setTimeout(() => {
      updaterWindow.close()
      createWindow()
    }, 1500)
  })

  autoUpdater.on('download-progress', (progressObj) => {
    const percent = Math.round(progressObj.percent)
    updaterWindow.webContents.send('update-status', `Downloading... ${percent}%`)
    updaterWindow.webContents.send('update-progress', percent)
  })

  autoUpdater.on('update-downloaded', () => {
    updaterWindow.webContents.send('update-status', 'Ready! Restarting...')
    setTimeout(() => {
      autoUpdater.quitAndInstall()
    }, 1500)
  })
}

const isWindowsStore = Boolean(process.windowsStore)

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.m3rcena.udeler')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    console.warn(
      `[SECURITY] Blocked permission request for '${permission}' from ${webContents.getURL()}`
    )
    callback(false)
  })

  registerSecureIpc('get-security-audit-stats', () => {
    return getAuditStats()
  })

  registerSecureIpc('export-debug-logs', async (): Promise<boolean> => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Save Debug Logs',
      defaultPath: 'udeler-debug-logs.txt',
      filters: [{ name: 'Text Files', extensions: ['txt'] }]
    })

    if (!canceled && filePath) {
      const header = `=== Udeler Reborn Diagnostic Logs ===\nGenerated: ${new Date().toISOString()}\n\n`
      const logContent =
        debugLogs.length > 0 ? debugLogs.join('\n') : 'No backend errors recorded in this session.'

      fs.writeFileSync(filePath, header + logContent, 'utf-8')
      return true
    }
    return false
  })

  registerSecureIpc('store-get', (_event, key: string): unknown => {
    const value = store.get(key)
    if (key === 'udemy_token' && typeof value === 'string') {
      return decryptToken(value)
    }
    return value
  })

  registerSecureIpc('store-set', (_event, key: string, value: unknown): void => {
    if (key === 'udemy_token' && typeof value === 'string') {
      store.set(key, encryptToken(value))
    } else {
      store.set(key, value)
    }
    if (key === 'app_settings') {
      const s = value as AppSettings
      if (s.downloadPath) initDb(s.downloadPath)
    }
  })

  registerSecureIpc('store-delete', (_event, key: string): void => {
    store.delete(key)
  })

  registerSecureIpc('get-storage-stats', (): number => {
    return getStorageStats()
  })

  registerSecureIpc(
    'run-garbage-collector',
    async (): Promise<{ purgedCount: number; freedBytes: number; newTotalReclaimed: number }> => {
      const settings = store.get('app_settings') as AppSettings | undefined
      if (!settings || !settings.downloadPath)
        return { purgedCount: 0, freedBytes: 0, newTotalReclaimed: 0 }
      return runGarbageCollector(settings.downloadPath)
    }
  )

  registerSecureIpc('fetch-courses', async (): Promise<Course[]> => {
    const token = store.get('udemy_token') as string | undefined
    const subdomain = store.get('udemy_subdomain') as string | undefined
    if (!token) throw new Error('No token found')

    const rawCourses = await fetchSubscribedCourses(token, subdomain)

    return rawCourses.map((c) => ({
      id: c.id,
      title: c.title,
      url: c.url,
      image_480x270: c.image_480x270 || ''
    }))
  })

  registerSecureIpc(
    'fetch-curriculum',
    async (_event, courseId: number): Promise<CurriculumItem[]> => {
      const token = store.get('udemy_token') as string | undefined
      const subdomain = store.get('udemy_subdomain') as string | undefined
      if (!token) throw new Error('No token found')

      const rawItems = await fetchCourseCurriculum(token, courseId, subdomain)

      return rawItems.map((item): CurriculumItem => {
        const mappedItem: CurriculumItem = {
          id: item.id,
          title: item.title,
          _class: item._class as 'chapter' | 'lecture' | 'quiz' | 'practice'
        }

        if (item.asset && item.asset.asset_type) {
          mappedItem.asset = {
            asset_type: item.asset.asset_type,
            time_estimation: item.asset.time_estimation ?? undefined
          }
        }

        return mappedItem
      })
    }
  )

  registerSecureIpc('select-folder', async (): Promise<string | null> => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select Download Folder'
    })

    if (!canceled && filePaths.length > 0) {
      return filePaths[0]
    }
    return null
  })

  registerSecureIpc('get-volume-mappings', (): Record<number, CourseVolumeMapping> => {
    return getCourseVolumeMappings()
  })

  registerSecureIpc('register-volume', async (): Promise<string | null> => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select External Drive or NAS Folder'
    })
    if (!canceled && filePaths.length > 0) {
      const rootPath = filePaths[0]
      const driveName = path.basename(rootPath) || rootPath
      const volumeId = crypto.randomUUID()
      registerVolume(volumeId, driveName, rootPath)
      return volumeId
    }
    return null
  })

  registerSecureIpc('get-all-volumes', (): VolumeRow[] => {
    return getAllVolumes()
  })

  registerSecureIpc(
    'pin-course',
    async (
      _event,
      courseId: number,
      courseTitle: string,
      volumeId: string,
      shouldMove: boolean
    ): Promise<boolean> => {
      if (shouldMove) {
        const settings = store.get('app_settings') as AppSettings | undefined
        const allVolumes = getAllVolumes()
        const targetVol = allVolumes.find((v) => v.id === volumeId)

        if (settings?.downloadPath && targetVol?.root_path && targetVol.is_available === 1) {
          await moveCourseFiles(courseId, courseTitle, settings.downloadPath, targetVol.root_path)
        }
      }

      pinCourseToVolume(courseId, volumeId)
      return true
    }
  )

  registerSecureIpc(
    'unpin-course',
    async (
      _event,
      courseId: number,
      courseTitle: string,
      shouldMove: boolean
    ): Promise<boolean> => {
      const volumeMappings = getCourseVolumeMappings()
      const mapping = volumeMappings[courseId]
      if (!mapping) return false

      const volumeId = mapping.volumeId

      if (shouldMove && mapping.isAvailable) {
        const settings = store.get('app_settings') as AppSettings | undefined
        if (settings?.downloadPath && mapping.rootPath) {
          await moveCourseFiles(courseId, courseTitle, mapping.rootPath, settings.downloadPath)
        }
      }

      unpinCourseFromVolume(courseId)

      const updatedMappings = getCourseVolumeMappings()
      const isVolumeStillUsed = Object.values(updatedMappings).some((m) => m.volumeId === volumeId)

      if (!isVolumeStillUsed) {
        unregisterVolume(volumeId)
      }

      return true
    }
  )

  registerSecureIpc(
    'start-download',
    async (
      _event,
      req: Omit<
        DownloadRequest,
        | 'token'
        | 'downloadPath'
        | 'videoQuality'
        | 'skipAttachments'
        | 'skipSubtitles'
        | 'autoRetry'
      >
    ): Promise<string> => {
      const token = store.get('udemy_token') as string | undefined
      const settings = store.get('app_settings') as AppSettings | undefined

      if (!token) throw new Error('No token found')
      if (!settings || !settings.downloadPath) throw new Error('No download path set in settings!')

      const volumeMappings = getCourseVolumeMappings()
      const courseVolume = volumeMappings[req.courseId]
      let finalDownloadPath = settings.downloadPath

      if (courseVolume) {
        if (!courseVolume.isAvailable) throw new Error('Target drive is currently offline')
        finalDownloadPath = courseVolume.rootPath
      }

      const fullRequest: DownloadRequest = {
        ...req,
        token,
        downloadPath: finalDownloadPath,
        videoQuality: settings.videoQuality || 'Auto',
        skipAttachments: settings.skipAttachments ?? false,
        skipSubtitles: settings.skipSubtitles ?? false,
        autoRetry: settings.autoRetry ?? false,
        maxKbps: settings.maxKbps || 0
      }

      return await processDownload(fullRequest)
    }
  )

  registerSecureIpc('get-all-downloads', async (): Promise<DownloadedFile[]> => {
    const settings = store.get('app_settings') as AppSettings | undefined
    if (!settings || !settings.downloadPath) return []

    const cachedDownloads = (store.get('cached_downloads') || []) as DownloadedFile[]
    const newDownloads: DownloadedFile[] = []

    const allVolumes = getAllVolumes()
    const volumeMappings = getCourseVolumeMappings()

    const activePinnedVolumeIds = new Set(Object.values(volumeMappings).map((m) => m.volumeId))

    const offlineVolumeIds = new Set<string>()

    for (const vol of allVolumes) {
      if (vol.is_available === 0 && activePinnedVolumeIds.has(vol.id)) {
        offlineVolumeIds.add(vol.id)
      }
    }

    const scanDrive = (basePath: string, volId: string, volName: string): void => {
      if (!fs.existsSync(basePath)) return

      const courses = fs.readdirSync(basePath)
      for (const course of courses) {
        if (course.startsWith('.')) continue

        const coursePath = path.join(basePath, course)
        if (!fs.statSync(coursePath).isDirectory()) continue

        const chapters = fs.readdirSync(coursePath)
        for (const chapter of chapters) {
          const chapterPath = path.join(coursePath, chapter)
          if (!fs.statSync(chapterPath).isDirectory()) continue

          const files = fs.readdirSync(chapterPath)
          const vttFiles = files.filter((f: string) => f.endsWith('.vtt'))

          for (const file of files) {
            if (file.endsWith('.vtt')) continue
            const filePath = path.join(chapterPath, file)
            const type = file.endsWith('.mp4')
              ? 'Video'
              : file.endsWith('.html')
                ? 'Article'
                : 'File'
            const stat = fs.statSync(filePath)
            const sizeMB = Math.round(stat.size / (1024 * 1024))

            const item: DownloadedFile = {
              course,
              chapter,
              file,
              path: filePath,
              type: type as 'Video' | 'Article' | 'File',
              size: sizeMB,
              volumeId: volId,
              volumeName: volName,
              isOffline: false
            }

            if (type === 'Video') {
              const baseName = file.replace('.mp4', '')
              item.subtitles = vttFiles
                .filter((vtt: string) => vtt.startsWith(baseName))
                .map((vtt: string) => {
                  let label = vtt.replace(baseName + '_', '').replace('.vtt', '')
                  label = label.replace('.autogenerated', ' (Auto)')
                  if (label === vtt.replace('.vtt', '')) label = 'English (Auto)'

                  let srcLang = 'en'
                  const lower = label.toLowerCase()
                  if (lower.includes('es_') || lower.includes('spanish')) srcLang = 'es'
                  else if (lower.includes('pt_') || lower.includes('portuguese')) srcLang = 'pt'
                  else if (lower.includes('fr_') || lower.includes('french')) srcLang = 'fr'
                  else if (lower.includes('de_') || lower.includes('german')) srcLang = 'de'
                  else if (lower.includes('it_') || lower.includes('italian')) srcLang = 'it'
                  else if (lower.includes('ja_') || lower.includes('japanese')) srcLang = 'ja'
                  else if (lower.includes('zh_') || lower.includes('chinese')) srcLang = 'zh'
                  else if (lower.includes('ar_') || lower.includes('arabic')) srcLang = 'ar'
                  else {
                    const match = label.match(/^([a-zA-Z]{2})[_-]/)
                    if (match) srcLang = match[1].toLowerCase()
                  }

                  const vttPath = path.join(chapterPath, vtt)
                  let vttContent = ''

                  if (isFileEncrypted(vttPath)) {
                    const vaultKey = getVaultKey()
                    if (vaultKey) {
                      try {
                        const decrypted: Buffer = decryptFileSync(vttPath, vaultKey)
                        vttContent = decrypted.toString('utf8')
                      } catch (err: unknown) {
                        console.error('Failed to decrypt VTT:', err)
                        return { label, srcLang, path: '' }
                      }
                    }
                  } else {
                    vttContent = fs.readFileSync(vttPath, 'utf8')
                  }

                  vttContent = vttContent.replace(/^\uFEFF/, '').trim()
                  if (!vttContent.startsWith('WEBVTT')) {
                    vttContent = 'WEBVTT\n\n' + vttContent
                  }

                  const base64Vtt = Buffer.from(vttContent).toString('base64')
                  const dataUri = `data:text/vtt;charset=utf-8;base64,${base64Vtt}`
                  return { label, srcLang, path: dataUri }
                })
            }
            newDownloads.push(item)
          }
        }
      }
    }

    scanDrive(settings.downloadPath, 'default', `Local Drive (${settings.downloadPath})`)

    for (const vol of allVolumes) {
      if (vol.is_available === 1 && vol.root_path && activePinnedVolumeIds.has(vol.id)) {
        scanDrive(vol.root_path, vol.id, `${vol.name} (${vol.root_path})`)
      }
    }

    for (const cached of cachedDownloads) {
      if (cached.volumeId && offlineVolumeIds.has(cached.volumeId)) {
        newDownloads.push({ ...cached, isOffline: true })
      }
    }

    store.set('cached_downloads', newDownloads)

    return newDownloads
  })

  registerSecureIpc(
    'check-local-downloads',
    async (_event, courseTitle: string): Promise<Record<number, string>> => {
      const settings = store.get('app_settings') as AppSettings | undefined
      if (!settings || !settings.downloadPath) return {}

      const basePaths = new Set<string>()
      basePaths.add(settings.downloadPath)

      const volumeMappings = getCourseVolumeMappings()
      for (const mapping of Object.values(volumeMappings)) {
        if (mapping.isAvailable && mapping.rootPath) {
          basePaths.add(mapping.rootPath)
        }
      }

      let combinedMap: Record<number, string> = {}
      for (const basePath of basePaths) {
        const map = scanExistingDownloads(basePath, courseTitle)
        combinedMap = { ...combinedMap, ...map }
      }
      return combinedMap
    }
  )

  registerSecureIpc(
    'delete-course-folder',
    async (_event, courseTitle: string): Promise<boolean> => {
      const settings = store.get('app_settings') as AppSettings | undefined
      if (!settings || !settings.downloadPath) throw new Error('No download path found')

      const cleanCourseName = courseTitle.replace(/[<>:"/\\|?*]+/g, '-').trim()
      let deleted = false

      const basePaths = new Set<string>()
      basePaths.add(settings.downloadPath)

      const volumeMappings = getCourseVolumeMappings()
      for (const mapping of Object.values(volumeMappings)) {
        if (mapping.isAvailable && mapping.rootPath) {
          basePaths.add(mapping.rootPath)
        }
      }

      for (const basePath of basePaths) {
        const courseFolder = path.join(basePath, cleanCourseName)
        if (fs.existsSync(courseFolder)) {
          await fs.remove(courseFolder)
          deleted = true
        }
        runGarbageCollector(basePath)
      }

      return deleted
    }
  )

  registerSecureIpc('delete-all-downloads', async (): Promise<boolean> => {
    let hasError = false
    const settings = store.get('app_settings') as AppSettings | undefined

    const basePaths = new Set<string>()
    if (settings?.downloadPath) {
      basePaths.add(settings.downloadPath)
    }

    try {
      const dbVolumes = getAllVolumes()
      for (const vol of dbVolumes) {
        if (vol.root_path) {
          basePaths.add(vol.root_path)
        }
      }
    } catch (err: unknown) {
      console.error('Failed to retrieve volume roots from database:', err)
      hasError = true
    }

    const cachedDownloads = (store.get('cached_downloads') || []) as DownloadedFile[]
    const cachedCourses = (store.get('cached_courses') || []) as Course[]
    const sanitizeName = (name: string): string => name.replace(/[<>:"/\\|?*]+/g, '-').trim()

    const allowedDirs = new Set<string>([
      ...cachedDownloads.map((d) => d.course).filter((c): c is string => Boolean(c)),
      ...cachedCourses.map((c) => sanitizeName(c.title)).filter(Boolean)
    ])

    for (const basePath of basePaths) {
      if (!(await fs.pathExists(basePath))) continue

      try {
        const entries = await fs.readdir(basePath)
        for (const entry of entries) {
          if (entry.startsWith('.') || !allowedDirs.has(entry)) continue

          const fullPath = path.join(basePath, entry)
          try {
            const stat = await fs.stat(fullPath)
            if (stat.isDirectory()) {
              await fs.remove(fullPath)
            }
          } catch (err: unknown) {
            console.error(`Failed to delete course directory ${fullPath}:`, err)
            hasError = true
          }
        }

        runGarbageCollector(basePath)
      } catch (err: unknown) {
        console.error(`Failed reading base directory ${basePath}:`, err)
        hasError = true
      }
    }

    return !hasError
  })

  registerSecureIpc('cancel-download', async (_event, lectureId: number): Promise<boolean> => {
    return cancelDownload(lectureId)
  })

  registerSecureIpc('pause-download', (_event, lectureId: number): boolean => {
    return pauseDownload(lectureId)
  })

  registerSecureIpc(
    'moveDownloadsFolder',
    async (_event, oldPath: string, newPath: string): Promise<boolean> => {
      try {
        if (await fs.pathExists(oldPath)) {
          await fs.move(oldPath, newPath, { overwrite: true })
        }
        return true
      } catch (error) {
        console.error('Failed to move directory:', error)
        throw error
      }
    }
  )

  protocol.handle('local', async (request: Request): Promise<Response> => {
    const url = request.url.slice('local://'.length)
    const decodedPath = decodeURIComponent(url)

    if (!fs.existsSync(decodedPath)) {
      return new Response(null, { status: 404, statusText: 'File not found' })
    }

    let contentType = 'video/mp4'
    if (decodedPath.endsWith('.html')) contentType = 'text/html'
    else if (decodedPath.endsWith('.vtt')) contentType = 'text/vtt'

    const stat = fs.statSync(decodedPath)
    let fileSize = stat.size

    if (isFileEncrypted(decodedPath)) {
      const vaultKey = getVaultKey()
      if (!vaultKey) {
        return new Response('Vault Key Unavailable', { status: 403 })
      }

      if (decodedPath.endsWith('.vtt') || decodedPath.endsWith('.html')) {
        try {
          const decryptedBuffer = decryptFileSync(decodedPath, vaultKey)
          const webSafeBuffer = new Uint8Array(decryptedBuffer)

          return new Response(webSafeBuffer, {
            headers: {
              'Content-Type': contentType === 'text/vtt' ? 'text/vtt; charset=utf-8' : contentType,
              'Access-Control-Allow-Origin': '*',
              'Cache-Control': 'no-store'
            }
          })
        } catch {
          return new Response('Decryption failed', { status: 500 })
        }
      }

      fileSize = fileSize - VAULT_MAGIC_HEADER.length - 16 - 16
      const fileStream = fs.createReadStream(decodedPath)
      const decryptor = new VaultDecryptStream(vaultKey)
      fileStream.pipe(decryptor)

      fileStream.on('error', () => decryptor.destroy())
      decryptor.on('error', () => {})

      const webStream = Readable.toWeb(decryptor) as ReadableStream<Uint8Array>

      return new Response(webStream, {
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'no-store',
          'Content-Length': fileSize.toString(),
          'Accept-Ranges': 'none'
        }
      })
    }

    const fileStream = fs.createReadStream(decodedPath)
    return new Response(Readable.toWeb(fileStream) as ReadableStream<Uint8Array>, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': fileSize.toString(),
        'Accept-Ranges': 'none'
      }
    })
  })

  registerSecureIpc(
    'delete-lecture',
    async (_event, courseTitle: string, lectureId: number): Promise<boolean> => {
      const settings = store.get('app_settings') as AppSettings | undefined
      if (!settings || !settings.downloadPath) return false

      const basePaths = new Set<string>()
      basePaths.add(settings.downloadPath)

      const volumeMappings = getCourseVolumeMappings()
      for (const mapping of Object.values(volumeMappings)) {
        if (mapping.isAvailable && mapping.rootPath) {
          basePaths.add(mapping.rootPath)
        }
      }

      let deleted = false
      for (const basePath of basePaths) {
        if (deleteLectureFile(basePath, courseTitle, lectureId)) {
          deleted = true
        }

        runGarbageCollector(basePath)
      }

      return deleted
    }
  )

  registerSecureIpc('delete-file-by-path', async (_event, filePath: string): Promise<boolean> => {
    const settings = store.get('app_settings') as AppSettings | undefined

    const basePaths = new Set<string>()
    if (settings?.downloadPath) basePaths.add(settings.downloadPath)

    const volumeMappings = getCourseVolumeMappings()
    for (const mapping of Object.values(volumeMappings)) {
      if (mapping.isAvailable && mapping.rootPath) {
        basePaths.add(mapping.rootPath)
      }
    }

    if (basePaths.size === 0) return false

    const resolvedTarget = path.resolve(filePath)
    const isWithinAllowedBase = Array.from(basePaths).some((basePath) => {
      const resolvedBase = path.resolve(basePath)
      const relative = path.relative(resolvedBase, resolvedTarget)
      return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
    })

    if (!isWithinAllowedBase) {
      console.warn(
        `[SECURITY] Blocked delete-file-by-path outside allowed roots: ${resolvedTarget}`
      )
      return false
    }

    if (fs.existsSync(resolvedTarget)) {
      fs.unlinkSync(resolvedTarget)

      for (const basePath of basePaths) {
        runGarbageCollector(basePath)
      }

      return true
    }
    return false
  })

  registerSecureIpc('login-udemy', async (_event, subdomain?: string): Promise<string | null> => {
    return new Promise((resolve) => {
      const targetUrl = subdomain
        ? `https://${subdomain}.udemy.com`
        : 'https://www.udemy.com/join/login-popup/'

      const loginWindow = new BrowserWindow({
        width: 600,
        height: 750,
        title: subdomain ? `Sign in to Udemy Business (${subdomain})` : 'Sign in to Udemy',
        autoHideMenuBar: true,
        alwaysOnTop: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true
        }
      })

      loginWindow.loadURL(targetUrl)

      const checkCookies = async (): Promise<void> => {
        try {
          let cookies = await loginWindow.webContents.session.cookies.get({
            url: targetUrl,
            name: 'access_token'
          })

          if (!cookies || cookies.length === 0) {
            cookies = await loginWindow.webContents.session.cookies.get({
              domain: '.udemy.com',
              name: 'access_token'
            })
          }

          if (cookies && cookies.length > 0) {
            const token = cookies[0].value

            store.set('udemy_token', token)
            if (subdomain) {
              store.set('udemy_subdomain', subdomain)
            } else {
              store.delete('udemy_subdomain')
            }

            clearInterval(cookieInterval)
            loginWindow.close()
            resolve(token)
          }
        } catch (error) {
          console.error('Failed to read cookies:', error)
        }
      }

      const cookieInterval = setInterval(checkCookies, 1500)

      loginWindow.on('closed', () => {
        clearInterval(cookieInterval)
        resolve(null)
      })
    })
  })

  registerSecureIpc('os-set-progress', (_event, progress: number): boolean => {
    if (mainWindow) handleSetProgressBar(mainWindow, progress)
    return true
  })

  registerSecureIpc('os-set-tray-tooltip', (_event, text: string): boolean => {
    handleSetTrayTooltip(text)
    return true
  })

  registerSecureIpc(
    'os-set-recent-course',
    (_event, payload: { title: string; id: number }): boolean => {
      handleSetRecentCourse(payload)
      return true
    }
  )

  registerSecureIpc('os-hide-to-tray', (): boolean => {
    if (mainWindow) mainWindow.hide()
    return true
  })

  registerSecureIpc(
    'os-update-queue-menu',
    (_event, status: 'idle' | 'running' | 'paused'): boolean => {
      handleUpdateQueueMenu(status)
      return true
    }
  )

  registerSecureIpc('os-show-item-in-folder', (_event, filePath: string): void => {
    shell.showItemInFolder(filePath)
  })

  registerSecureIpc('search-index', (_event, query: string): SearchResult[] => {
    return handleSearchQuery(query)
  })

  registerSecureIpc('rebuild-search-index', async (): Promise<boolean> => {
    return await rebuildIndex(store)
  })

  registerSecureIpc('start-integrity-scan', async (event): Promise<IntegrityIssue[]> => {
    const settings = store.get('app_settings') as AppSettings | undefined
    if (!settings?.downloadPath) return []

    const vaultKey = getVaultKey()

    return new Promise((resolve, reject) => {
      const worker = new Worker(path.join(__dirname, 'integrity-worker.js'), {
        workerData: {
          downloadPath: settings.downloadPath,
          vaultKey: vaultKey
        }
      })

      worker.on('message', (msg) => {
        if (msg.type === 'progress') {
          event.sender.send('integrity-progress', msg.data)
        } else if (msg.type === 'done') {
          resolve(msg.issues)
        } else if (msg.type === 'error') {
          reject(new Error(msg.error))
        }
      })

      worker.on('error', reject)
      worker.on('exit', (code) => {
        if (code !== 0) reject(new Error(`Worker stopped with exit code ${code}`))
      })
    })
  })

  const settings = store.get('app_settings') as AppSettings | undefined
  if (settings?.downloadPath) {
    initDb(settings.downloadPath)
  }

  if (!is.dev && !isWindowsStore && !app.getVersion().includes('debug')) {
    createUpdaterWindow()
    autoUpdater.checkForUpdatesAndNotify().catch((err: unknown) => {
      console.warn('Auto-updater bypassed:', err)
      createWindow()
    })
  } else {
    createWindow()
  }

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) {
      if (is.dev) createWindow()
      else createUpdaterWindow()
    }
  })
})

app.on('before-quit', () => {
  isQuitting = true
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
