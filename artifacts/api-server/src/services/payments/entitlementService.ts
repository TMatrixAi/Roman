import { and, desc, eq } from "drizzle-orm";
import { db, paymentsAccountTable, paymentWebhookEventsTable, type PaymentsAccountRow, type PaymentWebhookEventRow } from "@workspace/db";
import { isPaymentsV2Enabled, PAYMENTS_ACCOUNT_KEY, getPaymentsPlanKey, getPaymentsPlanName, getStripeElitePriceId } from "./config";

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
  // ── Elite-only ──────────────────────────────────────────────────────────
  "fullModelMonitoring",
  "confidenceCalibration",
  "recommendationPerformance",
  "historicalModelTrends",
  "monteCarlo",
  "eliteBadge",
  "advancedExplanation",
  "confidenceHistory",
] as const;

export type PaymentEntitlementKey = (typeof PAYMENT_ENTITLEMENT_KEYS)[number];
export type PaymentEntitlements = Record<PaymentEntitlementKey, boolean>;
export type SubscriptionTier = "free" | "pro" | "elite";

export interface PaymentAccessState {
  featureFlagEnabled: boolean;
  configured: boolean;
  account: PaymentsAccountRow | null;
  entitlements: PaymentEntitlements;
  active: boolean;
  tier: SubscriptionTier;
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
    // Elite-only — all false for free
    fullModelMonitoring: false,
    confidenceCalibration: false,
    recommendationPerformance: false,
    historicalModelTrends: false,
    monteCarlo: false,
    eliteBadge: false,
    advancedExplanation: false,
    confidenceHistory: false,
  };
}

/** Pro ($19.99) — "Who wins and why?" — unlimited predictions + core analytics */
function proEntitlements(): PaymentEntitlements {
  return {
    predictionHistory: true,
    walkForward: false,        // admin-only
    shadowReplay: false,       // admin-only
    optimizer: false,          // admin-only
    competitiveBalance: true,  // upset risk, model agreement
    evidenceReliability: true, // data quality, evidence modules
    developerAnalytics: false, // admin-only
    eliteRecommendations: true, // gates POST /predictions — Pro can make unlimited predictions
    alerts: true,
    teamWorkspace: false,      // not yet implemented
    // Elite-only — locked for Pro
    fullModelMonitoring: false,
    confidenceCalibration: false,
    recommendationPerformance: false,
    historicalModelTrends: false,
    monteCarlo: false,
    eliteBadge: false,
    advancedExplanation: false,
    confidenceHistory: false,
  };
}

/** Elite ($49.99) — "How trustworthy is the AI?" — everything in Pro plus deep analytics */
function eliteEntitlements(): PaymentEntitlements {
  return {
    ...proEntitlements(),
    // Elite deep analytics
    fullModelMonitoring: true,
    confidenceCalibration: true,
    recommendationPerformance: true,
    historicalModelTrends: true,
    monteCarlo: true,
    eliteBadge: true,
    advancedExplanation: true,
    confidenceHistory: true,
  };
}

/** Derive tier from the stored planKey. Existing rows without "elite" planKey default to "pro". */
function tierFromPlanKey(planKey: string | null | undefined): "pro" | "elite" {
  return planKey === "elite" ? "elite" : "pro";
}

/** Derive tier by comparing a Stripe price ID to the configured Elite price ID. */
function resolveTierFromPriceId(stripePriceId: string | null | undefined): "pro" | "elite" {
  const elitePriceId = getStripeElitePriceId();
  if (elitePriceId && stripePriceId && stripePriceId === elitePriceId) return "elite";
  return "pro";
}

/**
 * Compute entitlements purely from subscription status + tier.
 * No snapshot/DB input — always deterministic.
 * The stored `entitlementSnapshot` column is an audit record, NOT an input here.
 */
function entitlementsForSubscriptionStatus(
  status: string | null | undefined,
  tier: "pro" | "elite",
): PaymentEntitlements {
  if (status === "active" || status === "trialing") {
    return tier === "elite" ? eliteEntitlements() : proEntitlements();
  }
  return getDefaultEntitlements();
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
      entitlements: eliteEntitlements(), // dev mode: all unlocked
      active: true,
      tier: "elite",
    };
  }

  const account = await ensureBillingAccount();
  const tier = tierFromPlanKey(account.planKey);
  // Always compute fresh from tier + status — snapshot is audit only, not a gate input
  const entitlements = entitlementsForSubscriptionStatus(account.subscriptionStatus, tier);
  const active = isActiveSubscription(account);
  return {
    featureFlagEnabled: true,
    configured: true,
    account,
    entitlements,
    active,
    tier: active ? tier : "free",
  };
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
  const tier = resolveTierFromPriceId(input.stripePriceId);
  const planKey = tier;
  const planName = tier === "elite" ? "Elite" : "Pro";

  const [existing] = await db.select().from(paymentsAccountTable).where(eq(paymentsAccountTable.accountKey, PAYMENTS_ACCOUNT_KEY)).limit(1);
  if (existing) {
    // Always recompute from tier + status — never carry forward stored booleans as overrides
    const updatedEntitlements = entitlementsForSubscriptionStatus(input.subscriptionStatus, tier);

    const [updated] = await db
      .update(paymentsAccountTable)
      .set({
        stripeCustomerId: input.stripeCustomerId,
        stripeSubscriptionId: input.stripeSubscriptionId,
        stripePriceId: input.stripePriceId,
        subscriptionStatus: input.subscriptionStatus,
        planKey,
        planName,
        currentPeriodStartAt: input.currentPeriodStartAt,
        currentPeriodEndAt: input.currentPeriodEndAt,
        trialEndAt: input.trialEndAt,
        canceledAt: input.canceledAt,
        cancelAtPeriodEnd: input.cancelAtPeriodEnd,
        lastWebhookEventId: input.lastWebhookEventId,
        entitlementSnapshot: updatedEntitlements,
        metadata: { ...(existing.metadata ?? {}), ...(input.metadata ?? {}) },
        updatedAt: new Date(),
        accessGrantedAt: isActiveSubscription({ ...existing, subscriptionStatus: input.subscriptionStatus })
          ? (existing.accessGrantedAt ?? new Date())
          : existing.subscriptionStatus === input.subscriptionStatus
          ? existing.accessGrantedAt
          : existing.accessGrantedAt,
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
      planKey,
      planName,
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
      entitlementSnapshot: entitlementsForSubscriptionStatus(input.subscriptionStatus, tier),
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

// ── Convenience helpers ────────────────────────────────────────────────────────
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
// Elite-only
export async function canUseFullModelMonitoring(): Promise<boolean> { return (await getPaymentsEntitlements()).fullModelMonitoring; }
export async function canUseConfidenceCalibration(): Promise<boolean> { return (await getPaymentsEntitlements()).confidenceCalibration; }
export async function canUseRecommendationPerformance(): Promise<boolean> { return (await getPaymentsEntitlements()).recommendationPerformance; }
export async function canUseHistoricalModelTrends(): Promise<boolean> { return (await getPaymentsEntitlements()).historicalModelTrends; }
export async function canUseMonteCarlo(): Promise<boolean> { return (await getPaymentsEntitlements()).monteCarlo; }
export async function canUseEliteBadge(): Promise<boolean> { return (await getPaymentsEntitlements()).eliteBadge; }
export async function canUseAdvancedExplanation(): Promise<boolean> { return (await getPaymentsEntitlements()).advancedExplanation; }
export async function canUseConfidenceHistory(): Promise<boolean> { return (await getPaymentsEntitlements()).confidenceHistory; }
