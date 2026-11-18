const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('taktwerkDesktop', {
  isDesktop: true,
  platform: process.platform,
  getAppVersion: () => ipcRenderer.invoke('taktwerk:get-app-version'),
  downloadAndRunInstaller: (options) =>
    ipcRenderer.invoke('taktwerk:download-and-run-installer', options),
  openDataFolder: () => ipcRenderer.invoke('taktwerk:open-data-folder'),
  getAutoLaunch: () => ipcRenderer.invoke('taktwerk:get-auto-launch'),
  setAutoLaunch: (enabled) => ipcRenderer.invoke('taktwerk:set-auto-launch', Boolean(enabled)),
  openExternal: (url) => ipcRenderer.invoke('taktwerk:open-external', url),
  printPage: () => ipcRenderer.invoke('taktwerk:print-page'),
  updateTrayState: (state) => ipcRenderer.send('taktwerk:update-tray-state', state),
  onTrayAction: (callback) => {
    const handler = (_event, action) => {
      if (typeof callback === 'function' && typeof action === 'string') {
        callback(action);
      }
    };
    ipcRenderer.on('taktwerk:tray-action', handler);
    return () => {
      ipcRenderer.removeListener('taktwerk:tray-action', handler);
    };
  },
});
