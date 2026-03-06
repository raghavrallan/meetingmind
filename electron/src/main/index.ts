import { app, BrowserWindow, ipcMain, desktopCapturer } from 'electron';
import path from 'path';
import fs from 'fs';
import { createTray, updateTrayMenu, showNotification } from './tray';
import { registerIpcHandlers } from './ipc-handlers';

let mainWindow: BrowserWindow | null = null;

const WINDOW_WIDTH = 960;
const WINDOW_HEIGHT = 640;

/** Enforce single instance - quit if another instance is already running */
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    frame: false,
    resizable: true,
    minWidth: 780,
    minHeight: 520,
    transparent: false,
    alwaysOnTop: false,
    skipTaskbar: false,
    backgroundColor: '#0A0A0A',
    titleBarStyle: 'hidden',
    titleBarOverlay: false,
    vibrancy: 'under-window',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false, // Allow renderer to fetch from localhost backend APIs
    },
  });

  // In dev mode, load from the dev server; in production, load the built file
  if (process.env.NODE_ENV === 'development' || process.env.ELECTRON_RENDERER_URL) {
    const rendererUrl = process.env.ELECTRON_RENDERER_URL || 'http://localhost:5173';
    win.loadURL(rendererUrl);
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  return win;
}

app.whenReady().then(() => {
  mainWindow = createWindow();

  // Create system tray
  createTray(mainWindow);
  updateTrayMenu(false);

  // Register all IPC handlers
  registerIpcHandlers(mainWindow);

  // Custom titlebar IPC: minimize, close (hide to tray)
  ipcMain.on('window-minimize', () => {
    mainWindow?.minimize();
  });

  ipcMain.on('window-close', () => {
    mainWindow?.hide();
  });

  // Expose desktopCapturer source retrieval for system audio capture
  ipcMain.handle('get-desktop-sources', async () => {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
    });
    return sources.map((source) => ({
      id: source.id,
      name: source.name,
    }));
  });

  // Screenshot capture for debugging — saves renderer content to file
  ipcMain.handle('capture-page', async () => {
    if (!mainWindow) return { success: false };
    const image = await mainWindow.webContents.capturePage();
    const pngBuffer = image.toPNG();
    const outPath = path.join(__dirname, '../../screenshot.png');
    fs.writeFileSync(outPath, pngBuffer);
    return { success: true, path: outPath };
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    } else {
      mainWindow?.show();
    }
  });
});

// On macOS keep the app running in the tray; on other platforms quit fully
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Auto-launch support: check command line arg
if (process.argv.includes('--auto-launch')) {
  app.setLoginItemSettings({
    openAtLogin: true,
    args: ['--auto-launch'],
  });
}

export { mainWindow };
