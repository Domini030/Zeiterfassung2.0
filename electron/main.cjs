const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  dialog,
  ipcMain,
  nativeImage,
  shell,
} = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

process.env.TAKTWERK_EMBEDDED = '1';

let mainWindow = null;
let tray = null;
let serverInstance = null;
let isQuitting = false;
let trayHintShown = false;

let trayTimerState = {
  running: false,
  paused: false,
  title: '',
  durationText: '',
};

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

function getAppRoot() {
  return app.getAppPath();
}

function getDataDir() {
  return path.join(app.getPath('userData'), 'data');
}

function getWindowStatePath() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function loadWindowState() {
  const defaults = { width: 1320, height: 860, isMaximized: false };
  try {
    const raw = fs.readFileSync(getWindowStatePath(), 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      width: typeof parsed.width === 'number' && parsed.width >= 800 ? parsed.width : defaults.width,
      height:
        typeof parsed.height === 'number' && parsed.height >= 600 ? parsed.height : defaults.height,
      x: typeof parsed.x === 'number' ? parsed.x : undefined,
      y: typeof parsed.y === 'number' ? parsed.y : undefined,
      isMaximized: Boolean(parsed.isMaximized),
    };
  } catch {
    return defaults;
  }
}

function saveWindowState(win) {
  if (!win || win.isDestroyed()) return;
  try {
    const isMaximized = win.isMaximized();
    const bounds = isMaximized ? win.getNormalBounds() : win.getBounds();
    fs.writeFileSync(
      getWindowStatePath(),
      JSON.stringify(
        {
          width: bounds.width,
          height: bounds.height,
          x: bounds.x,
          y: bounds.y,
          isMaximized,
        },
        null,
        2
      ),
      'utf-8'
    );
  } catch {
    // Ignore write failures
  }
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

function sendTrayAction(action) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (action === 'search') {
    focusMainWindow();
  }
  mainWindow.webContents.send('taktwerk:tray-action', action);
}

function refreshTrayMenu() {
  if (!tray || tray.isDestroyed()) return;

  const statusLabel = trayTimerState.running
    ? trayTimerState.paused
      ? `Pausiert: ${trayTimerState.title || 'Timer'} (${trayTimerState.durationText || '00:00'})`
      : `Läuft: ${trayTimerState.title || 'Timer'} (${trayTimerState.durationText || '00:00'})`
    : 'Kein aktiver Timer';

  tray.setToolTip(`TaktWerk — ${statusLabel}`);

  const template = [
    { label: statusLabel, enabled: false },
    { type: 'separator' },
    {
      label: 'TaktWerk öffnen',
      click: () => focusMainWindow(),
    },
  ];

  if (trayTimerState.running) {
    template.push(
      {
        label: trayTimerState.paused ? 'Timer fortsetzen' : 'Timer pausieren',
        click: () => sendTrayAction(trayTimerState.paused ? 'resume' : 'pause'),
      },
      {
        label: 'Timer stoppen & speichern',
        click: () => sendTrayAction('stop'),
      }
    );
  }

  template.push(
    {
      label: 'Schnellsuche (Strg+K)',
      click: () => sendTrayAction('search'),
    },
    { type: 'separator' },
    {
      label: 'Lokalen Datenordner öffnen',
      click: () => {
        void shell.openPath(getDataDir());
      },
    },
    { type: 'separator' },
    {
      label: 'TaktWerk beenden',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    }
  );

  tray.setContextMenu(Menu.buildFromTemplate(template));
}

function createTray() {
  try {
    const appRoot = getAppRoot();
    const trayPngPath = path.join(appRoot, 'electron', 'tray-icon.png');
    const icoPath = path.join(appRoot, 'electron', 'icon.ico');
    const chosenPath = fs.existsSync(trayPngPath) ? trayPngPath : icoPath;
    let img = nativeImage.createFromPath(chosenPath);
    if (process.platform === 'win32' && !img.isEmpty()) {
      img = img.resize({ width: 16, height: 16 });
    }
    tray = new Tray(img);
    tray.on('click', () => focusMainWindow());
    tray.on('double-click', () => focusMainWindow());
    refreshTrayMenu();
  } catch (err) {
    console.warn('[TaktWerk Desktop] System Tray could not be initialized:', err);
  }
}

