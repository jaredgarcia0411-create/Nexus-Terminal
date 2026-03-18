CREATE TABLE "imported_research_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"ticker" text NOT NULL,
	"report_date" timestamp with time zone NOT NULL,
	"source" text DEFAULT 'discord_import' NOT NULL,
	"discord_message_id" text,
	"raw_text" text NOT NULL,
	"parsed_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "imported_research_reports_discord_message_id_unique" UNIQUE("discord_message_id")
);
--> statement-breakpoint
ALTER TABLE "imported_research_reports" ADD CONSTRAINT "imported_research_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "imported_research_user_ticker_idx" ON "imported_research_reports" USING btree ("user_id","ticker","report_date");--> statement-breakpoint
CREATE INDEX "imported_research_user_date_idx" ON "imported_research_reports" USING btree ("user_id","report_date");