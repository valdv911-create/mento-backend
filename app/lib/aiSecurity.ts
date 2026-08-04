import { assessAndSecureChatRequest } from '../../lib/aiSecurityIntegration';

export interface AIInputSecurityResult {
  allowed: boolean;
  sanitizedInput: string;
  warnings: string[];
  statusCode?: number;
  errorResponse?: Record<string, unknown>;
}

export async function secureAIInput(input: string, context: { userId: string; requestId: string; ip: string; conversationId?: string; hasImage?: boolean }) {
  const result = await assessAndSecureChatRequest(input, context);

  if (!result.allowed) {
    return {
      allowed: false,
      sanitizedInput: '',
      warnings: result.warnings,
      statusCode: result.statusCode,
      errorResponse: result.errorResponse,
    } satisfies AIInputSecurityResult;
  }

  return {
    allowed: true,
    sanitizedInput: result.sanitizedInput,
    warnings: result.warnings,
  } satisfies AIInputSecurityResult;
}
