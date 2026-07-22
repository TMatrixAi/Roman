import { eq } from "drizzle-orm";
import { db, paymentsAccountTable, paymentWebhookEventsTable } from "@workspace/db";
import { logger } from "../../lib/logger";
import { getPaymentsPlanKey, getPaymentsPlanName, getPaymentsPublicBaseUrlFromRequest, isPaymentsV2Enabled } from "./config";
import { createStripeBillingPortalSession, createStripeCheckoutSession, parseStripeWebhookEvent, retrieveStripeSubscription, toDate, verifyStripeWebhookSignature } from "./stripe";
import { finalizeWebhookProcessing, getLatestWebhookEvents, getPaymentsAccessState, markWebhookProcessing, recordCheckoutSession, upsertBillingAccountFromSubscription } from "./entitlementService";

function absoluteUrl(baseUrl: string, path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${baseUrl.replace(/\/$/, "")}${normalizedPath}`;
}

function extractStripeObject<T extends Record<string, unknown>>(event: { data: { object: Record<string, unknown> } }): T {
  return event.data.object as T;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readBoolean(value: unknown): boolean {
  return value === true;
}

export async function buildPaymentsStatus() {
  const state = await getPaymentsAccessState();
  const recentWebhookEvents = await getLatestWebhookEvents(10);
  return {
    featureFlagEnabled: state.featureFlagEnabled,
    configured: state.configured,
    account: state.account,
    entitlements: state.entitlements,
    active: state.active,
    stripe: {
      priceId: process.env.STRIPE_PRICE_ID?.trim() || null,
      webhookSecretConfigured: Boolean(process.env.STRIPE_WEBHOOK_SECRET?.trim()),
      secretKeyConfigured: Boolean(process.env.STRIPE_SECRET_KEY?.trim()),
      planKey: getPaymentsPlanKey(),
      planName: getPaymentsPlanName(),
    },
    recentWebhookEvents,
  };
}

export async function createCheckoutSession(req: { protocol?: string; get(name: string): string | undefined }, body?: { returnPath?: string | null; customerEmail?: string | null }) {
  const state = await getPaymentsAccessState();
  if (!state.featureFlagEnabled || !isPaymentsV2Enabled()) {
    throw new Error("Payments V2 is disabled");
  }

  const baseUrl = getPaymentsPublicBaseUrlFromRequest(req);
  if (!baseUrl) {
    throw new Error("APP_PUBLIC_URL or request host is required to create a Stripe checkout session");
  }

  const successPath = body?.returnPath?.startsWith("/") ? body.returnPath : "/payments?checkout=success";
  const cancelPath = "/payments?checkout=cancel";
  const customerId = state.account?.stripeCustomerId ?? null;

  const session = await createStripeCheckoutSession({
    successUrl: absoluteUrl(baseUrl, successPath),
    cancelUrl: absoluteUrl(baseUrl, cancelPath),
    customerId,
    customerEmail: body?.customerEmail ?? null,
    accountKey: "workspace",
    planKey: getPaymentsPlanKey(),
    planName: getPaymentsPlanName(),
  });

  await recordCheckoutSession({
    stripeCustomerId: session.customer,
    stripeCheckoutSessionId: session.id,
    metadata: { status: session.status, paymentStatus: session.payment_status },
  });

  return session;
}

export async function createBillingPortal(req: { protocol?: string; get(name: string): string | undefined }, body?: { returnPath?: string | null }) {
  const state = await getPaymentsAccessState();
  if (!state.featureFlagEnabled || !isPaymentsV2Enabled()) {
    throw new Error("Payments V2 is disabled");
  }
  if (!state.account?.stripeCustomerId) {
    throw new Error("No Stripe customer is linked to the workspace yet");
  }

  const baseUrl = getPaymentsPublicBaseUrlFromRequest(req);
  if (!baseUrl) {
    throw new Error("APP_PUBLIC_URL or request host is required to create a billing portal session");
  }

  return createStripeBillingPortalSession({
    customerId: state.account.stripeCustomerId,
    returnUrl: absoluteUrl(baseUrl, body?.returnPath?.startsWith("/") ? body.returnPath : "/payments"),
  });
}

export async function handleStripeWebhook(rawBody: Buffer, signatureHeader: string | string[] | undefined) {
  verifyStripeWebhookSignature({ rawBody, signatureHeader });
  const event = parseStripeWebhookEvent(rawBody);

  const existingEvent = await db.select().from(paymentWebhookEventsTable).where(eq(paymentWebhookEventsTable.stripeEventId, event.id)).limit(1);
  if (existingEvent.length > 0 && existingEvent[0].processingStatus === "processed") {
    return { received: true, processed: true, duplicate: true };
  }

  const payload = event.data.object;
  const customerId = readString(payload["customer"]);
  const subscriptionId = readString(payload["subscription"]) ?? readString(payload["id"]);
  const inserted = await markWebhookProcessing(event.id, event as unknown as Record<string, unknown>, event.type, event.livemode, customerId ?? undefined, subscriptionId ?? undefined);
  if (!inserted) {
    return { received: true, processed: true, duplicate: true };
  }

  try {
    if (event.type === "checkout.session.completed") {
      const checkoutSession = extractStripeObject<{ mode?: string; customer?: string; subscription?: string; payment_status?: string }>(event);
      if (checkoutSession.mode === "subscription" && checkoutSession.subscription) {
        const subscription = await retrieveStripeSubscription(checkoutSession.subscription);
        await upsertBillingAccountFromSubscription({
          stripeCustomerId: checkoutSession.customer ?? subscription.customer,
          stripeSubscriptionId: subscription.id,
          stripePriceId: subscription.priceId,
          subscriptionStatus: subscription.status,
          currentPeriodStartAt: toDate(subscription.current_period_start),
          currentPeriodEndAt: toDate(subscription.current_period_end),
          trialEndAt: toDate(subscription.trial_end),
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
          canceledAt: toDate(subscription.canceled_at),
          lastWebhookEventId: event.id,
          metadata: { eventType: event.type, paymentStatus: checkoutSession.payment_status ?? null },
        });
      }
    }

    if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      const subscription = extractStripeObject<{
        id: string;
        customer: string;
        status: string;
        cancel_at_period_end?: boolean;
        current_period_start?: number;
        current_period_end?: number;
        trial_end?: number | null;
        canceled_at?: number | null;
        items?: { data?: Array<{ price?: { id?: string } }> };
        metadata?: Record<string, string>;
      }>(event);
      const priceId = subscription.items?.data?.[0]?.price?.id ?? null;
      await upsertBillingAccountFromSubscription({
        stripeCustomerId: subscription.customer,
        stripeSubscriptionId: subscription.id,
        stripePriceId: priceId,
        subscriptionStatus: subscription.status,
        currentPeriodStartAt: toDate(subscription.current_period_start ?? null),
        currentPeriodEndAt: toDate(subscription.current_period_end ?? null),
        trialEndAt: toDate(subscription.trial_end ?? null),
        cancelAtPeriodEnd: readBoolean(subscription.cancel_at_period_end),
        canceledAt: toDate(subscription.canceled_at ?? null),
        lastWebhookEventId: event.id,
        metadata: subscription.metadata ?? {},
      });
    }

    if (event.type === "invoice.paid" || event.type === "invoice.payment_failed") {
      const invoice = extractStripeObject<{ customer?: string; subscription?: string; status?: string }>(event);
      if (invoice.subscription) {
        const subscription = await retrieveStripeSubscription(invoice.subscription);
        await upsertBillingAccountFromSubscription({
          stripeCustomerId: invoice.customer ?? subscription.customer,
          stripeSubscriptionId: subscription.id,
          stripePriceId: subscription.priceId,
          subscriptionStatus: subscription.status,
          currentPeriodStartAt: toDate(subscription.current_period_start),
          currentPeriodEndAt: toDate(subscription.current_period_end),
          trialEndAt: toDate(subscription.trial_end),
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
          canceledAt: toDate(subscription.canceled_at),
          lastWebhookEventId: event.id,
          metadata: { eventType: event.type, invoiceStatus: invoice.status ?? null },
        });
      }
    }

    await finalizeWebhookProcessing({
      eventId: event.id,
      status: "processed",
      stripeCustomerId: customerId ?? undefined,
      stripeSubscriptionId: subscriptionId ?? undefined,
    });
    return { received: true, processed: true, duplicate: false };
  } catch (error) {
    logger.error({ error, eventId: event.id, eventType: event.type }, "Stripe webhook processing failed");
    await finalizeWebhookProcessing({
      eventId: event.id,
      status: "failed",
      errorMessage: error instanceof Error ? error.message : "Unknown error",
      stripeCustomerId: customerId ?? undefined,
      stripeSubscriptionId: subscriptionId ?? undefined,
    });
    throw error;
  }
}