function buildAppMenu() {
  const menuTemplate = [
    {
      label: 'Datei',
      submenu: [
        {
          label: 'Schnellsuche',
          accelerator: 'CmdOrCtrl+K',
          click: () => sendTrayAction('search'),
        },
        {
          label: 'Lokalen Datenordner öffnen',
          click: () => {
            void shell.openPath(getDataDir());
          },
        },
        { type: 'separator' },
        {
          label: 'Drucken',
          accelerator: 'CmdOrCtrl+P',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.print({ silent: false, printBackground: true });
            }
          },
        },
        { type: 'separator' },
        {
          label: 'Beenden',
          accelerator: 'Alt+F4',
          click: () => {
            isQuitting = true;
            app.quit();
          },
        },
      ],
    },
    {
      label: 'Bearbeiten',
      submenu: [
        { role: 'undo', label: 'Rückgängig' },
        { role: 'redo', label: 'Wiederholen' },
        { type: 'separator' },
        { role: 'cut', label: 'Ausschneiden' },
        { role: 'copy', label: 'Kopieren' },
        { role: 'paste', label: 'Einfügen' },
        { role: 'selectAll', label: 'Alles auswählen' },
      ],
    },
    {
      label: 'Ansicht',
      submenu: [
        { role: 'reload', label: 'Neu laden' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Standardgröße' },
        { role: 'zoomIn', label: 'Vergrößern' },
        { role: 'zoomOut', label: 'Verkleinern' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Vollbild' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));
}

function isAllowedExternalUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return (
      parsed.protocol === 'https:' ||
      parsed.protocol === 'http:' ||
      parsed.protocol === 'mailto:'
    );
  } catch {
    return false;
  }
}

function isTrustedInstallerUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return (
      host === 'github.com' ||
      host.endsWith('.github.com') ||
      host.endsWith('.githubusercontent.com')
    );
  } catch {
    return false;
  }
}

function registerIpcHandlers() {
  ipcMain.handle('taktwerk:get-app-version', () => ({
    versionName: app.getVersion(),
    isDesktop: true,
    platform: process.platform,
  }));

  ipcMain.handle('taktwerk:open-data-folder', async () => {
    const dir = getDataDir();
    await fsp.mkdir(dir, { recursive: true });
    await shell.openPath(dir);
  });

  ipcMain.handle('taktwerk:get-auto-launch', () => {
    try {
      const settings = app.getLoginItemSettings();
      return Boolean(settings.openAtLogin);
    } catch {
      return false;
    }
  });

  ipcMain.handle('taktwerk:set-auto-launch', (_event, enabled) => {
    try {
      app.setLoginItemSettings({
        openAtLogin: Boolean(enabled),
        path: process.execPath,
      });
      return Boolean(app.getLoginItemSettings().openAtLogin);
    } catch {
      return false;
    }
  });

  ipcMain.handle('taktwerk:open-external', async (_event, url) => {
    if (typeof url === 'string' && isAllowedExternalUrl(url)) {
      await shell.openExternal(url);
    }
  });

  ipcMain.handle('taktwerk:print-page', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.print({ silent: false, printBackground: true });
    }
  });

  ipcMain.on('taktwerk:update-tray-state', (_event, state) => {
    if (!state || typeof state !== 'object') return;
    trayTimerState = {
      running: Boolean(state.running),
      paused: Boolean(state.paused),
      title: typeof state.title === 'string' ? state.title : '',
      durationText: typeof state.durationText === 'string' ? state.durationText : '',
    };
    refreshTrayMenu();
  });

  ipcMain.handle('taktwerk:download-and-run-installer', async (_event, options) => {
    const url = typeof options?.url === 'string' ? options.url.trim() : '';
    const rawFilename =
      typeof options?.filename === 'string' && options.filename.trim()
        ? options.filename.trim()
        : 'TaktWerk-Setup.exe';

    if (!isTrustedInstallerUrl(url)) {
      throw new Error('Ungültige Update-Download-URL (nur GitHub HTTPS erlaubt).');
    }

    const safeName = rawFilename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const finalName = safeName.toLowerCase().endsWith('.exe') ? safeName : `${safeName}.exe`;
    const targetPath = path.join(app.getPath('temp'), finalName);

    const response = await fetch(url, {
      redirect: 'follow',
      headers: {
        'User-Agent': `TaktWerk-Desktop/${app.getVersion()}`,
      },
    });
    if (!response.ok) {
      throw new Error(`Windows-Update-Download fehlgeschlagen (HTTP ${response.status}).`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.length < 1024) {
      throw new Error('Heruntergeladene Installer-Datei ist unvollständig.');
    }

    await fsp.writeFile(targetPath, buffer);
    const openError = await shell.openPath(targetPath);
    if (openError) {
      throw new Error(`Installer konnte nicht gestartet werden: ${openError}`);
    }

    return {
      ok: true,
      message: `Windows-Installer (${finalName}) wurde gestartet. Alle Daten in AppData bleiben erhalten.`,
    };
  });
}

