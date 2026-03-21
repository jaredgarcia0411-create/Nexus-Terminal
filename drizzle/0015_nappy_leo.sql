CREATE TABLE "ticker_research_summaries" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"ticker" text NOT NULL,
	"report_count" integer DEFAULT 0 NOT NULL,
	"latest_report_date" timestamp with time zone,
	"historical_summary" jsonb,
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "ticker_research_summaries_user_id_ticker_unique" UNIQUE("user_id","ticker")
);
--> statement-breakpoint
ALTER TABLE "ticker_research_summaries" ADD CONSTRAINT "ticker_research_summaries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ticker_research_summaries_user_idx" ON "ticker_research_summaries" USING btree ("user_id");