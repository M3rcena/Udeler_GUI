const { app, BrowserWindow, Menu, ipcMain } = require("electron");
const path = require("path");
const url = require("url");
const fs = require('fs');
const settings = require('electron-settings');
const sanitize = require('sanitize-filename');
var downloadsSaved = false;
// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let win;

function createWindow() {
  // Create the browser window.
  win = new BrowserWindow({
    icon: __dirname + "/assets/images/build/icon.png",
    resizable: true,
    webPreferences: {
      nodeIntegration: true,
      enableRemoteModule: true
    }
  });

  win.maximize();
  // and load the index.html of the app.
  win.loadURL(
    url.format({
      pathname: path.join(__dirname, "index.html"),
      protocol: "file:",
      slashes: true
    })
  );

  // Add keyboard shortcut for developer tools
  // win.webContents.on('before-input-event', (event, input) => {
  //   if (input.key === 'F12') {
  //     win.webContents.openDevTools();
  //     event.preventDefault();
  //   }
  // });

  win.on("close", event => {
    if (!downloadsSaved) {
      event.preventDefault();
      win.webContents.send("saveDownloads");
    }
  });

  // Emitted when the window is closed.
  win.on("closed", () => {
    // Dereference the window object, usually you would store windows
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element.
    win = null;
  });

  // Menu removed - no more View menu with Developer Tools
  Menu.setApplicationMenu(null);
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on("ready", createWindow);

// Quit when all windows are closed.
app.on("window-all-closed", () => {
  app.quit();
});

app.on("activate", () => {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (win === null) {
    createWindow();
  }
});

ipcMain.on("quitApp", function () {
  downloadsSaved = true;
  app.quit();
});

ipcMain.on('download-video', (event, {
  url,
  courseTitle,
  lectureTitle,
  lectureId,
  sectionName,
  fileExtension,
  isBlob
}) => {
  let downloadPath = settings.get('download.path');
  if (!downloadPath) {
    downloadPath = path.join(app.getPath('downloads'), 'Udeler');
  }

  const courseFolder = path.join(downloadPath, sanitize(courseTitle));
  const sectionFolder = path.join(courseFolder, sanitize(sectionName || 'Uncategorized'));
  const finalPath = path.join(sectionFolder, sanitize(`${lectureTitle}${fileExtension || '.mp4'}`));

  // Create nested directories
  if (!fs.existsSync(courseFolder)) {
    fs.mkdirSync(courseFolder, { recursive: true });
  }
  if (!fs.existsSync(sectionFolder)) {
    fs.mkdirSync(sectionFolder, { recursive: true });
  }

  if (isBlob) {
    // Handle blob URLs (for HTML content)
    const https = require('https');
    const http = require('http');

    // For blob URLs, we need to fetch the content differently
    const protocol = url.startsWith('blob:') ? 'http' : (url.startsWith('https:') ? 'https' : 'http');
    const client = protocol === 'https' ? https : http;

    // For blob URLs, we'll use a different approach
    if (url.startsWith('blob:')) {
      // For blob URLs, we need to get the content from the renderer process
      win.webContents.send('get-blob-content', { url, lectureId });
      return;
    }

    const fileStream = fs.createWriteStream(finalPath);

    client.get(url, (response) => {
      const totalSize = parseInt(response.headers['content-length'], 10);
      let downloadedSize = 0;

      response.on('data', (chunk) => {
        downloadedSize += chunk.length;
        const progress = {
          percent: totalSize ? downloadedSize / totalSize : 0
        };
        win.webContents.send('download-progress', {
          lectureId: lectureId,
          progress: progress
        });
      });

      fileStream.on('finish', () => {
        fileStream.close();

        // Save download info to settings
        const downloadInfo = {
          courseTitle: courseTitle,
          lectureTitle: lectureTitle,
          lectureId: lectureId,
          sectionName: sectionName,
          filePath: finalPath,
          fileExtension: fileExtension,
          downloadedAt: new Date().toISOString()
        };

        let downloadedFiles = settings.get('downloadedFiles') || [];
        downloadedFiles.push(downloadInfo);
        settings.set('downloadedFiles', downloadedFiles);

        win.webContents.send('download-complete', {
          lectureId: lectureId,
          error: false
        });
      });

      fileStream.on('error', (err) => {
        fs.unlink(finalPath, () => { }); // Delete the file if it exists
        win.webContents.send('download-complete', {
          lectureId: lectureId,
          error: true
        });
      });

      response.pipe(fileStream);
    }).on('error', (err) => {
      win.webContents.send('download-complete', {
        lectureId: lectureId,
        error: true
      });
    });
  } else {
    // Handle regular URLs (for videos, files, etc.)
    const https = require('https');
    const fileStream = fs.createWriteStream(finalPath);

    https.get(url, (response) => {
      const totalSize = parseInt(response.headers['content-length'], 10);
      let downloadedSize = 0;

      response.on('data', (chunk) => {
        downloadedSize += chunk.length;
        const progress = {
          percent: downloadedSize / totalSize
        };
        win.webContents.send('download-progress', {
          lectureId: lectureId,
          progress: progress
        });
      });

      fileStream.on('finish', () => {
        fileStream.close();

        // Save download info to settings
        const downloadInfo = {
          courseTitle: courseTitle,
          lectureTitle: lectureTitle,
          lectureId: lectureId,
          sectionName: sectionName,
          filePath: finalPath,
          fileExtension: fileExtension,
          downloadedAt: new Date().toISOString()
        };

        let downloadedFiles = settings.get('downloadedFiles') || [];
        downloadedFiles.push(downloadInfo);
        settings.set('downloadedFiles', downloadedFiles);

        win.webContents.send('download-complete', {
          lectureId: lectureId,
          error: false
        });
      });

      fileStream.on('error', (err) => {
        fs.unlink(finalPath, () => { }); // Delete the file if it exists
        win.webContents.send('download-complete', {
          lectureId: lectureId,
          error: true
        });
      });

      response.pipe(fileStream);
    }).on('error', (err) => {
      win.webContents.send('download-complete', {
        lectureId: lectureId,
        error: true
      });
    });
  }
});

ipcMain.on('open-dev-tools', () => {
  if (win) {
    win.webContents.openDevTools();
  }
});

ipcMain.on('check-download-status', (event, { lectureId, courseTitle, lectureTitle, sectionName, fileExtension }) => {
  let downloadPath = settings.get('download.path');
  if (!downloadPath) {
    downloadPath = path.join(app.getPath('downloads'), 'Udeler');
  }

  const courseFolder = path.join(downloadPath, sanitize(courseTitle));
  const sectionFolder = path.join(courseFolder, sanitize(sectionName || 'Uncategorized'));
  const expectedPath = path.join(sectionFolder, sanitize(`${lectureTitle}${fileExtension || '.mp4'}`));

  // Check if file exists on disk
  const fileExists = fs.existsSync(expectedPath);

  // Check if it's in our download history
  const downloadedFiles = settings.get('downloadedFiles') || [];
  const isInHistory = downloadedFiles.some(file =>
    file.lectureId === lectureId &&
    file.courseTitle === courseTitle &&
    file.lectureTitle === lectureTitle
  );

  win.webContents.send('download-status-result', {
    lectureId: lectureId,
    isDownloaded: fileExists && isInHistory,
    filePath: expectedPath
  });
});

ipcMain.on('download-html-content', (event, {
  htmlContent,
  courseTitle,
  lectureTitle,
  lectureId,
  sectionName
}) => {
  let downloadPath = settings.get('download.path');
  if (!downloadPath) {
    downloadPath = path.join(app.getPath('downloads'), 'Udeler');
  }

  const courseFolder = path.join(downloadPath, sanitize(courseTitle));
  const sectionFolder = path.join(courseFolder, sanitize(sectionName || 'Uncategorized'));
  const finalPath = path.join(sectionFolder, sanitize(`${lectureTitle}.html`));

  // Create nested directories
  if (!fs.existsSync(courseFolder)) {
    fs.mkdirSync(courseFolder, { recursive: true });
  }
  if (!fs.existsSync(sectionFolder)) {
    fs.mkdirSync(sectionFolder, { recursive: true });
  }

  // Write HTML content directly to file
  fs.writeFile(finalPath, htmlContent, 'utf8', (err) => {
    if (err) {
      win.webContents.send('download-complete', {
        lectureId: lectureId,
        error: true
      });
    } else {
      // Save download info to settings
      const downloadInfo = {
        courseTitle: courseTitle,
        lectureTitle: lectureTitle,
        lectureId: lectureId,
        sectionName: sectionName,
        filePath: finalPath,
        fileExtension: '.html',
        downloadedAt: new Date().toISOString()
      };

      let downloadedFiles = settings.get('downloadedFiles') || [];
      downloadedFiles.push(downloadInfo);
      settings.set('downloadedFiles', downloadedFiles);

      win.webContents.send('download-complete', {
        lectureId: lectureId,
        error: false
      });
    }
  });
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.

ipcMain.on('open-external-url', (event, url) => {
  const { shell } = require('electron');
  shell.openExternal(url);
});

ipcMain.on('open-external-file', (event, filePath) => {
  console.log('Main process received file path:', filePath);

  try {
    const { shell } = require('electron');

    // Ensure the file exists before trying to open it
    if (fs.existsSync(filePath)) {
      console.log('File exists, opening with shell');

      // Try shell.openPath first (Electron 9+), fallback to shell.openItem (older versions)
      if (typeof shell.openPath === 'function') {
        shell.openPath(filePath);
      } else if (typeof shell.openItem === 'function') {
        shell.openItem(filePath);
      } else {
        // Fallback to using the default system handler
        const { exec } = require('child_process');
        const platform = require('os').platform();

        if (platform === 'win32') {
          exec(`start "" "${filePath}"`);
        } else if (platform === 'darwin') {
          exec(`open "${filePath}"`);
        } else {
          exec(`xdg-open "${filePath}"`);
        }
      }
    } else {
      console.error('File does not exist:', filePath);
      // Send error back to renderer
      event.sender.send('file-open-error', { error: 'File not found', path: filePath });
    }
  } catch (error) {
    console.error('Error opening file:', error);
    event.sender.send('file-open-error', { error: error.message, path: filePath });
  }
});

ipcMain.on('delete-downloaded-file', (event, { lectureId, filePath }) => {
  try {
    // Delete the file from disk
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    // Remove from settings
    let downloadedFiles = settings.get('downloadedFiles') || [];
    downloadedFiles = downloadedFiles.filter(file => file.lectureId !== lectureId);
    settings.set('downloadedFiles', downloadedFiles);

    win.webContents.send('download-deleted', { lectureId, success: true });
  } catch (error) {
    console.error('Error deleting file:', error);
    win.webContents.send('download-deleted', { lectureId, success: false, error: error.message });
  }
});

ipcMain.on('clear-all-downloads', (event) => {
  try {
    const downloadedFiles = settings.get('downloadedFiles') || [];
    let deletedCount = 0;
    let errorCount = 0;

    // Delete all files from disk
    downloadedFiles.forEach(file => {
      try {
        if (fs.existsSync(file.filePath)) {
          fs.unlinkSync(file.filePath);
          deletedCount++;
        }
      } catch (error) {
        console.error('Error deleting file:', file.filePath, error);
        errorCount++;
      }
    });

    // Clear settings
    settings.set('downloadedFiles', []);

    win.webContents.send('all-downloads-cleared', {
      success: true,
      deletedCount,
      errorCount,
      totalFiles: downloadedFiles.length
    });
  } catch (error) {
    console.error('Error clearing downloads:', error);
    win.webContents.send('all-downloads-cleared', {
      success: false,
      error: error.message
    });
  }
});
