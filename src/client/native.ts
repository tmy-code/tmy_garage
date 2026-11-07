import { FileOpener } from '@capacitor-community/file-opener';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { StatusBar, Style } from '@capacitor/status-bar';

// What only the Android app does (ADR 0006). In the browser every function here falls back to the web behaviour.

export const isAndroidApp = Capacitor.isNativePlatform();

/** Android's back button goes back one screen, and leaves the app from the home screen. */
export function initAndroidApp(): void {
  if (!isAndroidApp) return;
  void StatusBar.setStyle({ style: Style.Dark }).catch(() => undefined);
  void StatusBar.setBackgroundColor({ color: '#000000' }).catch(() => undefined);
  void App.addListener('backButton', () => {
    if (location.hash === '' || location.hash === '#/' || location.hash === '#') void App.exitApp();
    else history.back();
  });
}

/** Opens a file the server sends (the purchases CSV) where the phone can save it; the app's own browser cannot. */
export async function openInBrowser(url: string): Promise<void> {
  await Browser.open({ url });
}

/**
 * Opens a Document's file in the phone's own viewer (PDF reader, gallery): downloaded into the app's cache first, since
 * the app's browser cannot show a PDF.
 */
export async function openDocument(url: string, fileName: string, contentType: string): Promise<void> {
  const path = `documents/${Date.now()}-${fileName.replace(/[^\w.-]+/g, '_')}`;
  const { path: filePath } = await Filesystem.downloadFile({ url, path, directory: Directory.Cache, recursive: true });
  if (!filePath) throw new Error('Download failed');
  await FileOpener.open({ filePath, contentType, openWithDefault: true });
}
