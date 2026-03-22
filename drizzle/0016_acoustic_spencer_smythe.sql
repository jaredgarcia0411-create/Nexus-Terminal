CREATE TABLE "askedgar_cache" (
	"id" text PRIMARY KEY NOT NULL,
	"cache_type" text NOT NULL,
	"ticker" text NOT NULL,
	"data_json" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "askedgar_cache_cache_type_ticker_unique" UNIQUE("cache_type","ticker")
);
--> statement-breakpoint
CREATE INDEX "askedgar_cache_expires_idx" ON "askedgar_cache" USING btree ("expires_at");