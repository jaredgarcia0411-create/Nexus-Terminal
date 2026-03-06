CREATE TABLE "broker_sync_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"broker" text NOT NULL,
	"account_number" text NOT NULL,
	"sync_start" text NOT NULL,
	"sync_end" text NOT NULL,
	"trades_synced" integer DEFAULT 0 NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "discord_link_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"discord_user_id" text NOT NULL,
	"guild_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "discord_user_links" (
	"user_id" uuid NOT NULL,
	"discord_user_id" text NOT NULL,
	"guild_id" text NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "discord_user_links_user_id_discord_user_id_pk" PRIMARY KEY("user_id","discord_user_id")
);
--> statement-breakpoint
CREATE TABLE "jarvis_source_urls" (
	"user_id" uuid NOT NULL,
	"url" text NOT NULL,
	"use_count" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"last_used_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "jarvis_source_urls_user_id_url_pk" PRIMARY KEY("user_id","url")
);
--> statement-breakpoint
CREATE TABLE "notification_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"discord_user_id" text NOT NULL,
	"content" text NOT NULL,
	"dedupe_key" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "notification_jobs_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "price_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"condition" text NOT NULL,
	"target_price" double precision NOT NULL,
	"triggered" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "service_token_jtis" (
	"jti" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "tags_user_id_name_unique" UNIQUE("user_id","name")
);
--> statement-breakpoint
CREATE TABLE "trade_executions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"trade_id" text NOT NULL,
	"side" text NOT NULL,
	"price" double precision NOT NULL,
	"qty" double precision NOT NULL,
	"time" text NOT NULL,
	"timestamp" text,
	"commission" double precision DEFAULT 0,
	"fees" double precision DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "trade_tags" (
	"user_id" uuid NOT NULL,
	"trade_id" text NOT NULL,
	"tag" text NOT NULL,
	CONSTRAINT "trade_tags_user_id_trade_id_tag_pk" PRIMARY KEY("user_id","trade_id","tag")
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"date" text NOT NULL,
	"sort_key" text NOT NULL,
	"symbol" text NOT NULL,
	"direction" text NOT NULL,
	"avg_entry_price" double precision NOT NULL,
	"avg_exit_price" double precision NOT NULL,
	"total_quantity" double precision NOT NULL,
	"gross_pnl" double precision DEFAULT 0 NOT NULL,
	"net_pnl" double precision DEFAULT 0 NOT NULL,
	"entry_time" text DEFAULT '' NOT NULL,
	"exit_time" text DEFAULT '' NOT NULL,
	"execution_count" integer DEFAULT 1 NOT NULL,
	"mfe" double precision,
	"mae" double precision,
	"best_exit_pnl" double precision,
	"exit_efficiency" double precision,
	"pnl" double precision NOT NULL,
	"executions" integer DEFAULT 1 NOT NULL,
	"initial_risk" double precision,
	"commission" double precision DEFAULT 0,
	"fees" double precision DEFAULT 0,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "trades_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"picture" text,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "broker_sync_log" ADD CONSTRAINT "broker_sync_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_user_links" ADD CONSTRAINT "discord_user_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jarvis_source_urls" ADD CONSTRAINT "jarvis_source_urls_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_alerts" ADD CONSTRAINT "price_alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_executions" ADD CONSTRAINT "trade_executions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_executions" ADD CONSTRAINT "trade_executions_user_id_trade_id_trades_user_id_id_fk" FOREIGN KEY ("user_id","trade_id") REFERENCES "public"."trades"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_tags" ADD CONSTRAINT "trade_tags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_tags" ADD CONSTRAINT "trade_tags_user_id_trade_id_trades_user_id_id_fk" FOREIGN KEY ("user_id","trade_id") REFERENCES "public"."trades"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_discord_link_codes_user" ON "discord_link_codes" USING btree ("discord_user_id");--> statement-breakpoint
CREATE INDEX "idx_discord_link_codes_expires" ON "discord_link_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_discord_links_discord_guild" ON "discord_user_links" USING btree ("discord_user_id","guild_id");--> statement-breakpoint
CREATE INDEX "idx_discord_links_user_id" ON "discord_user_links" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_jarvis_source_urls_user_last_used" ON "jarvis_source_urls" USING btree ("user_id","last_used_at");--> statement-breakpoint
CREATE INDEX "idx_notification_jobs_status_next_attempt" ON "notification_jobs" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "idx_notification_jobs_discord_user" ON "notification_jobs" USING btree ("discord_user_id");--> statement-breakpoint
CREATE INDEX "idx_price_alerts_user_triggered" ON "price_alerts" USING btree ("user_id","triggered");--> statement-breakpoint
CREATE INDEX "idx_service_token_jtis_expires" ON "service_token_jtis" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_tags_user_id" ON "tags" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_executions_user_trade" ON "trade_executions" USING btree ("user_id","trade_id");--> statement-breakpoint
CREATE INDEX "idx_trade_tags_user_trade_id" ON "trade_tags" USING btree ("user_id","trade_id");--> statement-breakpoint
CREATE INDEX "idx_trades_user_sort_key" ON "trades" USING btree ("user_id","sort_key");