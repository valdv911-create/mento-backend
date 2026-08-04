import { NextResponse } from 'next/server';
import { prisma } from '../../../../lib/prisma';
import { askGeminiStream, GeminiImageContent, GeminiMessage } from '../../../../services/geminiService';
import {
  getConversationHistoryForAI,
  validateConversationOwnership,
  getOrCreateLatestConversation,
  addMessageToConversation,
  setConversationTitleIfMissing,
} from '@/lib/conversationDb';
import {
  AIRequestGatewayError,
  authenticateAIRequest,
  enforceAIGatewayRateLimit,
  executeAIRequest,
  getClientIp,
  buildAIRequestId,
} from '../../../../lib/aiSecurityGateway';
import { validateImageBuffer } from '../../../../lib/imageValidator';
import logger from '../../../../lib/logger';
import { buildCorsHeaders } from '../../../../lib/securityHeaders';

const CORS_METHODS = 'POST, OPTIONS';

export async function OPTIONS(req: Request) {
  return new NextResponse(null, {
    status: 204,
    headers: { ...buildCorsHeaders(req.headers.get('origin')), 'Access-Control-Allow-Methods': CORS_METHODS },
  });
}

export async function POST(req: Request) {
  try {
    const user = await authenticateAIRequest(req);
    const userId = user.id;
    logger.info('Authenticated chat stream user', { userId });

    const clientIp = getClientIp(req);
    await enforceAIGatewayRateLimit(userId, clientIp);

    let body: { message?: unknown; image?: unknown; conversationId?: unknown; requestId?: unknown } | null = null;
    try {
      body = (await req.json()) as { message?: unknown; image?: unknown; conversationId?: unknown; requestId?: unknown };
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400, headers: { ...buildCorsHeaders(req.headers.get('origin')), 'Access-Control-Allow-Methods': CORS_METHODS } });
    }

    logger.info('Chat stream request payload received', { body: body ? { messageLength: String(body?.message || '').length, hasImage: Boolean(body?.image), conversationId: body?.conversationId ?? null } : null });

    const message = typeof body?.message === 'string' ? body.message.trim() : '';
    const image = body?.image;
    const requestId = typeof body?.requestId === 'string' && body.requestId.trim()
      ? body.requestId.trim()
      : buildAIRequestId('chat-stream');

    if (!message && !image) {
      return NextResponse.json({ error: 'Invalid input: message or image is required' }, { status: 400, headers: { ...buildCorsHeaders(req.headers.get('origin')), 'Access-Control-Allow-Methods': CORS_METHODS } });
    }
    if (image !== undefined && image !== null && typeof image !== 'object') {
      return NextResponse.json({ error: 'Invalid input: image payload is malformed' }, { status: 400, headers: { ...buildCorsHeaders(req.headers.get('origin')), 'Access-Control-Allow-Methods': CORS_METHODS } });
    }

    const imagePayload = image && typeof image === 'object'
      ? image as { data?: unknown; mimeType?: unknown; uri?: unknown }
      : null;

    let conversationId = typeof body?.conversationId === 'string' ? body.conversationId : undefined;
    if (conversationId && !(await validateConversationOwnership(conversationId, userId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: { ...buildCorsHeaders(req.headers.get('origin')), 'Access-Control-Allow-Methods': CORS_METHODS } });
    }

    if (!conversationId) {
      const conv = await getOrCreateLatestConversation(userId);
      conversationId = conv.id;
    }
    logger.info('Chat stream conversation selected', { userId, conversationId });

    const historyForAI = await getConversationHistoryForAI(conversationId);
    const userText = message || (imagePayload ? 'Please analyze the attached image and explain it clearly as a tutor.' : '');

    // Validate image if provided
    let validatedImage: { data: string; mimeType: string; uri?: string | null } | null = null;
    if (imagePayload) {
      if (typeof imagePayload.data !== 'string' || typeof imagePayload.mimeType !== 'string') {
        return NextResponse.json({ error: 'Invalid image: data and mimeType are required' }, { status: 400, headers: { ...buildCorsHeaders(req.headers.get('origin')), 'Access-Control-Allow-Methods': CORS_METHODS } });
      }
      try {
        const imageBuffer = Buffer.from(imagePayload.data, 'base64');
        const validated = validateImageBuffer(imageBuffer, imagePayload.mimeType);
        validatedImage = {
          data: imagePayload.data,
          mimeType: validated.mimeType,
          uri: typeof imagePayload.uri === 'string' ? imagePayload.uri : undefined,
        };
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : 'Image validation failed';
        return NextResponse.json({ error: `Invalid image: ${errMsg}` }, { status: 400, headers: { ...buildCorsHeaders(req.headers.get('origin')), 'Access-Control-Allow-Methods': CORS_METHODS } });
      }
    }

    const stream = new ReadableStream({
      async start(controller) {
        let assistantMessageId: string | null = null;
        let assistantText = '';

        try {
          const savedUserText = message || (validatedImage ? 'Image attached' : '');
          if (message) {
            await setConversationTitleIfMissing(conversationId, message);
          }
          await addMessageToConversation(conversationId, 'user', savedUserText, userId, { requestId });

          const assistantPlaceholder = await addMessageToConversation(conversationId, 'assistant', '', userId, { requestId });
          if (assistantPlaceholder?.id) {
            assistantMessageId = assistantPlaceholder.id;
          }
        } catch (dbErr) {
          logger.error('Failed to save user message before streaming', { error: String(dbErr) });
        }

        try {
          const { result: aiResponse } = await executeAIRequest({
            user,
            clientIp,
            feature: 'chat',
            provider: 'Gemini',
            amount: 1,
            requestId,
            metadata: { conversationId },
            pending: true,
            securityInput: userText,
            securityContext: { conversationId, hasImage: Boolean(validatedImage) },
            callback: async ({ billingDecision, sanitizedInput }) => {
              const sanitizedText = sanitizedInput ?? userText;
              const userEntry: GeminiMessage = { role: 'user', parts: [{ text: sanitizedText }] };
              const contents: Array<GeminiMessage | GeminiImageContent> = [...historyForAI, userEntry];
              if (validatedImage) {
                contents.push({
                  type: 'image',
                  data: validatedImage.data,
                  mime_type: validatedImage.mimeType,
                  uri: validatedImage.uri ?? undefined,
                });
              }

              const modelToUse = billingDecision.modelUsed ?? undefined;
              assistantText = '';
              await askGeminiStream(contents, async (token: string) => {
                assistantText += token;
                const payload = JSON.stringify({ type: 'token', token });
                controller.enqueue(new TextEncoder().encode(`data: ${payload}\n\n`));

                if (assistantMessageId) {
                  await prisma.conversationMessage.update({
                    where: { id: assistantMessageId },
                    data: {
                      content: assistantText,
                      text: assistantText,
                    },
                  });
                }
              }, modelToUse);

              return assistantText;
            },
          });

          try {
            const finalAssistantText = typeof aiResponse === 'string' ? aiResponse : String(aiResponse ?? '');
            if (assistantMessageId) {
              await prisma.conversationMessage.update({
                where: { id: assistantMessageId },
                data: {
                  content: finalAssistantText,
                  text: finalAssistantText,
                },
              });
            }
          } catch (dbErr) {
            logger.error('Failed to finalize assistant message after streaming', { error: String(dbErr) });
          }

          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
          controller.close();
        } catch (err: unknown) {
          const appError = (() => {
            const status = typeof err === 'object' && err !== null && 'status' in err && typeof (err as { status?: unknown }).status === 'number' ? (err as { status?: number }).status : undefined;
            return {
              message: 'We couldn’t finish that reply right now. Please try again shortly.',
              status,
            };
          })();
          logger.error('Chat stream error', { error: { message: appError.message, status: appError.status } });
          const errPayload = JSON.stringify({ type: 'error', message: appError.message });
          controller.enqueue(new TextEncoder().encode(`data: ${errPayload}\n\n`));
          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: {
        ...buildCorsHeaders(req.headers.get('origin')),
        'Access-Control-Allow-Methods': CORS_METHODS,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (err: unknown) {
    if (err instanceof AIRequestGatewayError) {
      return NextResponse.json(err.body, { status: err.status, headers: { ...buildCorsHeaders(req.headers.get('origin')), 'Access-Control-Allow-Methods': CORS_METHODS } });
    }

    const message = err instanceof Error ? err.message : 'Streaming is temporarily unavailable. Please try again shortly.';
    const status = typeof err === 'object' && err !== null && 'status' in err && typeof (err as { status?: unknown }).status === 'number' ? (err as { status?: number }).status : 503;
    logger.error('Chat stream route error', { error: { message, status } });
    return NextResponse.json({ error: message, code: 'stream_unavailable' }, { status, headers: { ...buildCorsHeaders(req.headers.get('origin')), 'Access-Control-Allow-Methods': CORS_METHODS } });
  }
}
