import { reserveUsage, type BillingDecision } from './billingService';

export interface ChatBillingGuardResult {
  allowed: boolean;
  status: number;
  error?: string;
  code?: string;
  details?: Record<string, unknown>;
  billingDecision?: BillingDecision;
}

export interface ChatBillingGuardOptions {
  amount?: number;
  requestId?: string;
  provider?: string;
  modelUsed?: string | null;
  metadata?: Record<string, unknown>;
  reserveUsageFn?: typeof reserveUsage;
}

export async function enforceChatBilling(userId: string, options: ChatBillingGuardOptions = {}): Promise<ChatBillingGuardResult> {
  const reserveUsageFn = options.reserveUsageFn ?? reserveUsage;

  const billingDecision = await reserveUsageFn({
    userId,
    feature: 'chat',
    amount: options.amount ?? 1,
    provider: options.provider ?? 'Gemini',
    modelUsed: options.modelUsed ?? null,
    requestId: options.requestId,
    metadata: options.metadata,
    pending: true,
  });

  if (!billingDecision.allowed) {
    return {
      allowed: false,
      status: 402,
      error: billingDecision.reason,
      code: 'USAGE_LIMIT_REACHED',
      details: {
        remainingUsage: billingDecision.remainingUsage,
        resetTime: billingDecision.resetTime,
        upgradeAvailable: billingDecision.upgradeAvailable,
      },
      billingDecision,
    };
  }

  return {
    allowed: true,
    status: 200,
    billingDecision,
  };
}
