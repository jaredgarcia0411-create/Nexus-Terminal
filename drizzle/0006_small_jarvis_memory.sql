CREATE TABLE "jarvis_source_urls" (
	"user_id" text NOT NULL,
	"url" text NOT NULL,
	"use_count" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"last_used_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "jarvis_source_urls_user_id_url_pk" PRIMARY KEY("user_id","url")
);
--> statement-breakpoint
ALTER TABLE "jarvis_source_urls" ADD CONSTRAINT "jarvis_source_urls_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_jarvis_source_urls_user_last_used" ON "jarvis_source_urls" USING btree ("user_id","last_used_at");