async function startEmbeddedBackend() {
  const appRoot = getAppRoot();
  const dataDir = getDataDir();
  const distDir = path.join(appRoot, 'dist');
  const serverBundlePath = path.join(appRoot, 'dist-electron', 'server.cjs');

  process.env.TAKTWERK_APP_ROOT = appRoot;
  process.env.TAKTWERK_DATA_DIR = dataDir;
  process.env.TAKTWERK_DIST_DIR = distDir;
  process.env.NODE_ENV = 'production';

  await fsp.mkdir(dataDir, { recursive: true });

  const serverModule = require(serverBundlePath);
  const startFn = serverModule.startTaktWerkServer || serverModule.default?.startTaktWerkServer;
  if (typeof startFn !== 'function') {
    throw new Error('Eingebetteter TaktWerk-Server konnte nicht geladen werden.');
  }

  serverInstance = await startFn({
    port: 0,
    host: '127.0.0.1',
    dataDir,
    distDir,
    forceProd: true,
  });

  return `http://127.0.0.1:${serverInstance.port}`;
}

async function createMainWindow(localUrl) {
  const winState = loadWindowState();
  const appRoot = getAppRoot();
  const iconPath = path.join(appRoot, 'electron', 'icon.ico');
  const windowIcon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : undefined;

  mainWindow = new BrowserWindow({
    width: winState.width,
    height: winState.height,
    x: winState.x,
    y: winState.y,
    minWidth: 920,
    minHeight: 620,
    show: false,
    title: 'TaktWerk — Zeiterfassung & Rechnungen',
    backgroundColor: '#0e0a18',
    icon: windowIcon && !windowIcon.isEmpty() ? windowIcon : undefined,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (winState.isMaximized) {
    mainWindow.maximize();
  }

  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
    }
  });

  // Open external links & mailto links in Windows default browser / mail client
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(localUrl)) {
      return { action: 'allow' };
    }
    if (isAllowedExternalUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(localUrl) && isAllowedExternalUrl(url)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  mainWindow.on('close', (event) => {
    saveWindowState(mainWindow);
    if (!isQuitting && tray && !tray.isDestroyed() && trayTimerState.running) {
      event.preventDefault();
      mainWindow.hide();
      if (!trayHintShown && process.platform === 'win32') {
        trayHintShown = true;
        tray.displayBalloon({
          title: 'TaktWerk läuft im Hintergrund',
          content: `Dein Timer „${trayTimerState.title || 'Aktive Aufgabe'}“ läuft weiter. Klicke unten rechts auf das TaktWerk-Symbol zum Öffnen.`,
        });
      }
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  await mainWindow.loadURL(localUrl);
}

app.on('second-instance', () => {
  focusMainWindow();
});

app.on('before-quit', () => {
  isQuitting = true;
  if (serverInstance && typeof serverInstance.close === 'function') {
    void serverInstance.close();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app
  .whenReady()
  .then(async () => {
    app.setAppUserModelId('de.taktwerk.desktop');
    buildAppMenu();
    registerIpcHandlers();
    createTray();
    const localUrl = await startEmbeddedBackend();
    await createMainWindow(localUrl);
  })
  .catch((err) => {
    console.error('[TaktWerk Desktop] Startup error:', err);
    dialog.showErrorBox(
      'TaktWerk konnte nicht gestartet werden',
      err instanceof Error ? err.message : String(err)
    );
    app.quit();
  });
