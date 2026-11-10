import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC_CHANNELS_V1,
  IPC_EVENT_CHANNEL,
  IPC_PREFIX,
  type CSenseBridgeV1,
  type IpcArea,
  type MainEvent,
} from '../shared/ipcChannels';

/**
 * Bridge v1 (ADR 0013). Named methods only: no generic invoke, no `ipcRenderer`, no event objects.
 * Each method forwards its arguments to exactly one declared channel; main validates everything.
 * The table in `IPC_CHANNELS_V1` drives both this file and main's registry, so they cannot drift.
 */
function buildArea(area: IpcArea): Record<string, (...args: unknown[]) => Promise<unknown>> {
  const out: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  for (const method of IPC_CHANNELS_V1[area]) {
    const channel = `${IPC_PREFIX}${area}.${method}`;
    out[method] = (...args: unknown[]) => ipcRenderer.invoke(channel, ...args) as Promise<unknown>;
  }
  return Object.freeze(out);
}

const events = Object.freeze({
  subscribe(listener: (e: MainEvent) => void): () => void {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    // Payload only: the IpcRendererEvent (and its sender) is never handed to the page.
    const handler = (_event: unknown, payload: MainEvent): void => {
      listener(payload);
    };
    ipcRenderer.on(IPC_EVENT_CHANNEL, handler);
    return () => {
      ipcRenderer.removeListener(IPC_EVENT_CHANNEL, handler);
    };
  },
});

const bridge = Object.freeze({
  bridgeVersion: 1,
  appVersion: __APP_VERSION__,
  session: buildArea('session'),
  gate: buildArea('gate'),
  assessment: buildArea('assessment'),
  learning: buildArea('learning'),
  events,
}) as unknown as CSenseBridgeV1;

contextBridge.exposeInMainWorld('csense', bridge);
