CREATE TABLE "realtime_quotes" (
	"symbol" text PRIMARY KEY NOT NULL,
	"asset_type" text DEFAULT 'equity' NOT NULL,
	"last_price" double precision,
	"bid_price" double precision,
	"ask_price" double precision,
	"open_price" double precision,
	"high_price" double precision,
	"low_price" double precision,
	"close_price" double precision,
	"net_change" double precision,
	"net_change_percent" double precision,
	"total_volume" double precision,
	"exchange_id" text,
	"description" text,
	"security_status" text,
	"quote_time_ms" double precision,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schwab_links" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"encrypted_tokens" text NOT NULL,
	"token_iv" text NOT NULL,
	"token_tag" text NOT NULL,
	"account_label" text,
	"status" text DEFAULT 'active' NOT NULL,
	"access_token_expires_at" timestamp with time zone NOT NULL,
	"refresh_token_expires_at" timestamp with time zone NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "schwab_links_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "schwab_links" ADD CONSTRAINT "schwab_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "realtime_quotes_asset_type_idx" ON "realtime_quotes" USING btree ("asset_type");--> statement-breakpoint
CREATE INDEX "realtime_quotes_updated_at_idx" ON "realtime_quotes" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "schwab_links_status_idx" ON "schwab_links" USING btree ("status");
