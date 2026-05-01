CREATE TABLE "backtests" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"sample_set_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sample_sets" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"rows" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "backtest_sessions" ADD COLUMN "backtest_id" text;--> statement-breakpoint
ALTER TABLE "backtests" ADD CONSTRAINT "backtests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtests" ADD CONSTRAINT "backtests_sample_set_id_sample_sets_id_fk" FOREIGN KEY ("sample_set_id") REFERENCES "public"."sample_sets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sample_sets" ADD CONSTRAINT "sample_sets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "backtests_user_created_idx" ON "backtests" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "backtests_user_name_idx" ON "backtests" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "sample_sets_user_created_idx" ON "sample_sets" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sample_sets_user_name_idx" ON "sample_sets" USING btree ("user_id","name");--> statement-breakpoint
ALTER TABLE "backtest_sessions" ADD CONSTRAINT "backtest_sessions_backtest_id_backtests_id_fk" FOREIGN KEY ("backtest_id") REFERENCES "public"."backtests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "backtest_sessions_user_backtest_idx" ON "backtest_sessions" USING btree ("user_id","backtest_id");