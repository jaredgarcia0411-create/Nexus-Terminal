CREATE TABLE "sec_companyfacts_cache" (
	"cik" text PRIMARY KEY NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "sec_companyfacts_cache_fetched_idx" ON "sec_companyfacts_cache" USING btree ("fetched_at");