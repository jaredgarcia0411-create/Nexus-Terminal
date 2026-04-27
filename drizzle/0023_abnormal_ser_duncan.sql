CREATE TABLE "sec_ticker_cik" (
	"ticker" text PRIMARY KEY NOT NULL,
	"cik" text NOT NULL,
	"name" text NOT NULL,
	"exchange" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "sec_ticker_cik_fetched_idx" ON "sec_ticker_cik" USING btree ("fetched_at");