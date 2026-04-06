CREATE TABLE "agent_conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"session_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"channel" text DEFAULT 'web' NOT NULL,
	"context_snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "agent_job_checkpoints" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"step_index" integer NOT NULL,
	"step_name" text NOT NULL,
	"checkpoint_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "agent_job_checkpoints_job_step" UNIQUE("job_id","step_index")
);
--> statement-breakpoint
CREATE TABLE "agent_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"user_id" text NOT NULL,
	"job_type" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"input" jsonb NOT NULL,
	"result" jsonb,
	"error_message" text,
	"progress_note" text,
	"step_log" jsonb DEFAULT '[]'::jsonb,
	"attempt" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"next_retry_at" timestamp with time zone,
	"locked_by" text,
	"lock_expires_at" timestamp with time zone,
	"last_heartbeat_at" timestamp with time zone,
	"lease_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_memory_v2" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"category" text NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"value_json" jsonb,
	"source" text,
	"confidence" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"expires_at" timestamp with time zone,
	CONSTRAINT "agent_memory_v2_user_agent_category_key" UNIQUE("user_id","agent_id","category","key")
);
--> statement-breakpoint
CREATE TABLE "agent_registry" (
	"id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'offline' NOT NULL,
	"capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_heartbeat" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "agent_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"user_id" text NOT NULL,
	"job_id" text,
	"report_type" text NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"report_json" jsonb NOT NULL,
	"status" text DEFAULT 'published' NOT NULL,
	"delivery_channel" text DEFAULT 'discord' NOT NULL,
	"delivered_at" timestamp with time zone,
	"delivery_error" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "agent_request_log" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"mode" text NOT NULL,
	"lane" text DEFAULT 'background' NOT NULL,
	"model_used" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"estimated_cost_cents" integer DEFAULT 0,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"success" integer DEFAULT 1 NOT NULL,
	"source_count" integer DEFAULT 0 NOT NULL,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "agent_scheduled_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"trigger_type" text NOT NULL,
	"trading_date" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"job_id" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"skip_reason" text,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "agent_scheduled_runs_agent_trigger_date" UNIQUE("agent_id","trigger_type","trading_date")
);
--> statement-breakpoint
CREATE TABLE "agent_step_effects" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"step_name" text NOT NULL,
	"effect_type" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "agent_step_effects_idempotency" UNIQUE("idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "agent_conversations" ADD CONSTRAINT "agent_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_conversations" ADD CONSTRAINT "agent_conversations_agent_id_agent_registry_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent_registry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_job_checkpoints" ADD CONSTRAINT "agent_job_checkpoints_job_id_agent_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."agent_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD CONSTRAINT "agent_jobs_agent_id_agent_registry_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent_registry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD CONSTRAINT "agent_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_memory_v2" ADD CONSTRAINT "agent_memory_v2_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_memory_v2" ADD CONSTRAINT "agent_memory_v2_agent_id_agent_registry_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent_registry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_reports" ADD CONSTRAINT "agent_reports_agent_id_agent_registry_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent_registry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_reports" ADD CONSTRAINT "agent_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_reports" ADD CONSTRAINT "agent_reports_job_id_agent_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."agent_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_request_log" ADD CONSTRAINT "agent_request_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_request_log" ADD CONSTRAINT "agent_request_log_agent_id_agent_registry_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent_registry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_scheduled_runs" ADD CONSTRAINT "agent_scheduled_runs_agent_id_agent_registry_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent_registry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_scheduled_runs" ADD CONSTRAINT "agent_scheduled_runs_job_id_agent_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."agent_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_step_effects" ADD CONSTRAINT "agent_step_effects_job_id_agent_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."agent_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_agent_conversations_user_session" ON "agent_conversations" USING btree ("user_id","session_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_agent_conversations_agent" ON "agent_conversations" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_agent_job_checkpoints_job_step" ON "agent_job_checkpoints" USING btree ("job_id","step_index");--> statement-breakpoint
CREATE INDEX "idx_agent_jobs_poll" ON "agent_jobs" USING btree ("agent_id","priority","created_at");--> statement-breakpoint
CREATE INDEX "idx_agent_jobs_user_status" ON "agent_jobs" USING btree ("user_id","status","created_at");--> statement-breakpoint
CREATE INDEX "idx_agent_jobs_stale" ON "agent_jobs" USING btree ("status","lock_expires_at");--> statement-breakpoint
CREATE INDEX "agent_memory_v2_user_agent_category_idx" ON "agent_memory_v2" USING btree ("user_id","agent_id","category");--> statement-breakpoint
CREATE INDEX "idx_agent_reports_user_status" ON "agent_reports" USING btree ("user_id","status","created_at");--> statement-breakpoint
CREATE INDEX "idx_agent_reports_agent" ON "agent_reports" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_agent_reports_job" ON "agent_reports" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "idx_agent_request_log_user_created" ON "agent_request_log" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_agent_request_log_agent_created" ON "agent_request_log" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_agent_request_log_created" ON "agent_request_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_scheduled_runs_status" ON "agent_scheduled_runs" USING btree ("agent_id","status","trading_date");