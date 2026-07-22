import { Router, type IRouter } from "express";
import { requireAdmin } from "../lib/adminAuth";
import { buildPaymentsStatus, createBillingPortal, createCheckoutSession, handleStripeWebhook } from "../services/payments/paymentsService";
import {
  CreateBillingPortalSessionBody,
  CreateBillingPortalSessionResponse,
  CreatePaymentsCheckoutSessionBody,
  CreatePaymentsCheckoutSessionResponse,
  GetPaymentsStatusResponse,
  PaymentsWebhookResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/payments/status", requireAdmin, async (_req, res): Promise<void> => {
  const status = await buildPaymentsStatus();
  res.json(GetPaymentsStatusResponse.parse(status));
});

router.post("/payments/checkout-session", requireAdmin, async (req, res): Promise<void> => {
  const parsed = CreatePaymentsCheckoutSessionBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const session = await createCheckoutSession(req, parsed.data);
    res.json(CreatePaymentsCheckoutSessionResponse.parse({ sessionId: session.id, url: session.url }));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to create checkout session" });
  }
});

router.post("/payments/billing-portal-session", requireAdmin, async (req, res): Promise<void> => {
  const parsed = CreateBillingPortalSessionBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const session = await createBillingPortal(req, parsed.data);
    res.json(CreateBillingPortalSessionResponse.parse({ url: session.url }));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to create billing portal session" });
  }
});

router.post("/payments/webhook", async (req, res): Promise<void> => {
  try {
    if (!req.rawBody) {
      res.status(400).json({ error: "Missing raw request body" });
      return;
    }

    const result = await handleStripeWebhook(req.rawBody, req.header("stripe-signature"));
    res.json(PaymentsWebhookResponse.parse(result));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Stripe webhook processing failed" });
  }
});

export default router;