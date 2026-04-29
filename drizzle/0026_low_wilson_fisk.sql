CREATE TABLE "sec_filing_body_cache" (
	"accession_number" text PRIMARY KEY NOT NULL,
	"cik" text NOT NULL,
	"form_type" text NOT NULL,
	"filed_at" text NOT NULL,
	"body" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "sec_filing_body_cache_cik_form_idx" ON "sec_filing_body_cache" USING btree ("cik","form_type");--> statement-breakpoint
CREATE INDEX "sec_filing_body_cache_fetched_idx" ON "sec_filing_body_cache" USING btree ("fetched_at");