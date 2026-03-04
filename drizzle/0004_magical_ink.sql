CREATE TABLE "service_token_jtis" (
	"jti" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "idx_service_token_jtis_expires" ON "service_token_jtis" USING btree ("expires_at");