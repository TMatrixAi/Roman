import { and, desc, eq } from "drizzle-orm";
import { db, paymentsAccountTable, paymentWebhookEventsTable, type PaymentsAccountRow, type PaymentWebhookEventRow } from "@workspace/db";
import { isPaymentsV2Enabled, PAYMENTS_ACCOUNT_KEY, getPaymentsPlanKey, getPaymentsPlanName } from "./config";

export const PAYMENT_ENTITLEMENT_KEYS = [
  "predictionHistory",
  "walkForward",
  "shadowReplay",
  "optimizer",
  "competitiveBalance",
  "evidenceReliability",
  "developerAnalytics",
  "eliteRecommendations",
  "alerts",
  "teamWorkspace",
] as const;

export type PaymentEntitlementKey = (typeof PAYMENT_ENTITLEMENT_KEYS)[number];
export type PaymentEntitlements = Record<PaymentEntitlementKey, boolean>;

export interface PaymentAccessState {
  featureFlagEnabled: boolean;
  configured: boolean;
  account: PaymentsAccountRow | null;
  entitlements: PaymentEntitlements;
  active: boolean;
}

export function getDefaultEntitlements(): PaymentEntitlements {
  return {
    predictionHistory: false,
    walkForward: false,
    shadowReplay: false,
    optimizer: false,
    competitiveBalance: false,
    evidenceReliability: false,
    developerAnalytics: false,
    eliteRecommendations: false,
    alerts: false,
    teamWorkspace: false,
  };
}

function paidEntitlements(): PaymentEntitlements {
  return {
    predictionHistory: true,
    walkForward: true,
    shadowReplay: true,
    optimizer: true,
    competitiveBalance: true,
    evidenceReliability: true,
    developerAnalytics: true,
    eliteRecommendations: true,
    alerts: true,
    teamWorkspace: true,
  };
}

function entitlementsForSubscriptionStatus(status: string | null | undefined, snapshot: Record<string, boolean> | null | undefined): PaymentEntitlements {
  if (status === "active" || status === "trialing") {
    const next = paidEntitlements();
    if (!snapshot) return next;
    for (const key of PAYMENT_ENTITLEMENT_KEYS) {
      if (snapshot[key] === false) next[key] = false;
    }
    return next;
  }
  return getDefaultEntitlements();
}

function readEntitlements(account: PaymentsAccountRow | null): PaymentEntitlements {
  if (!account) return getDefaultEntitlements();
  const snapshot = account.entitlementSnapshot ?? {};
  const next = getDefaultEntitlements();
  for (const key of PAYMENT_ENTITLEMENT_KEYS) {
    next[key] = snapshot[key] === true;
  }
  return next;
}

function isActiveSubscription(account: PaymentsAccountRow | null): boolean {
  if (!account) return false;
  return account.subscriptionStatus === "active" || account.subscriptionStatus === "trialing";
}

async function ensureBillingAccount(): Promise<PaymentsAccountRow> {
  const [existing] = await db.select().from(paymentsAccountTable).where(eq(paymentsAccountTable.accountKey, PAYMENTS_ACCOUNT_KEY)).limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(paymentsAccountTable)
    .values({
      accountKey: PAYMENTS_ACCOUNT_KEY,
      displayName: "Workspace Subscription",
      planKey: getPaymentsPlanKey(),
      planName: getPaymentsPlanName(),
      entitlementSnapshot: getDefaultEntitlements(),
    })
    .returning();
  return created;
}

export async function getBillingAccount(): Promise<PaymentsAccountRow | null> {
  const [existing] = await db.select().from(paymentsAccountTable).where(eq(paymentsAccountTable.accountKey, PAYMENTS_ACCOUNT_KEY)).limit(1);
  return existing ?? null;
}

export async function getLatestWebhookEvents(limit = 10): Promise<PaymentWebhookEventRow[]> {
  return db.select().from(paymentWebhookEventsTable).orderBy(desc(paymentWebhookEventsTable.receivedAt)).limit(limit);
}

export async function getPaymentsAccessState(): Promise<PaymentAccessState> {
  if (!isPaymentsV2Enabled()) {
    return {
      featureFlagEnabled: false,
      configured: false,
      account: null,
      entitlements: paidEntitlements(),
      active: true,
    };
  }

  const account = await ensureBillingAccount();
  const entitlements = entitlementsForSubscriptionStatus(account.subscriptionStatus, account.entitlementSnapshot);
  return {
    featureFlagEnabled: true,
    configured: true,
    account,
    entitlements,
    active: isActiveSubscription(account),
  };
}

function mergeEntitlementsFromSnapshot(snapshot: Record<string, boolean> | null | undefined): PaymentEntitlements {
  const next = paidEntitlements();
  if (!snapshot) return next;
  for (const key of PAYMENT_ENTITLEMENT_KEYS) {
    if (snapshot[key] === false) next[key] = false;
  }
  return next;
}

