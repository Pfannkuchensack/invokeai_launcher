import type { IpcListener } from '@electron-toolkit/typed-ipc/main';
import c from 'ansi-colors';
import { ipcMain } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import { shellEnvSync } from 'shell-env';

import { CommandRunner } from '@/lib/command-runner';
import { DEFAULT_ENV } from '@/lib/pty-utils';
import { SimpleLogger } from '@/lib/simple-logger';
import type {
  IpcEvents,
  IpcRendererEvents,
  ScriptInfo,
  ScriptProcessStatus,
  WithTimestamp,
} from '@/shared/types';

export class ScriptManager {
  private status: WithTimestamp<ScriptProcessStatus>;
  private ipcRawOutput: (data: string) => void;
  private onStatusChange: (status: WithTimestamp<ScriptProcessStatus>) => void;
  private log: SimpleLogger;
  private commandRunner: CommandRunner;
  private cols: number | undefined;
  private rows: number | undefined;

  constructor(arg: {
    ipcRawOutput: ScriptManager['ipcRawOutput'];
    onStatusChange: ScriptManager['onStatusChange'];
  }) {
    this.ipcRawOutput = arg.ipcRawOutput;
    this.onStatusChange = arg.onStatusChange;
    this.status = { type: 'idle', timestamp: Date.now() };
    this.log = new SimpleLogger((entry) => {
      this.ipcRawOutput(entry.message);
      console[entry.level](entry.message);
    });
    this.commandRunner = new CommandRunner();
    this.cols = undefined;
    this.rows = undefined;
  }

  getStatus = (): WithTimestamp<ScriptProcessStatus> => {
    return this.status;
  };

  private updateStatus = (status: ScriptProcessStatus): void => {
    this.status = { ...status, timestamp: Date.now() };
    this.onStatusChange(this.status);
  };

  resizePty = (cols: number, rows: number): void => {
    this.cols = cols;
    this.rows = rows;
    this.commandRunner.resize(cols, rows);
  };

  /**
   * Discover available InvokeAI scripts in the venv bin directory.
   * Returns scripts whose filenames start with "invokeai" (excluding "invokeai-web").
   */
  getAvailableScripts = async (installLocation: string): Promise<ScriptInfo[]> => {
    const binDir =
      process.platform === 'win32'
        ? path.join(installLocation, '.venv', 'Scripts')
        : path.join(installLocation, '.venv', 'bin');

    try {
      const entries = await fs.readdir(binDir);
      const scripts: ScriptInfo[] = [];

      for (const entry of entries) {
        const baseName = path.parse(entry).name.toLowerCase();

        // Only include invokeai-* scripts, exclude the main invokeai-web entry point
        if (!baseName.startsWith('invokeai')) {
          continue;
        }
        if (baseName === 'invokeai-web') {
          continue;
        }

        // On Windows, only include .exe files
        if (process.platform === 'win32' && !entry.toLowerCase().endsWith('.exe')) {
          continue;
        }

        // On Unix, skip files with extensions (like .py, .fish, etc.) - we want the bare executables
        if (process.platform !== 'win32' && path.extname(entry) !== '') {
          continue;
        }

        const fullPath = path.join(binDir, entry);
        const displayName = path.parse(entry).name;

        scripts.push({
          name: displayName,
          path: fullPath,
        });
      }

      // Sort alphabetically
      scripts.sort((a, b) => a.name.localeCompare(b.name));
      return scripts;
    } catch {
      return [];
    }
  };

  /**
   * Run a script from the InvokeAI installation.
   */
  runScript = async (installLocation: string, scriptPath: string): Promise<void> => {
    if (this.commandRunner.isRunning()) {
      this.log.warn(c.yellow('A script is already running. Stop it first.\r\n'));
      return;
    }

    this.updateStatus({ type: 'running' });

    const scriptName = path.basename(scriptPath);
    this.log.info(c.cyan(`Running script: ${scriptName}\r\n`));

    const env: Record<string, string> = {
      ...process.env,
      INVOKEAI_ROOT: installLocation,
      ...DEFAULT_ENV,
      ...shellEnvSync(),
    };

    if (process.platform === 'darwin') {
      env.PYTORCH_ENABLE_MPS_FALLBACK = '1';
    }

    try {
      await this.commandRunner.runCommand(
        scriptPath,
        [],
        {
          cwd: installLocation,
          env,
          rows: this.rows,
          cols: this.cols,
        },
        {
          onData: (data) => {
            this.ipcRawOutput(data);
            process.stdout.write(data);
          },
          onExit: (exitCode) => {
            if (exitCode === 0) {
              this.log.info(c.green.bold(`\r\nScript "${scriptName}" completed successfully.\r\n`));
            } else {
              this.log.info(c.red(`\r\nScript "${scriptName}" exited with code ${exitCode}.\r\n`));
            }
            this.updateStatus({ type: 'completed' });
          },
        }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log.error(c.red(`Failed to run script: ${message}\r\n`));
      this.updateStatus({ type: 'error', error: { message } });
    }
  };

  /**
   * Stop the currently running script.
   */
  stopScript = async (): Promise<void> => {
    if (!this.commandRunner.isRunning()) {
      return;
    }
    this.log.info(c.cyan('Stopping script...\r\n'));
    await this.commandRunner.kill(10_000);
    this.updateStatus({ type: 'idle' });
  };
}

/**
 * Create a ScriptManager instance and set up IPC handlers.
 */
export const createScriptManager = (arg: {
  ipc: IpcListener<IpcEvents>;
  sendToWindow: <T extends keyof IpcRendererEvents>(channel: T, ...args: IpcRendererEvents[T]) => void;
}) => {
  const { ipc, sendToWindow } = arg;

  const scriptManager = new ScriptManager({
    ipcRawOutput: (data) => {
      sendToWindow('script-process:raw-output', data);
    },
    onStatusChange: (status) => {
      sendToWindow('script-process:status', status);
    },
  });

  ipc.handle('script-process:get-available-scripts', (_, location) => {
    return scriptManager.getAvailableScripts(location);
  });

  ipc.handle('script-process:run-script', (_, location, scriptPath) => {
    scriptManager.runScript(location, scriptPath);
  });

  ipc.handle('script-process:stop-script', async () => {
    await scriptManager.stopScript();
  });

  ipc.handle('script-process:resize', (_, cols, rows) => {
    scriptManager.resizePty(cols, rows);
  });

  const cleanup = async () => {
    await scriptManager.stopScript();
    ipcMain.removeHandler('script-process:get-available-scripts');
    ipcMain.removeHandler('script-process:run-script');
    ipcMain.removeHandler('script-process:stop-script');
    ipcMain.removeHandler('script-process:resize');
  };

  return [scriptManager, cleanup] as const;
};
