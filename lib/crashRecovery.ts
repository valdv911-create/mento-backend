import { prisma } from './prisma';
import { flush as flushLogs, error as logError } from './logger';

type ShutdownTask = () => Promise<void>;

const state = globalThis as typeof globalThis & {
  __mentoCrashRecovery?: {
    installed: boolean;
    shuttingDown: boolean;
    activeOperations: Set<Promise<unknown>>;
    tasks: Set<ShutdownTask>;
    shutdownPromise?: Promise<void>;
  };
};

const recoveryState = state.__mentoCrashRecovery ??= {
  installed: false,
  shuttingDown: false,
  activeOperations: new Set<Promise<unknown>>(),
  tasks: new Set<ShutdownTask>(),
};

export function registerShutdownTask(task: ShutdownTask): () => void {
  recoveryState.tasks.add(task);
  return () => recoveryState.tasks.delete(task);
}

export async function trackShutdownOperation<T>(operation: Promise<T>): Promise<T> {
  if (recoveryState.shuttingDown) {
    throw new Error('Server is shutting down');
  }

  recoveryState.activeOperations.add(operation);
  try {
    return await operation;
  } finally {
    recoveryState.activeOperations.delete(operation);
  }
}

async function waitForActiveOperations(): Promise<void> {
  while (recoveryState.activeOperations.size > 0) {
    await Promise.allSettled([...recoveryState.activeOperations]);
  }
}

async function shutdown(exitCode: number, cause: string, error?: unknown): Promise<void> {
  if (recoveryState.shutdownPromise) return recoveryState.shutdownPromise;

  recoveryState.shuttingDown = true;
  recoveryState.shutdownPromise = (async () => {
    logError('Process shutdown started', {
      cause,
      exitCode,
      error: error instanceof Error ? error.message : error,
    });

    try {
      await waitForActiveOperations();
      await Promise.allSettled([...recoveryState.tasks].map((task) => task()));
      await prisma.$disconnect();
    } catch (shutdownError) {
      logError('Process shutdown cleanup failed', {
        error: shutdownError instanceof Error ? shutdownError.message : shutdownError,
      });
    } finally {
      await flushLogs();
      process.exit(exitCode);
    }
  })();

  return recoveryState.shutdownPromise;
}

export function registerCrashRecovery(): void {
  if (recoveryState.installed || typeof process === 'undefined') return;
  recoveryState.installed = true;

  process.on('uncaughtException', (error) => {
    void shutdown(1, 'uncaughtException', error);
  });
  process.on('unhandledRejection', (reason) => {
    void shutdown(1, 'unhandledRejection', reason);
  });
  process.on('SIGTERM', () => {
    void shutdown(0, 'SIGTERM');
  });
  process.on('SIGINT', () => {
    void shutdown(0, 'SIGINT');
  });
}