export async function upsertBillingAccountFromSubscription(input: {
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  stripePriceId: string | null;
  subscriptionStatus: string;
  currentPeriodStartAt: Date | null;
  currentPeriodEndAt: Date | null;
  trialEndAt: Date | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: Date | null;
  lastWebhookEventId: string;
  metadata?: Record<string, unknown>;
}): Promise<PaymentsAccountRow> {
  const [existing] = await db.select().from(paymentsAccountTable).where(eq(paymentsAccountTable.accountKey, PAYMENTS_ACCOUNT_KEY)).limit(1);
  if (existing) {
    const updatedEntitlements = entitlementsForSubscriptionStatus(input.subscriptionStatus, existing.entitlementSnapshot);

    const [updated] = await db
      .update(paymentsAccountTable)
      .set({
        stripeCustomerId: input.stripeCustomerId,
        stripeSubscriptionId: input.stripeSubscriptionId,
        stripePriceId: input.stripePriceId,
        subscriptionStatus: input.subscriptionStatus,
        currentPeriodStartAt: input.currentPeriodStartAt,
        currentPeriodEndAt: input.currentPeriodEndAt,
        trialEndAt: input.trialEndAt,
        canceledAt: input.canceledAt,
        cancelAtPeriodEnd: input.cancelAtPeriodEnd,
        lastWebhookEventId: input.lastWebhookEventId,
        entitlementSnapshot: updatedEntitlements,
        metadata: { ...(existing.metadata ?? {}), ...(input.metadata ?? {}) },
        updatedAt: new Date(),
        accessGrantedAt: isActiveSubscription({ ...existing, subscriptionStatus: input.subscriptionStatus }) ? (existing.accessGrantedAt ?? new Date()) : existing.subscriptionStatus === input.subscriptionStatus ? existing.accessGrantedAt : existing.accessGrantedAt,
      })
      .where(eq(paymentsAccountTable.accountKey, PAYMENTS_ACCOUNT_KEY))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(paymentsAccountTable)
    .values({
      accountKey: PAYMENTS_ACCOUNT_KEY,
      displayName: "Workspace Subscription",
      planKey: getPaymentsPlanKey(),
      planName: getPaymentsPlanName(),
      stripeCustomerId: input.stripeCustomerId,
      stripeSubscriptionId: input.stripeSubscriptionId,
      stripePriceId: input.stripePriceId,
      subscriptionStatus: input.subscriptionStatus,
      currentPeriodStartAt: input.currentPeriodStartAt,
      currentPeriodEndAt: input.currentPeriodEndAt,
      trialEndAt: input.trialEndAt,
      canceledAt: input.canceledAt,
      cancelAtPeriodEnd: input.cancelAtPeriodEnd,
      lastWebhookEventId: input.lastWebhookEventId,
      entitlementSnapshot: entitlementsForSubscriptionStatus(input.subscriptionStatus, null),
      metadata: input.metadata ?? {},
      accessGrantedAt: isActiveSubscription({ accountKey: PAYMENTS_ACCOUNT_KEY, subscriptionStatus: input.subscriptionStatus } as PaymentsAccountRow) ? new Date() : null,
    })
    .returning();
  return created;
}

export async function recordCheckoutSession(input: {
  stripeCustomerId?: string | null;
  stripeCheckoutSessionId: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const account = await ensureBillingAccount();
  await db
    .update(paymentsAccountTable)
    .set({
      stripeCustomerId: input.stripeCustomerId ?? account.stripeCustomerId,
      lastCheckoutSessionId: input.stripeCheckoutSessionId,
      metadata: { ...(account.metadata ?? {}), ...(input.metadata ?? {}) },
      updatedAt: new Date(),
    })
    .where(eq(paymentsAccountTable.accountKey, PAYMENTS_ACCOUNT_KEY));
}

export async function markWebhookProcessing(eventId: string, payload: Record<string, unknown>, eventType: string, livemode: boolean, customerId?: string, subscriptionId?: string): Promise<boolean> {
  const [inserted] = await db
    .insert(paymentWebhookEventsTable)
    .values({
      stripeEventId: eventId,
      eventType,
      livemode,
      processingStatus: "processing",
      stripeCustomerId: customerId ?? null,
      stripeSubscriptionId: subscriptionId ?? null,
      payload,
    })
    .onConflictDoNothing({ target: paymentWebhookEventsTable.stripeEventId })
    .returning({ id: paymentWebhookEventsTable.id });

  return Boolean(inserted);
}

export async function finalizeWebhookProcessing(input: {
  eventId: string;
  status: "processed" | "failed";
  errorMessage?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
}): Promise<void> {
  await db
    .update(paymentWebhookEventsTable)
    .set({
      processingStatus: input.status,
      errorMessage: input.errorMessage ?? null,
      stripeCustomerId: input.stripeCustomerId ?? undefined,
      stripeSubscriptionId: input.stripeSubscriptionId ?? undefined,
      processedAt: new Date(),
    })
    .where(eq(paymentWebhookEventsTable.stripeEventId, input.eventId));
}

export async function getPaymentsEntitlements(): Promise<PaymentEntitlements> {
  const state = await getPaymentsAccessState();
  return state.entitlements;
}

export async function canUsePredictionHistory(): Promise<boolean> { return (await getPaymentsEntitlements()).predictionHistory; }
export async function canUseWalkForward(): Promise<boolean> { return (await getPaymentsEntitlements()).walkForward; }
export async function canUseShadowReplay(): Promise<boolean> { return (await getPaymentsEntitlements()).shadowReplay; }
export async function canUseOptimizer(): Promise<boolean> { return (await getPaymentsEntitlements()).optimizer; }
export async function canUseCompetitiveBalance(): Promise<boolean> { return (await getPaymentsEntitlements()).competitiveBalance; }
export async function canUseEvidenceReliability(): Promise<boolean> { return (await getPaymentsEntitlements()).evidenceReliability; }
export async function canUseDeveloperAnalytics(): Promise<boolean> { return (await getPaymentsEntitlements()).developerAnalytics; }
export async function canUseEliteRecommendations(): Promise<boolean> { return (await getPaymentsEntitlements()).eliteRecommendations; }
export async function canUseAlerts(): Promise<boolean> { return (await getPaymentsEntitlements()).alerts; }
export async function canUseTeamWorkspace(): Promise<boolean> { return (await getPaymentsEntitlements()).teamWorkspace; }