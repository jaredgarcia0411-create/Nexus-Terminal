ALTER TABLE "trades" ADD COLUMN "is_open" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "remaining_qty" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "trades" SET "closed_at" = (date::date)::timestamptz WHERE "closed_at" IS NULL;
