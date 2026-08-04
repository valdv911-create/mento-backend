export type OfflineTaskType = 'chat' | 'image' | 'tutor';

export interface OfflineResilienceTask {
  id: string;
  type: OfflineTaskType;
  payload: Record<string, unknown>;
  maxAttempts: number;
  attempts: number;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  createdAt: string;
  updatedAt: string;
  error?: string;
}

export interface OfflineResilienceManagerOptions {
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  storageKey?: string;
  isOnline?: boolean;
  baseDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
  onStateChange?: (state: OfflineResilienceState) => void;
  restoreExecutor?: (task: OfflineResilienceTask) => (() => Promise<unknown>) | undefined;
}

export interface OfflineResilienceState {
  isOnline: boolean;
  pendingCount: number;
  queue: OfflineResilienceTask[];
}

interface TaskExecutorContext {
  signal: AbortSignal;
}

export type TaskExecutor = (context: TaskExecutorContext) => Promise<unknown> | unknown;

interface InternalTask extends OfflineResilienceTask {
  executor?: TaskExecutor;
  retryAt?: number;
  timeoutMs?: number;
  abortController?: AbortController;
}

const DEFAULT_STORAGE_KEY = 'mento:offline-resilience-queue';
const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 8000;
const DEFAULT_TIMEOUT_MS = 15000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createTaskId() {
  return `task-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeTask(task: OfflineResilienceTask): OfflineResilienceTask {
  return {
    ...task,
    payload: task.payload ?? {},
    attempts: Math.max(0, task.attempts ?? 0),
    maxAttempts: Math.max(1, task.maxAttempts ?? 1),
    status: task.status ?? 'queued',
  };
}

function readPersistedTasks(storage: Pick<Storage, 'getItem'>, storageKey: string): OfflineResilienceTask[] {
  const raw = storage.getItem(storageKey);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is OfflineResilienceTask => Boolean(item) && typeof item === 'object').map((item) => normalizeTask(item as OfflineResilienceTask));
  } catch {
    return [];
  }
}

function writePersistedTasks(storage: Pick<Storage, 'setItem'>, storageKey: string, tasks: OfflineResilienceTask[]) {
  storage.setItem(storageKey, JSON.stringify(tasks));
}

function getBackoffDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const multiplier = Math.min(baseDelayMs * (attempt + 1), maxDelayMs);
  return Math.round(multiplier * (0.7 + Math.random() * 0.6));
}

export function createOfflineResilienceManager(options: OfflineResilienceManagerOptions = {}) {
  const storage = options.storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);
  const storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const defaultTimeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const onStateChange = options.onStateChange;
  const restoreExecutor = options.restoreExecutor;

  let isOnline = options.isOnline ?? (typeof navigator !== 'undefined' ? navigator.onLine : true);
  let pendingQueue: InternalTask[] = [];
  let isProcessing = false;
  let initialized = false;

  const publishState = () => {
    const queue = pendingQueue.map((task) => ({ ...task, executor: undefined }));
    onStateChange?.({ isOnline, pendingCount: queue.filter((task) => task.status === 'queued' || task.status === 'running').length, queue });
  };

  const persistQueue = () => {
    if (!storage) return;
    const snapshot = pendingQueue.map((task) => Object.fromEntries(
      Object.entries(task).filter(([key]) => key !== 'executor' && key !== 'abortController')
    )) as OfflineResilienceTask[];
    writePersistedTasks(storage, storageKey, snapshot);
  };

  const hydrateFromStorage = () => {
    if (!storage || initialized) return;
    initialized = true;
    const restored = readPersistedTasks(storage, storageKey);
    pendingQueue = restored.map((task) => ({
      ...task,
      executor: restoreExecutor ? restoreExecutor(task) : undefined,
      timeoutMs: defaultTimeoutMs,
    }));
    publishState();
  };

  const setTaskState = (task: InternalTask, status: OfflineResilienceTask['status'], error?: string) => {
    task.status = status;
    task.updatedAt = new Date().toISOString();
    if (error) task.error = error;
    else delete task.error;
    persistQueue();
    publishState();
  };

  const executeTask = async (task: InternalTask) => {
    const timeoutMs = task.timeoutMs ?? defaultTimeoutMs;
    const controller = new AbortController();
    task.abortController = controller;

    const timeoutHandle = globalThis.setTimeout(() => controller.abort(), timeoutMs);
    try {
      if (!task.executor) {
        throw new Error('No executor registered for this task.');
      }
      await Promise.resolve(task.executor({ signal: controller.signal }));
    } finally {
      clearTimeout(timeoutHandle);
      task.abortController = undefined;
    }
  };

  const processQueue = async () => {
    if (isProcessing || !isOnline) return;
    isProcessing = true;
    while (pendingQueue.some((task) => task.status === 'queued' || (task.status === 'running' && task.retryAt && task.retryAt <= Date.now()))) {
      const readyTask = pendingQueue.find((task) => task.status === 'queued' || (task.status === 'running' && task.retryAt && task.retryAt <= Date.now()));
      if (!readyTask) break;
      if (readyTask.status === 'queued') {
        setTaskState(readyTask, 'running');
      }

      try {
        await executeTask(readyTask);
        setTaskState(readyTask, 'succeeded');
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        readyTask.attempts += 1;
        if (readyTask.attempts >= readyTask.maxAttempts) {
          setTaskState(readyTask, 'failed', errorMessage);
        } else {
          const delay = getBackoffDelay(readyTask.attempts, baseDelayMs, maxDelayMs);
          readyTask.retryAt = Date.now() + delay;
          setTaskState(readyTask, 'queued', errorMessage);
          await sleep(delay);
        }
      }
    }
    isProcessing = false;
    publishState();
  };

  const enqueue = async (taskInput: Omit<OfflineResilienceTask, 'id' | 'attempts' | 'status' | 'createdAt' | 'updatedAt' | 'error'> & { executor?: TaskExecutor; timeoutMs?: number }, executor?: TaskExecutor): Promise<OfflineResilienceTask> => {
    hydrateFromStorage();
    const task: InternalTask = {
      id: createTaskId(),
      type: taskInput.type,
      payload: taskInput.payload ?? {},
      maxAttempts: taskInput.maxAttempts ?? 1,
      attempts: 0,
      status: 'queued',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      executor: executor ?? taskInput.executor,
      timeoutMs: taskInput.timeoutMs ?? defaultTimeoutMs,
    };

    pendingQueue.push(task);
    persistQueue();
    publishState();

    if (isOnline) {
      void processQueue();
    }

    return task;
  };

  const setOnline = (online: boolean) => {
    isOnline = online;
    publishState();
    if (isOnline) {
      void processQueue();
    }
  };

  const cancel = (taskId: string) => {
    const task = pendingQueue.find((entry) => entry.id === taskId);
    if (!task) return false;
    task.abortController?.abort();
    setTaskState(task, 'cancelled');
    pendingQueue = pendingQueue.filter((entry) => entry.id !== taskId);
    persistQueue();
    publishState();
    return true;
  };

  const getState = () => ({
    isOnline,
    pendingCount: pendingQueue.filter((task) => task.status === 'queued' || task.status === 'running').length,
    queue: pendingQueue.map((task) => ({ ...task, executor: undefined })),
  });

  const clearCompleted = () => {
    pendingQueue = pendingQueue.filter((task) => task.status !== 'succeeded' && task.status !== 'failed' && task.status !== 'cancelled');
    persistQueue();
    publishState();
  };

  hydrateFromStorage();
  if (isOnline) {
    void processQueue();
  }

  return {
    enqueue,
    setOnline,
    cancel,
    getState,
    clearCompleted,
    processQueue,
  };
}

export function createOfflineResilienceManagerForBrowser(options: OfflineResilienceManagerOptions = {}) {
  if (typeof window === 'undefined') {
    return createOfflineResilienceManager(options);
  }

  const manager = createOfflineResilienceManager(options);
  const handleOnline = () => manager.setOnline(true);
  const handleOffline = () => manager.setOnline(false);

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);

  return {
    ...manager,
    dispose: () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    },
  };
}
