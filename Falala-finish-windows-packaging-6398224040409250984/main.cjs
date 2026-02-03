const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

// Determine if we are in development mode
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

function createWindow() {
  // Create the browser window.
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "BUILDWHILEBLEEDING Studio",
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: true,
    },
  });

  // Load the app
  if (isDev) {
    // In development, load from the Vite dev server
    win.loadURL('http://localhost:3000');
    // Open the DevTools.
    win.webContents.openDevTools();
  } else {
    // In production, load the built index.html
    // __dirname is the directory containing main.cjs (which is copied to dist/)
    const indexPath = path.join(__dirname, 'index.html');
    win.loadFile(indexPath);
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Quit when all windows are closed, except on macOS.
app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});
