CREATE TABLE "jarvis_request_log" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"mode" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"success" integer DEFAULT 1 NOT NULL,
	"source_count" integer DEFAULT 0 NOT NULL,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "jarvis_request_log" ADD CONSTRAINT "jarvis_request_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_jarvis_request_log_user_created" ON "jarvis_request_log" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_jarvis_request_log_created" ON "jarvis_request_log" USING btree ("created_at");