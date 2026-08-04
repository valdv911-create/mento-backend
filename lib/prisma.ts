import type { PrismaClient as PrismaClientType } from '@prisma/client';
import { observeMonitoringLatency } from './monitoring';
import './metrics';
import { loadAndValidateEnvironment } from './env';

loadAndValidateEnvironment();

// Attempt to load @prisma/client at runtime. If it's not installed or the
// generated client is missing, provide a clear error when used instead of
// causing a compile-time import error.
let PrismaClient: typeof PrismaClientType;
try {
  const prismaModule = await import('@prisma/client');
  PrismaClient = prismaModule.PrismaClient as typeof PrismaClientType;
} catch {
  PrismaClient = class {
    constructor() {
      throw new Error("@prisma/client not found. Install @prisma/client and generate the client (e.g. `npm install @prisma/client && npx prisma generate`).");
    }
  } as unknown as typeof PrismaClientType;
}


declare global {
  // PrismaClient is a value (constructor) at runtime. Use InstanceType<typeof PrismaClient>
  // to refer to the client instance type without importing types from @prisma/client.
  var prisma: InstanceType<typeof PrismaClient> | undefined;
}

export const prisma = global.prisma ?? new PrismaClient();
prisma.$use(async (params, next) => {
  const startedAt = Date.now();
  try {
    const result = await next(params);
    observeMonitoringLatency('database', Date.now() - startedAt, { operation: params.action });
    return result;
  } catch (error) {
    observeMonitoringLatency('database', Date.now() - startedAt, { operation: params.action, status: 'error' });
    throw error;
  }
});
if (process.env.NODE_ENV !== 'production') global.prisma = prisma;
