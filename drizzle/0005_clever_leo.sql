CREATE TABLE "jarvis_user_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "jarvis_knowledge_chunks" ALTER COLUMN "embedding" SET DATA TYPE vector(1024);--> statement-breakpoint
ALTER TABLE "jarvis_knowledge_chunks" ADD COLUMN "source_tags" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "jarvis_user_documents" ADD CONSTRAINT "jarvis_user_documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_jarvis_user_documents_user_created" ON "jarvis_user_documents" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_jarvis_knowledge_chunks_source_tags" ON "jarvis_knowledge_chunks" USING gin ("source_tags");