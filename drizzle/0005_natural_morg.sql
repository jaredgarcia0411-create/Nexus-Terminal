CREATE TABLE "trade_executions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"trade_id" text NOT NULL,
	"side" text NOT NULL,
	"price" double precision NOT NULL,
	"qty" double precision NOT NULL,
	"time" text NOT NULL,
	"timestamp" text,
	"commission" double precision DEFAULT 0,
	"fees" double precision DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "gross_pnl" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "net_pnl" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "entry_time" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "exit_time" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "execution_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "mfe" double precision;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "mae" double precision;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "best_exit_pnl" double precision;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "exit_efficiency" double precision;--> statement-breakpoint
ALTER TABLE "trade_executions" ADD CONSTRAINT "trade_executions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_executions" ADD CONSTRAINT "trade_executions_user_id_trade_id_trades_user_id_id_fk" FOREIGN KEY ("user_id","trade_id") REFERENCES "public"."trades"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_executions_user_trade" ON "trade_executions" USING btree ("user_id","trade_id");