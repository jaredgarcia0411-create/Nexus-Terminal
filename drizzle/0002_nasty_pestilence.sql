CREATE TABLE "discord_link_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"discord_user_id" text NOT NULL,
	"guild_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "idx_discord_link_codes_user" ON "discord_link_codes" USING btree ("discord_user_id");--> statement-breakpoint
CREATE INDEX "idx_discord_link_codes_expires" ON "discord_link_codes" USING btree ("expires_at");