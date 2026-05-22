CREATE TABLE "chart_drawings" (
	"user_id" text NOT NULL,
	"ticker" text NOT NULL,
	"bucket" text NOT NULL,
	"drawings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"indicators" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chart_drawings_user_id_ticker_bucket_pk" PRIMARY KEY("user_id","ticker","bucket")
);
--> statement-breakpoint
ALTER TABLE "chart_drawings" ADD CONSTRAINT "chart_drawings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "chart_drawings" ADD CONSTRAINT "chart_drawings_bucket_check" CHECK ("bucket" IN ('intraday','higher'));
