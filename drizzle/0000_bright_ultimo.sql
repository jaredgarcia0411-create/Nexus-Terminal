CREATE TABLE "broker_sync_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"broker" text NOT NULL,
	"account_number" text NOT NULL,
	"sync_start" text NOT NULL,
	"sync_end" text NOT NULL,
	"trades_synced" integer DEFAULT 0 NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "schwab_tokens" (
	"user_id" text PRIMARY KEY NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"expires_at" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "tags_user_id_name_unique" UNIQUE("user_id","name")
);
--> statement-breakpoint
CREATE TABLE "trade_tags" (
	"user_id" text NOT NULL,
	"trade_id" text NOT NULL,
	"tag" text NOT NULL,
	CONSTRAINT "trade_tags_user_id_trade_id_tag_pk" PRIMARY KEY("user_id","trade_id","tag")
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" text NOT NULL,
	"user_id" text NOT NULL,
	"date" text NOT NULL,
	"sort_key" text NOT NULL,
	"symbol" text NOT NULL,
	"direction" text NOT NULL,
	"avg_entry_price" double precision NOT NULL,
	"avg_exit_price" double precision NOT NULL,
	"total_quantity" double precision NOT NULL,
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
	"name" text,
	"picture" text,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "broker_sync_log" ADD CONSTRAINT "broker_sync_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schwab_tokens" ADD CONSTRAINT "schwab_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_tags" ADD CONSTRAINT "trade_tags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_tags" ADD CONSTRAINT "trade_tags_user_id_trade_id_trades_user_id_id_fk" FOREIGN KEY ("user_id","trade_id") REFERENCES "public"."trades"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_tags_user_id" ON "tags" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_trade_tags_user_trade_id" ON "trade_tags" USING btree ("user_id","trade_id");--> statement-breakpoint
CREATE INDEX "idx_trades_user_sort_key" ON "trades" USING btree ("user_id","sort_key");