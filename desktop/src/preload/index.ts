import { contextBridge } from 'electron';
import type { CSenseBridge } from './bridge';

/**
 * Minimal, typed bridge. Phase 0 exposes only the app version.
 * Never expose ipcRenderer, require, or Node APIs to the renderer.
 */
const api: CSenseBridge = Object.freeze({ appVersion: __APP_VERSION__ });

contextBridge.exposeInMainWorld('csense', api);
