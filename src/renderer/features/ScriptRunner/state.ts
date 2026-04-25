import { objectEquals } from '@observ33r/object-equals';
import { Terminal } from '@xterm/xterm';
import { atom } from 'nanostores';

import { DEFAULT_XTERM_OPTIONS, STATUS_POLL_INTERVAL_MS } from '@/renderer/constants';
import { emitter, ipc } from '@/renderer/services/ipc';
import type { ScriptInfo, ScriptProcessStatus, WithTimestamp } from '@/shared/types';

export const $isScriptRunnerOpen = atom(false);
export const $availableScripts = atom<ScriptInfo[]>([]);
export const $selectedScript = atom<ScriptInfo | null>(null);

export const $scriptProcessStatus = atom<WithTimestamp<ScriptProcessStatus>>({
  type: 'idle',
  timestamp: Date.now(),
});

export const $scriptProcessXTerm = atom<Terminal | null>(null);
const terminalSubscriptions = new Set<() => void>();

const initializeTerminal = (): Terminal => {
  let xterm = $scriptProcessXTerm.get();
  if (xterm) {
    return xterm;
  }

  xterm = new Terminal({ ...DEFAULT_XTERM_OPTIONS, disableStdin: true });

  terminalSubscriptions.add(
    ipc.on('script-process:raw-output', (_, data) => {
      xterm.write(data);
    })
  );

  terminalSubscriptions.add(
    xterm.onResize(({ cols, rows }) => {
      emitter.invoke('script-process:resize', cols, rows);
    }).dispose
  );

  $scriptProcessXTerm.set(xterm);
  return xterm;
};

export const teardownScriptTerminal = () => {
  for (const unsubscribe of terminalSubscriptions) {
    unsubscribe();
  }
  terminalSubscriptions.clear();
  const xterm = $scriptProcessXTerm.get();
  if (!xterm) {
    return;
  }
  xterm.dispose();
  $scriptProcessXTerm.set(null);
};

export const loadAvailableScripts = async (installLocation: string) => {
  const scripts = await emitter.invoke('script-process:get-available-scripts', installLocation);
  $availableScripts.set(scripts);
  if (scripts.length > 0 && !$selectedScript.get()) {
    $selectedScript.set(scripts[0]!);
  }
};

export const runSelectedScript = (installLocation: string) => {
  const script = $selectedScript.get();
  if (!script) {
    return;
  }
  initializeTerminal();
  emitter.invoke('script-process:run-script', installLocation, script.path);
};

export const stopScript = async () => {
  await emitter.invoke('script-process:stop-script');
};

export const openScriptRunner = (installLocation: string) => {
  loadAvailableScripts(installLocation);
  $isScriptRunnerOpen.set(true);
};

export const closeScriptRunner = () => {
  $isScriptRunnerOpen.set(false);
};

// Listen for status changes
const listen = () => {
  ipc.on('script-process:status', (_, status) => {
    $scriptProcessStatus.set(status);
  });

  const poll = async () => {
    const oldStatus = $scriptProcessStatus.get();
    const newStatus = await emitter.invoke('script-process:get-status');
    if (objectEquals(oldStatus, newStatus)) {
      return;
    }
    $scriptProcessStatus.set(newStatus);
  };

  setInterval(poll, STATUS_POLL_INTERVAL_MS);
};

listen();
