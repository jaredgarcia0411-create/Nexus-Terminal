CREATE TABLE "backtest_actions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"session_id" text NOT NULL,
	"action_type" text NOT NULL,
	"price" double precision NOT NULL,
	"shares" double precision NOT NULL,
	"stop_price" double precision,
	"bar_time" text NOT NULL,
	"sequence" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backtest_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"ticker" text NOT NULL,
	"date" date NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"risk_dollars" double precision NOT NULL,
	"label" text,
	"notes" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "backtest_sessions_user_id_id_unique" UNIQUE("user_id","id")
);
--> statement-breakpoint
ALTER TABLE "backtest_actions" ADD CONSTRAINT "backtest_actions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtest_actions" ADD CONSTRAINT "backtest_actions_user_id_session_id_backtest_sessions_user_id_id_fk" FOREIGN KEY ("user_id","session_id") REFERENCES "public"."backtest_sessions"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtest_sessions" ADD CONSTRAINT "backtest_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "backtest_actions_user_session_seq_idx" ON "backtest_actions" USING btree ("user_id","session_id","sequence");--> statement-breakpoint
CREATE INDEX "backtest_sessions_user_ticker_date_idx" ON "backtest_sessions" USING btree ("user_id","ticker","date");--> statement-breakpoint
CREATE INDEX "backtest_sessions_user_status_idx" ON "backtest_sessions" USING btree ("user_id","status");