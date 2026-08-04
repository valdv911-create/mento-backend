import { NextResponse } from 'next/server';
import { getUserFromRequest } from '../../lib/auth';
import { listPayments, startPayment, getPayment, getLedgerSummary, finalizePayment, verifyWebhookSignature, type PaymentProvider, type PaymentStatus } from '../../../services/paymentService';
import { getPaymentWebhookAuthSecret } from '../../../lib/env';

function getWebhookAuthSecret() {
  return getPaymentWebhookAuthSecret();
}

async function requireAuthenticatedUser(req: Request) {
  return await getUserFromRequest(req);
}

async function requirePaymentWebhookSecret(req: Request) {
  const expectedSecret = getWebhookAuthSecret();
  const providedSecret = req.headers.get('x-payment-webhook-secret')?.trim() || req.headers.get('x-webhook-secret')?.trim() || '';
  return Boolean(expectedSecret && providedSecret && providedSecret === expectedSecret);
}

export async function GET(req: Request) {
  const user = await requireAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const paymentId = url.searchParams.get('paymentId');
  const ledger = url.searchParams.get('ledger') === 'true';

  if (paymentId) {
    const payment = await getPayment(user.id, paymentId);
    return NextResponse.json(payment);
  }

  if (ledger) {
    return NextResponse.json(await getLedgerSummary(user.id));
  }

  return NextResponse.json(await listPayments(user.id));
}

export async function POST(req: Request) {
  const user = await requireAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const normalized = {
      userId: user.id,
      provider: String(body?.provider || 'STRIPE').toUpperCase() as PaymentProvider,
      type: String(body?.type || 'SUBSCRIPTION').toUpperCase() as 'SUBSCRIPTION' | 'TOP_UP',
      amountUsd: Number(body?.amountUsd ?? 15),
      currency: String(body?.currency || 'USD'),
      description: body?.description ? String(body.description) : undefined,
      idempotencyKey: body?.idempotencyKey ? String(body.idempotencyKey) : undefined,
      metadata: body?.metadata && typeof body.metadata === 'object' ? body.metadata : {},
      providerCustomerId: body?.providerCustomerId ? String(body.providerCustomerId) : undefined,
      providerSubscriptionId: body?.providerSubscriptionId ? String(body.providerSubscriptionId) : undefined,
      providerTransactionId: body?.providerTransactionId ? String(body.providerTransactionId) : undefined,
    };

    const payment = await startPayment(normalized);
    return NextResponse.json(payment);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to create payment' }, { status: 400 });
  }
}

export async function PUT(req: Request) {
  const user = await requireAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const payment = await finalizePayment({
      transactionId: String(body?.transactionId || ''),
      provider: String(body?.provider || 'STRIPE').toUpperCase() as PaymentProvider,
      status: String(body?.status || 'SUCCEEDED').toUpperCase() as PaymentStatus,
      providerTransactionId: body?.providerTransactionId ? String(body.providerTransactionId) : undefined,
      providerSubscriptionId: body?.providerSubscriptionId ? String(body.providerSubscriptionId) : undefined,
      providerPayload: body?.providerPayload && typeof body.providerPayload === 'object' ? body.providerPayload : undefined,
      failureReason: body?.failureReason ? String(body.failureReason) : undefined,
      idempotencyKey: body?.idempotencyKey ? String(body.idempotencyKey) : undefined,
    });

    return NextResponse.json(payment);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to finalize payment' }, { status: 400 });
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await getUserFromRequest(req);
    const isWebhook = await requirePaymentWebhookSecret(req);
    if (!user && !isWebhook) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const provider = String(body?.provider || 'STRIPE').toUpperCase() as PaymentProvider;
    const signature = String(body?.signature || '');
    const ok = await verifyWebhookSignature({ payload: JSON.stringify(body), signature, provider });

    if (!ok) {
      return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 401 });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 401 });
  }
}
