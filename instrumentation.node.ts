import { registerCrashRecovery, registerShutdownTask } from './lib/crashRecovery';

registerCrashRecovery();

const [{ shutdownActiveSimliSessions }, { recoverActivePaymentTransactions }] = await Promise.all([
  import('./services/simliService'),
  import('./services/paymentService'),
]);

registerShutdownTask(shutdownActiveSimliSessions);
registerShutdownTask(recoverActivePaymentTransactions);