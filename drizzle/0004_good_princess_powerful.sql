CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "jarvis_knowledge_chunks" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"source_url" text NOT NULL,
	"source_host" text NOT NULL,
	"source_title" text NOT NULL,
	"source_type" text NOT NULL,
	"chunk_index" integer NOT NULL,
	"start_token" integer NOT NULL,
	"end_token" integer NOT NULL,
	"token_count" integer NOT NULL,
	"text" text NOT NULL,
	"hash" text NOT NULL,
	"relevance" double precision DEFAULT 0 NOT NULL,
	"tickers" text[] DEFAULT '{}' NOT NULL,
	"published_at" timestamp with time zone,
	"author" text,
	"embedding" vector(768),
	"text_search" "tsvector" NOT NULL,
	"seen_count" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"last_seen_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "uq_jarvis_knowledge_chunks_source_hash" UNIQUE("source_type","source_host","hash")
);
--> statement-breakpoint
ALTER TABLE "jarvis_knowledge_chunks" ADD CONSTRAINT "jarvis_knowledge_chunks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_jarvis_knowledge_chunks_user_last_seen" ON "jarvis_knowledge_chunks" USING btree ("user_id","last_seen_at");--> statement-breakpoint
CREATE INDEX "idx_jarvis_knowledge_chunks_user_relevance" ON "jarvis_knowledge_chunks" USING btree ("user_id","relevance");--> statement-breakpoint
CREATE INDEX "idx_jarvis_knowledge_chunks_source_url" ON "jarvis_knowledge_chunks" USING btree ("source_url");--> statement-breakpoint
CREATE INDEX "idx_jarvis_knowledge_chunks_tickers" ON "jarvis_knowledge_chunks" USING gin ("tickers");--> statement-breakpoint
CREATE INDEX "idx_jarvis_knowledge_chunks_text_search" ON "jarvis_knowledge_chunks" USING gin ("text_search");
