export function isPaymentsV2Enabled(): boolean {
  return (import.meta.env.VITE_PAYMENTS_V2_ENABLED ?? "false") === "true";
}