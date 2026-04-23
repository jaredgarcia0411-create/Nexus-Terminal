CREATE TABLE "system_tickers" (
	"id" text PRIMARY KEY NOT NULL,
	"ticker" text NOT NULL,
	"date" date NOT NULL,
	"grade" text,
	"primary_agenda" text,
	"secondary_agenda" text,
	"setup_type" text,
	"outcome" text,
	"ticker_win_loss" text,
	"ticker_r" double precision,
	"trigger_count" integer,
	"day1_gap_pct" double precision,
	"attempts_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"raw_json" jsonb NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "system_tickers_ticker_date_unique" UNIQUE("ticker","date")
);
--> statement-breakpoint
CREATE INDEX "system_tickers_date_idx" ON "system_tickers" USING btree ("date");
--> statement-breakpoint
CREATE INDEX "system_tickers_ticker_idx" ON "system_tickers" USING btree ("ticker");
