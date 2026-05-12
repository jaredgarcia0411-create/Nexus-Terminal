CREATE TABLE "askedgar_daily_tickers" (
	"date" date NOT NULL,
	"ticker" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "askedgar_daily_tickers_date_ticker_pk" PRIMARY KEY("date","ticker")
);
--> statement-breakpoint
CREATE TABLE "askedgar_runtime_state" (
	"id" text PRIMARY KEY NOT NULL,
	"rate_limited_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "askedgar_daily_tickers_date_idx" ON "askedgar_daily_tickers" USING btree ("date");