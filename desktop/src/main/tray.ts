/**
 * System tray (D5-22): created after the first release so reminders and clearance timers keep running
 * when the window is closed. Open / Sign out / Quit exist only while unlocked; while the gate or a
 * quiz lockdown is up the menu offers nothing that could end the process or the session.
 */
import { Menu, Tray, nativeImage } from 'electron';
import { makeTrayPng } from './trayIcon';

export interface TrayDeps {
  isUnlocked: () => boolean;
  onOpen: () => void;
  onSignOut: () => void;
  onQuit: () => void;
}

export interface TrayHandle {
  refresh(): void;
  dispose(): void;
}

export function createTray(deps: TrayDeps): TrayHandle {
  const tray = new Tray(nativeImage.createFromBuffer(makeTrayPng(32)));
  tray.setToolTip('CSense');

  const build = (): void => {
    const unlocked = deps.isUnlocked();
    tray.setContextMenu(
      Menu.buildFromTemplate(
        unlocked
          ? [
              { label: 'Open CSense', click: deps.onOpen },
              { label: 'Sign out', click: deps.onSignOut },
              { type: 'separator' },
              { label: 'Quit', click: deps.onQuit },
            ]
          : [{ label: 'CSense is locked', enabled: false }],
      ),
    );
  };
  tray.on('click', () => {
    if (deps.isUnlocked()) deps.onOpen();
  });
  build();

  return {
    refresh: build,
    dispose: () => {
      tray.destroy();
    },
  };
}
