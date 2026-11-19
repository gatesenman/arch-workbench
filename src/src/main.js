const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

function resolveIcon() {
  const candidates = [
    path.join(__dirname, 'assets', 'icon.ico'),
    path.join(__dirname, 'assets', 'icon.png'),
    path.join(__dirname, '..', 'build', 'icon.ico'),
    path.join(__dirname, '..', 'build', 'icon.png'),
    path.join(process.resourcesPath || '', 'icon.ico'),
    path.join(process.resourcesPath || '', 'build', 'icon.ico')
  ];
  for (const p of candidates) {
    try { if (p && fs.existsSync(p)) return p; } catch (_) {}
  }
  return undefined;
}

function createWindow() {
  const icon = resolveIcon();
  const win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1100, minHeight: 700,
    title: '建筑师专属工作台', frame: false, backgroundColor: '#17181b', show: false,
    icon,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  Menu.setApplicationMenu(null);
  win.once('ready-to-show', () => win.show());
  win.on('maximize', () => win.webContents.send('win-max', true));
  win.on('unmaximize', () => win.webContents.send('win-max', false));
  win.loadFile(path.join(__dirname, 'index.html'));
}
ipcMain.on('win', (e, a) => {
  const w = BrowserWindow.fromWebContents(e.sender); if (!w) return;
  a === 'min' ? w.minimize() : a === 'max' ? (w.isMaximized() ? w.unmaximize() : w.maximize()) : w.close();
});
app.setAppUserModelId('com.grokbot.archworkbench');
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
