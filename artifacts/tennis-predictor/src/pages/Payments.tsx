import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  AlertCircle, BadgeDollarSign, Check, CheckCircle2, CreditCard,
  Crown, ExternalLink, Lock, ShieldCheck, Sparkles, X, Zap,
} from "lucide-react";
import { useGetAdminAuthStatus } from "@/hooks/useGetAdminAuthStatus";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useGetPaymentsStatus, useCreatePaymentsCheckoutSession, useCreateBillingPortalSession, getPaymentsStatusQueryKey } from "@workspace/api-client-react";
import type { SubscriptionTier } from "@workspace/api-client-react";
import { isPaymentsV2Enabled } from "@/lib/paymentsFeatureFlag";

// ── Feature definitions ───────────────────────────────────────────────────────

interface Feature {
  label: string;
  pro: boolean;
  elite: boolean;
  comingSoon?: boolean;
}

const FEATURES: Feature[] = [
  { label: "Unlimited predictions",                    pro: true,  elite: true  },
  { label: "Full prediction history & ledger",         pro: true,  elite: true  },
  { label: "Complete 10-signal match breakdown",       pro: true,  elite: true  },
  { label: "Data quality score per prediction",        pro: true,  elite: true  },
  { label: "Upset risk analysis",                      pro: true,  elite: true  },
  { label: "Model agreement scoring",                  pro: true,  elite: true  },
  { label: "Surface & competition-level accuracy",     pro: true,  elite: true  },
  { label: "Plain-language pick explanation",          pro: true,  elite: true  },
  { label: "Full model monitoring dashboard",          pro: false, elite: true  },
  { label: "Confidence calibration analysis",          pro: false, elite: true  },
  { label: "Recommendation performance tracking",      pro: false, elite: true  },
  { label: "Historical model trends & version history",pro: false, elite: true  },
  { label: "20,000-run Monte Carlo simulation",        pro: false, elite: true  },
  { label: "Elite Tier badge on top predictions",      pro: false, elite: true  },
  { label: "Advanced AI explanation",                  pro: false, elite: true, comingSoon: true },
  { label: "Confidence history per prediction",        pro: false, elite: true, comingSoon: true },
  { label: "Priority support",                        pro: false, elite: true  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

// ── Feature row ───────────────────────────────────────────────────────────────

function FeatureRow({ feature, plan }: { feature: Feature; plan: "pro" | "elite" }) {
  const included = plan === "elite" ? feature.elite : feature.pro;
  return (
    <div className={`flex items-center gap-3 py-2 text-sm ${!included ? "text-muted-foreground/50" : "text-foreground/90"}`}>
      {included ? (
        <Check className="w-4 h-4 text-primary shrink-0" />
      ) : (
        <X className="w-4 h-4 text-muted-foreground/30 shrink-0" />
      )}
      <span className={!included ? "line-through decoration-muted-foreground/20" : ""}>{feature.label}</span>
      {included && feature.comingSoon && (
        <Badge variant="outline" className="text-[9px] font-mono tracking-widest ml-auto shrink-0">SOON</Badge>
      )}
    </div>
  );
}

// ── Plan card ─────────────────────────────────────────────────────────────────

function PlanCard({
  plan,
  price,
  tagline,
  currentTier,
  isPending,
  onSubscribe,
  onPortal,
}: {
  plan: "pro" | "elite";
  price: string;
  tagline: string;
  currentTier: SubscriptionTier;
  isPending: boolean;
  onSubscribe: (plan: "pro" | "elite") => void;
  onPortal: () => void;
}) {
  const isElite = plan === "elite";
  const isCurrent = currentTier === plan;
  const isDowngrade = currentTier === "elite" && plan === "pro";
  const isUpgrade = currentTier === "pro" && plan === "elite";
  const isFree = currentTier === "free";

  return (
    <Card className={`relative flex flex-col overflow-hidden transition-all duration-300 ${
      isElite
        ? "border-primary/40 shadow-lg shadow-primary/10 bg-gradient-to-b from-primary/5 to-background"
        : "border-border/60"
    } ${isCurrent ? "ring-2 ring-primary/40" : ""}`}>
      {isElite && (
        <div className="absolute top-0 inset-x-0 h-0.5 bg-gradient-to-r from-transparent via-primary to-transparent" />
      )}
      {isCurrent && (
        <div className="absolute top-3 right-3">
          <Badge variant="success" className="font-mono text-[9px] tracking-widest gap-1">
            <CheckCircle2 className="w-2.5 h-2.5" /> CURRENT
          </Badge>
        </div>
      )}

      <CardHeader className="pb-4 pt-6 px-6">
        <div className="flex items-center gap-2 mb-1">
          {isElite ? (
            <Crown className="w-5 h-5 text-primary" />
          ) : (
            <Zap className="w-5 h-5 text-primary" />
          )}
          <CardTitle className="text-2xl font-display font-bold">
            {isElite ? "Elite" : "Pro"}
          </CardTitle>
        </div>
        <div className="flex items-baseline gap-1 mt-2">
          <span className="text-4xl font-display font-bold tracking-tight">{price}</span>
          <span className="text-sm text-muted-foreground font-mono">/mo</span>
        </div>
        <CardDescription className="mt-2 text-sm leading-relaxed">{tagline}</CardDescription>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col gap-6 px-6 pb-6">
        <div className="space-y-1 divide-y divide-border/30">
          {FEATURES.map((f) => (
            <FeatureRow key={f.label} feature={f} plan={plan} />
          ))}
        </div>

        <div className="mt-auto pt-2">
          {isFree && (
            <Button
              className="w-full font-mono"
              variant={isElite ? "default" : "outline"}
              onClick={() => onSubscribe(plan)}
              disabled={isPending}
            >
              <CreditCard className="w-4 h-4 mr-2" />
              Subscribe to {isElite ? "Elite" : "Pro"}
            </Button>
          )}
          {isCurrent && !isDowngrade && (
            <Button className="w-full font-mono" variant="outline" onClick={onPortal} disabled={isPending}>
              <ExternalLink className="w-4 h-4 mr-2" />
              Manage Billing
            </Button>
          )}
          {isUpgrade && (
            <Button className="w-full font-mono" variant="default" onClick={() => onSubscribe("elite")} disabled={isPending}>
              <Crown className="w-4 h-4 mr-2" />
              Upgrade to Elite
            </Button>
          )}
          {isDowngrade && (
            <Button className="w-full font-mono" variant="outline" onClick={onPortal} disabled={isPending}>
              <ExternalLink className="w-4 h-4 mr-2" />
              Manage Plan
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PaymentsPage() {
  const paymentsEnabled = isPaymentsV2Enabled();
  const { data, isLoading, refetch } = useGetPaymentsStatus({ query: { queryKey: getPaymentsStatusQueryKey(), enabled: paymentsEnabled } });
  const createCheckout = useCreatePaymentsCheckoutSession();
  const createPortal = useCreateBillingPortalSession();
  const [location, setLocation] = useLocation();
  const { data: adminAuth } = useGetAdminAuthStatus();
  const isAdmin = adminAuth?.authenticated === true;

  const view = useMemo<"pricing" | "billing" | "admin">(() => {
    if (location.startsWith("/payments/billing")) return "billing";
    // Only admins may view the admin panel — bounce anyone else back to pricing
    if (location.startsWith("/payments/admin") && isAdmin) return "admin";
    return "pricing";
  }, [location, isAdmin]);

  const currentTier: SubscriptionTier = data?.tier ?? "free";

  async function startCheckout(plan: "pro" | "elite") {
    const result = await createCheckout.mutateAsync({ data: { returnPath: "/payments", plan } });
    if (result.url) window.location.assign(result.url);
  }

  async function openPortal() {
    const result = await createPortal.mutateAsync({ data: { returnPath: "/payments" } });
    window.location.assign(result.url);
  }

  if (!paymentsEnabled) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex items-center gap-3 border-b border-border/50 pb-4">
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
            <CreditCard className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-display font-bold tracking-tight">Payments</h1>
            <p className="text-muted-foreground">Payments V2 is currently disabled.</p>
          </div>
        </div>
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            The payments module is present but hidden behind <span className="font-mono">VITE_PAYMENTS_V2_ENABLED=false</span>.
          </CardContent>
        </Card>
      </div>
    );
  }

  const isPending = createCheckout.isPending || createPortal.isPending;

  return (
    <div className="mx-auto max-w-6xl space-y-8 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col gap-3 border-b border-border/50 pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-[0.25em] text-muted-foreground mb-1">
            <ShieldCheck className="h-4 w-4" />
            Subscription
          </div>
          <h1 className="text-3xl font-display font-bold tracking-tight">Plans & Billing</h1>
          <p className="max-w-2xl text-muted-foreground mt-1">
            Choose the plan that matches how you use Tennis Matrix AI.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant={view === "pricing" ? "default" : "outline"} size="sm" onClick={() => setLocation("/payments")} className="font-mono text-xs gap-1.5">
            <BadgeDollarSign className="h-3.5 w-3.5" /> Plans
          </Button>
          <Button variant={view === "billing" ? "default" : "outline"} size="sm" onClick={() => setLocation("/payments/billing")} className="font-mono text-xs gap-1.5">
            <CreditCard className="h-3.5 w-3.5" /> Billing
          </Button>
          {/* Admin tab — only visible to authenticated admins */}
          {isAdmin && (
            <Button variant={view === "admin" ? "default" : "outline"} size="sm" onClick={() => setLocation("/payments/admin")} className="font-mono text-xs gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5" /> Admin
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isLoading} className="font-mono text-xs gap-1.5">
            <Sparkles className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Current plan banner */}
      {!isLoading && data?.active && (
        <div className="flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm">
          <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
          <span className="font-medium">
            You are on the <strong className="text-primary">{currentTier === "elite" ? "Elite" : "Pro"}</strong> plan.
            {data.account?.currentPeriodEndAt && (
              <span className="text-muted-foreground font-normal ml-1">
                Renews {new Date(data.account.currentPeriodEndAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}.
              </span>
            )}
          </span>
        </div>
      )}

      {/* Pricing view */}
      {view === "pricing" && (
        <>
          {isLoading ? (
            <div className="grid gap-6 md:grid-cols-2">
              <Skeleton className="h-[720px] rounded-xl" />
              <Skeleton className="h-[720px] rounded-xl" />
            </div>
          ) : (
            <div className="grid gap-6 md:grid-cols-2 items-start">
              <PlanCard
                plan="pro"
                price="$19.99"
                tagline="Unlimited predictions with full match breakdowns, model signals, and performance insights. Answers: who wins and why?"
                currentTier={currentTier}
                isPending={isPending}
                onSubscribe={startCheckout}
                onPortal={openPortal}
              />
              <PlanCard
                plan="elite"
                price="$49.99"
                tagline="Everything in Pro plus deep model analytics — calibration, monitoring, and confidence tracking. Answers: how trustworthy is the AI?"
                currentTier={currentTier}
                isPending={isPending}
                onSubscribe={startCheckout}
                onPortal={openPortal}
              />
            </div>
          )}

          {/* Webhook-confirmation note */}
          {!isLoading && !data?.active && paymentsEnabled && (
            <div className="flex items-start gap-3 rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-amber-500" />
              <p>
                Access is activated after Stripe confirms your payment via webhook — usually within a few seconds of checkout.
                If your plan hasn't activated after a minute, try refreshing.
              </p>
            </div>
          )}

          {/* Locked features teaser for Pro */}
          {!isLoading && currentTier === "pro" && (
            <Card className="border-primary/20 bg-primary/5">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-display flex items-center gap-2">
                  <Lock className="w-4 h-4 text-primary" />
                  Unlock Elite analytics
                </CardTitle>
                <CardDescription>
                  Upgrade to Elite to see how well-calibrated the AI is, track recommendation tier accuracy, and review the full model monitoring dashboard.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="default" className="font-mono" onClick={() => void startCheckout("elite")} disabled={isPending}>
                  <Crown className="w-4 h-4 mr-2" />
                  Upgrade to Elite — $49.99/mo
                </Button>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Billing view */}
      {view === "billing" && (
        <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><CreditCard className="h-5 w-5" /> Account Billing</CardTitle>
              <CardDescription>Customer, subscription, renewal, and billing portal controls.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">Customer: {data?.account?.stripeCustomerId ?? "none"}</Badge>
                <Badge variant="outline">Subscription: {data?.account?.stripeSubscriptionId ?? "none"}</Badge>
                <Badge variant="outline">Status: {data?.account?.subscriptionStatus ?? "inactive"}</Badge>
                {data?.tier && data.tier !== "free" && (
                  <Badge variant="success">Plan: {data.tier === "elite" ? "Elite" : "Pro"}</Badge>
                )}
              </div>
              <div className="rounded-xl border border-dashed p-4 text-muted-foreground">
                <div className="flex items-center gap-2 font-medium text-foreground"><AlertCircle className="h-4 w-4 text-amber-500" /> Webhook-confirmed only</div>
                <p className="mt-2">Checkout creates a Stripe session, but access is not granted until the webhook verifies the event and updates the entitlement record.</p>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <div className="rounded-lg border p-3"><div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Access granted</div><div className="mt-1 font-semibold">{formatDate(data?.account?.accessGrantedAt)}</div></div>
                <div className="rounded-lg border p-3"><div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Renewal end</div><div className="mt-1 font-semibold">{formatDate(data?.account?.currentPeriodEndAt)}</div></div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => void openPortal()} disabled={createPortal.isPending || !data?.account?.stripeCustomerId} className="gap-2">
                  <ExternalLink className="h-4 w-4" /> Open Billing Portal
                </Button>
                <Button variant="outline" onClick={() => void refetch()} disabled={isLoading} className="gap-2">
                  <Sparkles className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} /> Refresh status
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5" /> Active Entitlements</CardTitle>
              <CardDescription>Entitlements currently granted to this workspace.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {data?.entitlements && Object.entries(data.entitlements).filter(([, v]) => v).map(([key]) => (
                <div key={key} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                  <span className="font-mono text-xs">{key}</span>
                  <Badge variant="success">Enabled</Badge>
                </div>
              ))}
              {data?.entitlements && Object.entries(data.entitlements).filter(([, v]) => !v).length > 0 && (
                <p className="text-xs text-muted-foreground pt-1">
                  {Object.entries(data.entitlements).filter(([, v]) => !v).length} entitlements locked for current plan.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Admin view */}
      {view === "admin" && (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm uppercase tracking-[0.2em] text-muted-foreground">Feature flag</CardTitle></CardHeader><CardContent className="text-sm"><div className="text-xl font-semibold">{data?.featureFlagEnabled ? "Enabled" : "Disabled"}</div></CardContent></Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm uppercase tracking-[0.2em] text-muted-foreground">Webhook events</CardTitle></CardHeader><CardContent className="text-sm"><div className="text-xl font-semibold">{data?.recentWebhookEvents.length ?? 0}</div></CardContent></Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm uppercase tracking-[0.2em] text-muted-foreground">Current access</CardTitle></CardHeader><CardContent className="text-sm"><div className="text-xl font-semibold">{data?.active ? `${data.tier === "elite" ? "Elite" : "Pro"} — Active` : "Inactive"}</div></CardContent></Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Webhook Audit Log</CardTitle>
              <CardDescription>Raw event history for admin troubleshooting.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {data?.recentWebhookEvents.length ? data.recentWebhookEvents.map((event) => (
                <div key={event.stripeEventId} className="flex flex-col gap-1 rounded-lg border p-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="font-medium">{event.eventType}</div>
                    <div className="text-sm text-muted-foreground">{event.stripeEventId} · {event.processingStatus}</div>
                  </div>
                  <div className="text-xs text-muted-foreground">{formatDate(event.receivedAt)}</div>
                </div>
              )) : (
                <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No webhook events have been processed yet.</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5" /> Admin diagnostics</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>Stripe secret configured: {data?.stripe.secretKeyConfigured ? "Yes" : "No"}</p>
              <p>Webhook secret configured: {data?.stripe.webhookSecretConfigured ? "Yes" : "No"}</p>
              <p>Pro price ID: {data?.stripe.priceId ?? "not configured"}</p>
              <p>Elite price ID: {data?.stripe.elitePriceId ?? "not configured"}</p>
              <p>Account key: {data?.account?.accountKey ?? "workspace"}</p>
              <p>Current plan key: {data?.account?.planKey ?? "—"}</p>
              <p>Current tier: {data?.tier ?? "—"}</p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
