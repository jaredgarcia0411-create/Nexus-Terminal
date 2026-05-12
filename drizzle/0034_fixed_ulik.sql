CREATE TABLE "market_pulse_daily_bars" (
	"trade_date" date NOT NULL,
	"ticker" text NOT NULL,
	"open" double precision NOT NULL,
	"high" double precision NOT NULL,
	"low" double precision NOT NULL,
	"close" double precision NOT NULL,
	"volume" double precision NOT NULL,
	"vwap" double precision,
	"dollar_volume" double precision NOT NULL,
	"source_timestamp" timestamp with time zone,
	"sector" text,
	"industry" text,
	"country" text,
	"float_shares" double precision,
	"market_cap" double precision,
	"perf_30d" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_pulse_daily_bars_trade_date_ticker_pk" PRIMARY KEY("trade_date","ticker")
);
--> statement-breakpoint
CREATE TABLE "market_pulse_daily_stats" (
	"trade_date" date PRIMARY KEY NOT NULL,
	"ticker_count" integer NOT NULL,
	"advancers" integer NOT NULL,
	"decliners" integer NOT NULL,
	"unchanged" integer NOT NULL,
	"advancer_pct" double precision NOT NULL,
	"decliner_pct" double precision NOT NULL,
	"up_volume" double precision NOT NULL,
	"down_volume" double precision NOT NULL,
	"total_volume" double precision NOT NULL,
	"median_change_pct" double precision,
	"avg_change_pct" double precision,
	"pct_above_prev_close" double precision,
	"pct_above_dollar_volume_floor" double precision,
	"new_high_30d_count" integer NOT NULL,
	"new_low_30d_count" integer NOT NULL,
	"rolling_30_json" jsonb NOT NULL,
	"overview_90_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "market_pulse_daily_bars_ticker_date_idx" ON "market_pulse_daily_bars" USING btree ("ticker","trade_date");--> statement-breakpoint
CREATE INDEX "market_pulse_daily_stats_created_idx" ON "market_pulse_daily_stats" USING btree ("created_at");