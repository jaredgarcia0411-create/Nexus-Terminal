CREATE TABLE "discord_user_links" (
	"user_id" text NOT NULL,
	"discord_user_id" text NOT NULL,
	"guild_id" text NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "discord_user_links_user_id_discord_user_id_pk" PRIMARY KEY("user_id","discord_user_id")
);
--> statement-breakpoint
CREATE TABLE "price_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"symbol" text NOT NULL,
	"condition" text NOT NULL,
	"target_price" double precision NOT NULL,
	"triggered" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "discord_user_links" ADD CONSTRAINT "discord_user_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_alerts" ADD CONSTRAINT "price_alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_discord_links_discord_guild" ON "discord_user_links" USING btree ("discord_user_id","guild_id");--> statement-breakpoint
CREATE INDEX "idx_discord_links_user_id" ON "discord_user_links" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_price_alerts_user_triggered" ON "price_alerts" USING btree ("user_id","triggered");