CREATE TABLE "trade_import_batches" (
	"user_id" text NOT NULL,
	"batch_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "trade_import_batches_user_id_batch_key_pk" PRIMARY KEY("user_id","batch_key")
);
--> statement-breakpoint
ALTER TABLE "trade_import_batches" ADD CONSTRAINT "trade_import_batches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_trade_import_batches_user_created" ON "trade_import_batches" USING btree ("user_id","created_at");