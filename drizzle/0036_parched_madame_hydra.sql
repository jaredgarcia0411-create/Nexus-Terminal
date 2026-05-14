CREATE TABLE "watchlist_theses" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "watchlist_theses_user_id_name_unique" UNIQUE("user_id","name")
);
--> statement-breakpoint
ALTER TABLE "watchlist_theses" ADD CONSTRAINT "watchlist_theses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_watchlist_theses_user_id" ON "watchlist_theses" USING btree ("user_id");