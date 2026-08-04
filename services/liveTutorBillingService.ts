import { reserveUsage, type BillingDecision } from './billingService';

export type LiveTutorBillingResult = BillingDecision;

interface LiveTutorReservationOptions {
  requestId?: string;
  metadata?: Record<string, unknown>;
}

export async function canUseLiveTutor(userId: string, seconds = 60): Promise<LiveTutorBillingResult> {
  return reserveUsage({ userId, feature: 'live_tutor', amount: seconds, provider: 'Simli', pending: true, secondsUsed: seconds });
}

export async function consumeLiveTutorSeconds(userId: string, seconds = 60, options: LiveTutorReservationOptions = {}): Promise<LiveTutorBillingResult> {
  return reserveUsage({
    userId,
    feature: 'live_tutor',
    amount: seconds,
    provider: 'Simli',
    requestId: options.requestId,
    metadata: options.metadata,
    pending: true,
    secondsUsed: seconds,
  });
}

export async function consumeLiveTutorMinutes(userId: string, minutes = 1, options: LiveTutorReservationOptions = {}): Promise<LiveTutorBillingResult> {
  return consumeLiveTutorSeconds(userId, minutes * 60, options);
}
