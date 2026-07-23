ALTER TABLE "predictions" ADD COLUMN IF NOT EXISTS "strategy_id" text;
ALTER TABLE "predictions" ADD COLUMN IF NOT EXISTS "strategy_version" text;
ALTER TABLE "predictions" ADD COLUMN IF NOT EXISTS "calibration_version" text;
ALTER TABLE "predictions" ADD COLUMN IF NOT EXISTS "external_fixture_id" text;
ALTER TABLE "predictions" ADD COLUMN IF NOT EXISTS "snapshot_captured_at" timestamp with time zone DEFAULT now() NOT NULL;
