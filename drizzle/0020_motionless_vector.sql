CREATE TABLE "daily_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"date" date NOT NULL,
	"template_id" text,
	"template_snapshot" jsonb NOT NULL,
	"report_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"trade_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "daily_reviews_user_id_date_unique" UNIQUE("user_id","date")
);
--> statement-breakpoint
CREATE TABLE "report_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"fields" jsonb NOT NULL,
	"is_default" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "report_templates_user_id_type_unique" UNIQUE("user_id","type")
);
--> statement-breakpoint
CREATE TABLE "weekly_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"week_start" date NOT NULL,
	"week_end" date NOT NULL,
	"template_id" text,
	"template_snapshot" jsonb NOT NULL,
	"report_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"trade_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "weekly_reviews_user_id_week_start_unique" UNIQUE("user_id","week_start")
);
--> statement-breakpoint
ALTER TABLE "daily_reviews" ADD CONSTRAINT "daily_reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_reviews" ADD CONSTRAINT "daily_reviews_template_id_report_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."report_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_templates" ADD CONSTRAINT "report_templates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_reviews" ADD CONSTRAINT "weekly_reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_reviews" ADD CONSTRAINT "weekly_reviews_template_id_report_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."report_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "daily_reviews_user_date_idx" ON "daily_reviews" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "report_templates_user_type_idx" ON "report_templates" USING btree ("user_id","type");--> statement-breakpoint
CREATE INDEX "weekly_reviews_user_week_idx" ON "weekly_reviews" USING btree ("user_id","week_start");