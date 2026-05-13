CREATE TABLE "sec_filings_raw" (
	"accession_number" text PRIMARY KEY NOT NULL,
	"cik" text NOT NULL,
	"ticker_requested" text NOT NULL,
	"ticker_at_ingest" text,
	"form_type" text NOT NULL,
	"filed_at" text NOT NULL,
	"report_date" text,
	"acceptance_datetime" text,
	"items" text,
	"primary_document" text,
	"primary_doc_description" text,
	"sec_url" text,
	"archive_source" text,
	"metadata_json" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "sec_filings_raw_cik_filed_idx" ON "sec_filings_raw" USING btree ("cik","filed_at");--> statement-breakpoint
CREATE INDEX "sec_filings_raw_ticker_filed_idx" ON "sec_filings_raw" USING btree ("ticker_requested","filed_at");--> statement-breakpoint
CREATE INDEX "sec_filings_raw_form_idx" ON "sec_filings_raw" USING btree ("form_type");