import { Tray, Menu, nativeImage, BrowserWindow, Notification, app } from 'electron';
import path from 'path';

let tray: Tray | null = null;
let mainWindowRef: BrowserWindow | null = null;

/**
 * Create a 16x16 tray icon programmatically.
 * In production you would use actual .ico/.png assets from the resources/ folder.
 * This creates a simple coloured circle as a fallback.
 */
function createTrayIcon(recording: boolean): Electron.NativeImage {
  // Try to load from resources first
  const iconName = recording ? 'tray-recording.png' : 'tray-idle.png';
  const resourcePath = path.join(__dirname, '../../resources', iconName);

  try {
    const img = nativeImage.createFromPath(resourcePath);
    if (!img.isEmpty()) {
      return img.resize({ width: 16, height: 16 });
    }
  } catch {
    // Fall through to programmatic icon
  }

  // Programmatic fallback: create a simple 16x16 icon using raw RGBA data
  const size = 16;
  const buffer = Buffer.alloc(size * size * 4);

  const r = recording ? 220 : 100;
  const g = recording ? 50 : 180;
  const b = recording ? 50 : 220;
  const a = 255;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - size / 2;
      const dy = y - size / 2;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const offset = (y * size + x) * 4;

      if (dist <= size / 2 - 1) {
        buffer[offset] = r;
        buffer[offset + 1] = g;
        buffer[offset + 2] = b;
        buffer[offset + 3] = a;
      } else {
        buffer[offset] = 0;
        buffer[offset + 1] = 0;
        buffer[offset + 2] = 0;
        buffer[offset + 3] = 0;
      }
    }
  }

  return nativeImage.createFromBuffer(buffer, { width: size, height: size });
}

/**
 * Create the system tray and its icon.
 */
export function createTray(mainWindow: BrowserWindow): Tray {
  mainWindowRef = mainWindow;

  const icon = createTrayIcon(false);
  tray = new Tray(icon);
  tray.setToolTip('AI Notetaker Agent');

  // Click on tray icon shows/hides the window
  tray.on('click', () => {
    if (mainWindowRef) {
      if (mainWindowRef.isVisible()) {
        mainWindowRef.hide();
      } else {
        mainWindowRef.show();
        mainWindowRef.focus();
      }
    }
  });

  return tray;
}

/**
 * Update the tray context menu based on recording state.
 * When recording, the icon turns red and the menu shows "Stop Recording".
 */
export function updateTrayMenu(isRecording: boolean): void {
  if (!tray || !mainWindowRef) return;

  // Update icon colour
  const icon = createTrayIcon(isRecording);
  tray.setImage(icon);
  tray.setToolTip(isRecording ? 'AI Notetaker - Recording...' : 'AI Notetaker Agent');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: isRecording ? '⏹ Stop Recording' : '⏺ Start Recording',
      click: () => {
        if (mainWindowRef) {
          mainWindowRef.webContents.send(
            'tray-action',
            isRecording ? 'stop-recording' : 'start-recording'
          );
          mainWindowRef.show();
          mainWindowRef.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Show Window',
      click: () => {
        mainWindowRef?.show();
        mainWindowRef?.focus();
      },
    },
    {
      label: 'Settings',
      click: () => {
        mainWindowRef?.show();
        mainWindowRef?.focus();
        mainWindowRef?.webContents.send('tray-action', 'open-settings');
      },
    },
    { type: 'separator' },
    {
      label: 'Start at Login',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (menuItem) => {
        app.setLoginItemSettings({
          openAtLogin: menuItem.checked,
          args: ['--auto-launch'],
        });
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        // Ensure we actually quit, not just hide
        app.exit(0);
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
}

/**
 * Show a native OS notification.
 */
export function showNotification(title: string, body: string): void {
  if (Notification.isSupported()) {
    const notification = new Notification({
      title,
      body,
      silent: false,
    });
    notification.show();
  }
}

/**
 * Destroy the tray icon (used during cleanup).
 */
export function destroyTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}
