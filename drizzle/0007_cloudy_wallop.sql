ALTER TABLE "broker_sync_log" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "discord_link_codes" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "discord_user_links" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification_jobs" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "price_alerts" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "schwab_tokens" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "service_token_jtis" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tags" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "trade_executions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "trade_tags" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "trades" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "broker_sync_log" CASCADE;--> statement-breakpoint
DROP TABLE "discord_link_codes" CASCADE;--> statement-breakpoint
DROP TABLE "discord_user_links" CASCADE;--> statement-breakpoint
DROP TABLE "notification_jobs" CASCADE;--> statement-breakpoint
DROP TABLE "price_alerts" CASCADE;--> statement-breakpoint
DROP TABLE "schwab_tokens" CASCADE;--> statement-breakpoint
DROP TABLE "service_token_jtis" CASCADE;--> statement-breakpoint
DROP TABLE "tags" CASCADE;--> statement-breakpoint
DROP TABLE "trade_executions" CASCADE;--> statement-breakpoint
DROP TABLE "trade_tags" CASCADE;--> statement-breakpoint
DROP TABLE "trades" CASCADE;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "id" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "created_at" SET DATA TYPE timestamp;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "name";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "picture";