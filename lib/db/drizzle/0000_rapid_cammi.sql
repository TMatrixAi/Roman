CREATE TABLE "predictions" (
	"id" serial PRIMARY KEY NOT NULL,
	"player1_id" text NOT NULL,
	"player1_name" text NOT NULL,
	"player2_id" text NOT NULL,
	"player2_name" text NOT NULL,
	"surface" text NOT NULL,
	"match_format" text NOT NULL,
	"tournament_level" text,
	"tournament_name" text,
	"strategy_id" text,
	"strategy_version" text,
	"calibration_version" text,
	"external_fixture_id" text,
	"snapshot_captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"predicted_winner_id" text NOT NULL,
	"predicted_winner_name" text NOT NULL,
	"calibrated_probability" real NOT NULL,
	"predicted_winner_probability" real NOT NULL,
	"data_quality" integer NOT NULL,
	"data_quality_label" text NOT NULL,
	"upset_risk" text NOT NULL,
	"recommendation" text NOT NULL,
	"predicted_set_score" text NOT NULL,
	"engine" jsonb NOT NULL,
	"match_identity_key" text NOT NULL,
	"input_snapshot_hash" text NOT NULL,
	"actual_winner_id" text,
	"actual_winner_name" text,
	"decision_trace" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "historical_matches" (
	"id" serial PRIMARY KEY NOT NULL,
	"external_id" text NOT NULL,
	"provider" text DEFAULT 'API-Tennis' NOT NULL,
	"tour" text,
	"tournament_name" text,
	"tournament_level" text,
	"surface" text,
	"round" text,
	"match_format" text,
	"player1_id" text NOT NULL,
	"player1_name" text NOT NULL,
	"player2_id" text NOT NULL,
	"player2_name" text NOT NULL,
	"winner_id" text,
	"score" text,
	"retired" boolean DEFAULT false NOT NULL,
	"walkover" boolean DEFAULT false NOT NULL,
	"cancelled" boolean DEFAULT false NOT NULL,
	"game_margins_player1" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"indoor" boolean,
	"player1_rank" integer,
	"player2_rank" integer,
	"scheduled_start_at" timestamp with time zone NOT NULL,
	"scheduled_start_time_confirmed" boolean DEFAULT true NOT NULL,
	"cutoff_minutes" integer NOT NULL,
	"cutoff_at" timestamp with time zone NOT NULL,
	"raw_source" jsonb NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "match_feature_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"match_id" integer NOT NULL,
	"player_id" text NOT NULL,
	"feature_name" text NOT NULL,
	"feature_value" real NOT NULL,
	"source_timestamp" timestamp with time zone NOT NULL,
	"match_cutoff_at" timestamp with time zone NOT NULL,
	"existed_before_cutoff" boolean NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calibration_models" (
	"id" serial PRIMARY KEY NOT NULL,
	"method" text DEFAULT 'isotonic' NOT NULL,
	"mapping" jsonb NOT NULL,
	"validation_sample_size" integer NOT NULL,
	"validation_date_range_start" timestamp with time zone,
	"validation_date_range_end" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"isotonic_holdout_log_loss" real,
	"platt_holdout_log_loss" real,
	"holdout_sample_size" integer DEFAULT 0 NOT NULL,
	"fitted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evaluation_predictions" (
	"id" serial PRIMARY KEY NOT NULL,
	"strategy_id" text,
	"strategy_version" text,
	"strategy_fingerprint" text,
	"optimizer_run_id" text,
	"prediction_mode" text,
	"calibration_version" text,
	"competitive_balance_version" text,
	"evidence_reliability_version" text,
	"run_kind" text NOT NULL,
	"fold_id" integer,
	"segment" text,
	"shadow_batch_label" text,
	"historical_match_id" integer,
	"provider" text,
	"external_fixture_id" text,
	"player1_id" text NOT NULL,
	"player1_name" text NOT NULL,
	"player2_id" text NOT NULL,
	"player2_name" text NOT NULL,
	"surface" text,
	"match_format" text,
	"tournament_level" text,
	"tournament_name" text,
	"scheduled_start_at" timestamp with time zone NOT NULL,
	"cutoff_at" timestamp with time zone NOT NULL,
	"locked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"model_version" text NOT NULL,
	"feature_snapshot" jsonb,
	"raw_probability" real,
	"calibrated_probability" real,
	"predicted_winner_id" text,
	"predicted_winner_name" text,
	"model_agreement" text,
	"upset_risk_tier" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"actual_winner_id" text,
	"actual_winner_name" text,
	"result_type" text,
	"included_in_accuracy" boolean,
	"graded_at" timestamp with time zone,
	"odds_provider" text,
	"odds_player1_decimal" real,
	"odds_player2_decimal" real,
	"odds_fetched_at" timestamp with time zone,
	"implied_probability" real,
	"market_edge" real
);
--> statement-breakpoint
CREATE TABLE "evaluation_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"fold_index" integer NOT NULL,
	"model_version" text NOT NULL,
	"train_start" timestamp with time zone NOT NULL,
	"train_end" timestamp with time zone NOT NULL,
	"validation_start" timestamp with time zone NOT NULL,
	"validation_end" timestamp with time zone NOT NULL,
	"test_start" timestamp with time zone NOT NULL,
	"test_end" timestamp with time zone NOT NULL,
	"calibration_mapping" jsonb NOT NULL,
	"validation_metrics" jsonb NOT NULL,
	"test_metrics" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_name" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"attempts" integer NOT NULL,
	"summary" jsonb,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pattern_analysis_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"total_analyzed" integer NOT NULL,
	"segments" jsonb NOT NULL,
	"run_kinds_included" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prediction_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"retirement_rule" text DEFAULT 'excluded' NOT NULL,
	"paper_trade_lead_minutes" integer DEFAULT 30 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "simulator_validation" (
	"id" serial PRIMARY KEY NOT NULL,
	"sample_size" integer NOT NULL,
	"min_sample_size" integer NOT NULL,
	"simulator_accuracy" real,
	"simulator_log_loss" real,
	"simulator_brier" real,
	"ensemble_accuracy" real,
	"ensemble_log_loss" real,
	"ensemble_brier" real,
	"adopted" boolean DEFAULT false NOT NULL,
	"weight" real DEFAULT 0 NOT NULL,
	"note" text NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "specialist_models" (
	"id" serial PRIMARY KEY NOT NULL,
	"segment_key" text NOT NULL,
	"tour" text NOT NULL,
	"surface" text NOT NULL,
	"label" text NOT NULL,
	"historical_match_count" integer NOT NULL,
	"meets_threshold" boolean NOT NULL,
	"validation_sample_size" integer DEFAULT 0 NOT NULL,
	"accuracy" real,
	"log_loss" real,
	"brier" real,
	"general_accuracy" real,
	"general_log_loss" real,
	"general_brier" real,
	"calibration_mapping" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"weight" real DEFAULT 0 NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "threshold_evaluation_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"total_graded" integer NOT NULL,
	"thresholds" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backtest_predictions" (
	"id" serial PRIMARY KEY NOT NULL,
	"backtest_run_id" integer NOT NULL,
	"historical_match_id" text,
	"player1_id" text NOT NULL,
	"player1_name" text NOT NULL,
	"player2_id" text NOT NULL,
	"player2_name" text NOT NULL,
	"surface" text,
	"match_format" text,
	"tournament_level" text,
	"tournament_name" text,
	"scheduled_start_at" timestamp with time zone NOT NULL,
	"model_version" text,
	"raw_probability" real,
	"calibrated_probability" real,
	"predicted_winner_id" text,
	"predicted_winner_name" text,
	"actual_winner_id" text,
	"actual_winner_name" text,
	"result_type" text,
	"included_in_accuracy" boolean DEFAULT false NOT NULL,
	"player1_won" boolean,
	"feature_snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backtest_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"notes" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"mode" text DEFAULT 'evaluation' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"date_range" jsonb,
	"filters" jsonb,
	"validation_setup" jsonb,
	"model_version" text,
	"config_version" text,
	"dataset_version" text,
	"row_counts" jsonb,
	"processed_rows" integer DEFAULT 0 NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"current_stage" text,
	"metrics" jsonb,
	"errors" jsonb,
	"candidate_config_id" integer,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "candidate_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"strategy_id" text,
	"strategy_version" text,
	"strategy_name" text,
	"strategy_family" text,
	"strategy_fingerprint" text,
	"parent_strategy_id" text,
	"parent_strategy_version" text,
	"creation_method" text,
	"optimizer_run_id" text,
	"last_tested_at" timestamp with time zone,
	"production_status" text,
	"lifecycle_status" text,
	"validation_status" text,
	"walk_forward_status" text,
	"shadow_status" text,
	"feature_set" jsonb,
	"weights" jsonb,
	"thresholds" jsonb,
	"calibration_method" text,
	"specialist_routing" text,
	"competitive_balance_behavior" jsonb,
	"evidence_reliability_behavior" jsonb,
	"abstention_rules" jsonb,
	"recommendation_gates" jsonb,
	"promoted_at" timestamp with time zone,
	"promoted_by" text,
	"rollback_strategy_id" text,
	"name" text NOT NULL,
	"notes" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"source_run_id" integer,
	"weight_diff" jsonb,
	"threshold_diff" jsonb,
	"proposed_config" jsonb,
	"holdout_metrics" jsonb,
	"validation_metrics" jsonb,
	"acceptance_checks_passed" boolean,
	"acceptance_checks" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "config_promotions" (
	"id" serial PRIMARY KEY NOT NULL,
	"candidate_config_id" integer NOT NULL,
	"strategy_id" text,
	"strategy_version" text,
	"strategy_fingerprint" text,
	"old_config" jsonb,
	"new_config" jsonb,
	"reason" text,
	"validation_period" text,
	"metrics" jsonb,
	"promoted_by" text,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "master_players" (
	"id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"api_tennis_key" text,
	"matchstat_key" text,
	"country_code" text,
	"tour" text,
	"current_rank" integer,
	"last_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_stats" (
	"player_id" text PRIMARY KEY NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"overall_elo" real,
	"elo_hard" real,
	"elo_clay" real,
	"elo_grass" real,
	"elo_indoor_hard" real,
	"matches_played" integer DEFAULT 0 NOT NULL,
	"win_rate_last_100" real,
	"game_share_last_100" real,
	"serve_rating_proxy" real,
	"return_rating_proxy" real,
	"surface_stats" jsonb,
	"opponent_strength_avg" real
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"stripe_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"livemode" boolean DEFAULT false NOT NULL,
	"processing_status" text DEFAULT 'received' NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"error_message" text,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_key" text DEFAULT 'workspace' NOT NULL,
	"display_name" text DEFAULT 'Workspace Subscription' NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"stripe_price_id" text,
	"plan_key" text,
	"plan_name" text,
	"subscription_status" text,
	"access_granted_at" timestamp with time zone,
	"current_period_start_at" timestamp with time zone,
	"current_period_end_at" timestamp with time zone,
	"trial_end_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"entitlement_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_webhook_event_id" text,
	"last_checkout_session_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "match_feature_snapshots" ADD CONSTRAINT "match_feature_snapshots_match_id_historical_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."historical_matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_predictions" ADD CONSTRAINT "evaluation_predictions_fold_id_evaluation_runs_id_fk" FOREIGN KEY ("fold_id") REFERENCES "public"."evaluation_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_predictions" ADD CONSTRAINT "evaluation_predictions_historical_match_id_historical_matches_id_fk" FOREIGN KEY ("historical_match_id") REFERENCES "public"."historical_matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "predictions_created_at_idx" ON "predictions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "predictions_recommendation_idx" ON "predictions" USING btree ("recommendation");--> statement-breakpoint
CREATE UNIQUE INDEX "predictions_identity_input_snapshot_idx" ON "predictions" USING btree ("match_identity_key","input_snapshot_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "historical_matches_external_id_idx" ON "historical_matches" USING btree ("provider","external_id");--> statement-breakpoint
CREATE INDEX "historical_matches_scheduled_start_idx" ON "historical_matches" USING btree ("scheduled_start_at");--> statement-breakpoint
CREATE UNIQUE INDEX "match_feature_snapshots_unique_idx" ON "match_feature_snapshots" USING btree ("match_id","player_id","feature_name");--> statement-breakpoint
CREATE INDEX "match_feature_snapshots_match_idx" ON "match_feature_snapshots" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX "match_feature_snapshots_player_idx" ON "match_feature_snapshots" USING btree ("player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "evaluation_predictions_historical_match_idx" ON "evaluation_predictions" USING btree ("run_kind","historical_match_id");--> statement-breakpoint
CREATE UNIQUE INDEX "evaluation_predictions_fixture_idx" ON "evaluation_predictions" USING btree ("run_kind","provider","external_fixture_id");--> statement-breakpoint
CREATE INDEX "evaluation_predictions_status_idx" ON "evaluation_predictions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "evaluation_predictions_scheduled_start_idx" ON "evaluation_predictions" USING btree ("scheduled_start_at");--> statement-breakpoint
CREATE INDEX "evaluation_predictions_run_kind_segment_idx" ON "evaluation_predictions" USING btree ("run_kind","segment");--> statement-breakpoint
CREATE INDEX "evaluation_predictions_shadow_batch_idx" ON "evaluation_predictions" USING btree ("run_kind","shadow_batch_label");--> statement-breakpoint
CREATE INDEX "job_runs_job_name_started_idx" ON "job_runs" USING btree ("job_name","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "specialist_models_segment_key_idx" ON "specialist_models" USING btree ("segment_key");--> statement-breakpoint
CREATE INDEX "backtest_predictions_run_idx" ON "backtest_predictions" USING btree ("backtest_run_id");--> statement-breakpoint
CREATE INDEX "backtest_predictions_scheduled_idx" ON "backtest_predictions" USING btree ("backtest_run_id","scheduled_start_at");--> statement-breakpoint
CREATE INDEX "backtest_predictions_surface_idx" ON "backtest_predictions" USING btree ("backtest_run_id","surface");--> statement-breakpoint
CREATE INDEX "backtest_runs_status_idx" ON "backtest_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "backtest_runs_mode_idx" ON "backtest_runs" USING btree ("mode");--> statement-breakpoint
CREATE INDEX "backtest_runs_created_idx" ON "backtest_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "backtest_runs_deleted_idx" ON "backtest_runs" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "candidate_configs_status_idx" ON "candidate_configs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "candidate_configs_source_run_idx" ON "candidate_configs" USING btree ("source_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "master_players_api_tennis_key_idx" ON "master_players" USING btree ("api_tennis_key");--> statement-breakpoint
CREATE UNIQUE INDEX "master_players_matchstat_key_idx" ON "master_players" USING btree ("matchstat_key");--> statement-breakpoint
CREATE INDEX "master_players_normalized_name_idx" ON "master_players" USING btree ("normalized_name");--> statement-breakpoint
CREATE INDEX "player_stats_computed_at_idx" ON "player_stats" USING btree ("computed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_stripe_event_id_idx" ON "webhook_events" USING btree ("stripe_event_id");--> statement-breakpoint
CREATE INDEX "webhook_events_status_idx" ON "webhook_events" USING btree ("processing_status");--> statement-breakpoint
CREATE INDEX "webhook_events_type_idx" ON "webhook_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "webhook_events_received_idx" ON "webhook_events" USING btree ("received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_accounts_account_key_idx" ON "payments_accounts" USING btree ("account_key");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_accounts_customer_idx" ON "payments_accounts" USING btree ("stripe_customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_accounts_subscription_idx" ON "payments_accounts" USING btree ("stripe_subscription_id");--> statement-breakpoint
CREATE INDEX "payments_accounts_status_idx" ON "payments_accounts" USING btree ("subscription_status");