CREATE TABLE "career_pnl_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"month" date NOT NULL,
	"amount" double precision NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "career_pnl_entries_user_id_month_unique" UNIQUE("user_id","month")
);
--> statement-breakpoint
ALTER TABLE "career_pnl_entries" ADD CONSTRAINT "career_pnl_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "career_pnl_user_month_idx" ON "career_pnl_entries" USING btree ("user_id","month");