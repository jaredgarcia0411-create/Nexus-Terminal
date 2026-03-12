CREATE TABLE "daily_ticker_summaries" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"ticker" text NOT NULL,
	"date" text NOT NULL,
	"open" double precision,
	"high" double precision,
	"low" double precision,
	"close" double precision,
	"volume" double precision,
	"pre_market" double precision,
	"after_hours" double precision,
	"raw_data" jsonb,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_ticker_summaries_user_id_ticker_date_unique" UNIQUE("user_id","ticker","date")
);
--> statement-breakpoint
CREATE TABLE "saved_tickers" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"ticker" text NOT NULL,
	"category" text DEFAULT 'watchlist' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_tickers_user_id_ticker_unique" UNIQUE("user_id","ticker")
);
--> statement-breakpoint
CREATE TABLE "market_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"snapshot_type" text NOT NULL,
	"data_json" jsonb NOT NULL,
	"warning" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "market_snapshots_snapshot_type_unique" UNIQUE("snapshot_type")
);
--> statement-breakpoint
ALTER TABLE "daily_ticker_summaries" ADD CONSTRAINT "daily_ticker_summaries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "saved_tickers" ADD CONSTRAINT "saved_tickers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "daily_ticker_summaries_user_date_idx" ON "daily_ticker_summaries" USING btree ("user_id","fetched_at");
--> statement-breakpoint
CREATE INDEX "saved_tickers_user_created_idx" ON "saved_tickers" USING btree ("user_id","created_at");
--> statement-breakpoint
CREATE INDEX "market_snapshots_expires_idx" ON "market_snapshots" USING btree ("expires_at");
