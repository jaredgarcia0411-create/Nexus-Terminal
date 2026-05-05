CREATE TABLE "mdr_triggers" (
	"ticker" text NOT NULL,
	"trigger_date" date NOT NULL,
	"trigger_close" double precision NOT NULL,
	"payload" jsonb NOT NULL,
	"invalidated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mdr_triggers_ticker_trigger_date_pk" PRIMARY KEY("ticker","trigger_date")
);
--> statement-breakpoint
CREATE INDEX "mdr_triggers_trigger_date_idx" ON "mdr_triggers" USING btree ("trigger_date");--> statement-breakpoint
CREATE INDEX "mdr_triggers_active_idx" ON "mdr_triggers" USING btree ("invalidated_at","trigger_date");