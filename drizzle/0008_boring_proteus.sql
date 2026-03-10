CREATE TABLE "agent_memory" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"category" text NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"value_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"expires_at" timestamp with time zone,
	CONSTRAINT "agent_memory_user_id_category_key_unique" UNIQUE("user_id","category","key")
);
--> statement-breakpoint
CREATE TABLE "jarvis_conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"session_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"mode" text,
	"context_snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "macro_summaries" (
	"id" text PRIMARY KEY NOT NULL,
	"summary_json" jsonb NOT NULL,
	"sources_json" jsonb,
	"model_used" text,
	"generated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "research_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"ticker" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"raw_data" jsonb,
	"report_json" jsonb,
	"model_used" text,
	"error_message" text,
	"generated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "agent_memory" ADD CONSTRAINT "agent_memory_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jarvis_conversations" ADD CONSTRAINT "jarvis_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_reports" ADD CONSTRAINT "research_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_memory_user_category_idx" ON "agent_memory" USING btree ("user_id","category");--> statement-breakpoint
CREATE INDEX "jarvis_conversations_user_session_idx" ON "jarvis_conversations" USING btree ("user_id","session_id","created_at");--> statement-breakpoint
CREATE INDEX "macro_summaries_generated_at_idx" ON "macro_summaries" USING btree ("generated_at");--> statement-breakpoint
CREATE INDEX "research_reports_user_ticker_idx" ON "research_reports" USING btree ("user_id","ticker","generated_at");