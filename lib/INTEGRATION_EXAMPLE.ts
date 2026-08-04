/**
 * EXAMPLE: AI Security Layer Integration with Existing Chat Route
 *
 * This file demonstrates how to integrate the security layer
 * into your existing chat endpoint WITHOUT modifying behavior.
 *
 * Copy the key parts into your actual route.ts file.
 */

import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/app/lib/auth';
import { askGemini } from '@/services/geminiService';
import { enforceRateLimit } from '@/lib/rate-limiter';

// ✨ NEW IMPORTS
import { assessAndSecureChatRequest } from '@/lib/aiSecurityIntegration';
import { getRequestAuditor } from '@/lib/requestAuditor';
import logger from '@/lib/logger';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function getClientIp(req: Request) {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  const realIp = req.headers.get('x-real-ip');
  if (realIp) return realIp;
  return req.headers.get('host') || 'unknown';
}

/**
 * ========================================
 * INTEGRATED CHAT ROUTE WITH AI SECURITY
 * ========================================
 */
export async function POST(req: Request) {
  logger.info('Chat POST received');

  try {
    // 1. AUTHENTICATE
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers: CORS_HEADERS }
      );
    }
    const userId = user.id;

    // 2. PARSE REQUEST
    let body: { message?: unknown; image?: unknown; requestId?: unknown; conversationId?: unknown } | null = null;
    try {
      body = await req.json() as { message?: unknown; image?: unknown; requestId?: unknown; conversationId?: unknown };
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const message = typeof body?.message === 'string' ? body.message.trim() : '';
    const image = body?.image;
    const requestId =
      typeof body?.requestId === 'string' && body.requestId.trim()
        ? body.requestId.trim()
        : `chat-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const conversationId = typeof body?.conversationId === 'string' ? body.conversationId : undefined;

    if (!message && !image) {
      return NextResponse.json(
        { error: 'Invalid input: message or image is required' },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const clientIp = getClientIp(req);

    // ✨ 3. AI SECURITY CHECK
    // This is the key integration point
    logger.info('Running AI security assessment', { userId, requestId });

    const securityResult = await assessAndSecureChatRequest(
      message,
      {
        userId,
        requestId,
        ip: clientIp,
        conversationId,
        hasImage: Boolean(image),
      },
      {
        maxInputLength: 8000,
        enablePromptInjectionDetection: true,
        enableAbuseScoring: true,
        enableDetailedLogging: process.env.NODE_ENV !== 'production',
      }
    );

    // Handle security rejection
    if (!securityResult.allowed) {
      logger.warn('Chat request blocked by security layer', {
        userId,
        requestId,
        riskLevel: securityResult.riskLevel,
        warnings: securityResult.warnings,
      });

      return NextResponse.json(
        securityResult.errorResponse || {
          error: 'Your request could not be processed',
          code: 'security_check_failed',
        },
        { status: securityResult.statusCode || 400, headers: CORS_HEADERS }
      );
    }

    // ✨ Use sanitized input from security layer
    const sanitizedMessage = securityResult.sanitizedInput;
    logger.info('Chat security check passed', {
      userId,
      requestId,
      riskLevel: securityResult.riskLevel,
      sanitizedLength: sanitizedMessage.length,
      originalLength: message.length,
    });

    // 4. RATE LIMITING (after security check for defense-in-depth)
    const rl = await enforceRateLimit(userId, clientIp);
    if (!rl.ok) {
      return NextResponse.json(
        { error: rl.message },
        {
          status: rl.status ?? 429,
          headers: rl.retryAfterSec ? { 'Retry-After': String(rl.retryAfterSec) } : undefined,
        }
      );
    }

    // 5. CONVERSATION & HISTORY (existing logic)
    // ... your existing conversation handling code ...
    // Note: Use sanitizedMessage instead of message

    // 6. SEND TO GEMINI (using sanitized input)
    logger.info('Sending sanitized chat to Gemini', { userId, conversationId });

    let aiResponse = '';
    try {
      // ✨ Pass sanitized input to Gemini
      aiResponse = await askGemini(sanitizedMessage);

      logger.info('Gemini response received', {
        userId,
        conversationId,
        responseLength: aiResponse.length,
      });
    } catch (providerError) {
      logger.error('Gemini provider error', { userId, error: providerError });
      return NextResponse.json(
        {
          error: 'I\'m unable to respond right now. Please try again in a moment.',
          code: 'provider_unavailable',
          degraded: true,
        },
        { status: 503, headers: CORS_HEADERS }
      );
    }

    // 7. PERSIST TO DATABASE
    // ... your existing DB storage code ...

    logger.info('Chat request completed successfully', {
      userId,
      requestId,
      riskLevel: securityResult.riskLevel,
    });

    return NextResponse.json(
      { result: aiResponse, conversationId },
      { headers: CORS_HEADERS }
    );
  } catch (err: unknown) {
    logger.error('Chat route error', { error: err });
    return NextResponse.json(
      {
        error: 'I\'m unable to process your request right now. Please try again shortly.',
        code: 'internal_error',
      },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

/**
 * ========================================
 * OPTIONAL: WITH IMAGE SUPPORT
 * ========================================
 *
 * If your route supports images, the security layer
 * works the same way:
 */
export async function POST_WITH_IMAGES(req: Request) {
  const body = await req.json() as { message?: string; image?: { data?: string; mimeType?: string } };
  const message = body.message || '';
  const image = body.image;

  // Security check applies to text part only
  // (images are validated separately by your code)
  const securityResult = await assessAndSecureChatRequest(
    message,
    { userId: 'user123', requestId: 'req123', ip: '127.0.0.1' }
  );

  if (!securityResult.allowed) {
    return NextResponse.json(securityResult.errorResponse, {
      status: securityResult.statusCode,
    });
  }

  // Use sanitized message with optional image
  const contents = [
    { role: 'user', parts: [{ text: securityResult.sanitizedInput }] },
    image && { type: 'image', data: image.data, mimeType: image.mimeType },
  ].filter(Boolean);

  // ... rest of logic
}

/**
 * ========================================
 * OPTIONAL: MONITORING & METRICS
 * ========================================
 */
export async function GET_SECURITY_METRICS(req: Request) {
  // Admin endpoint to view security metrics
  // Protect this with admin auth!

  const auditor = getRequestAuditor();

  return NextResponse.json({
    summary: auditor.getAuditSummary(3600000), // Last hour
    suspicious: auditor.detectSuspiciousPatterns(undefined, 3600000),
    logs: auditor.queryLogs({ limit: 100 }),
  });
}

/**
 * ========================================
 * KEY INTEGRATION POINTS
 * ========================================
 *
 * 1. ✨ AFTER PARSING REQUEST, BEFORE RATE LIMIT:
 *    → Call assessAndSecureChatRequest()
 *    → Check result.allowed
 *    → Return error if blocked
 *
 * 2. ✨ USE SANITIZED INPUT:
 *    → Replace message with securityResult.sanitizedInput
 *    → Pass to Gemini
 *
 * 3. ✨ NO OTHER CHANGES NEEDED:
 *    → Existing rate limiting still works
 *    → DB storage unchanged
 *    → Frontend APIs unchanged
 *    → Response format identical
 *
 * ========================================
 */

/**
 * ========================================
 * CONFIGURATION REFERENCE
 * ========================================
 *
 * For stricter security in sensitive contexts:
 *
 * const securityResult = await assessAndSecureChatRequest(
 *   message,
 *   { userId, requestId, ip, conversationId },
 *   {
 *     maxInputLength: 5000,        // Shorter max
 *     abuseScoreThreshold: 50,     // Lower threshold
 *     enableDetailedLogging: true, // More logs
 *   }
 * );
 *
 * For more lenient in trusted contexts:
 *
 * const securityResult = await assessAndSecureChatRequest(
 *   message,
 *   { userId, requestId, ip, conversationId },
 *   {
 *     maxInputLength: 10000,       // Longer max
 *     abuseScoreThreshold: 85,     // Higher threshold
 *     enableDetailedLogging: false,// Fewer logs
 *   }
 * );
 *
 * ========================================
 */
