CREATE TABLE "sheet_members" (
	"sheet_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'editor' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sheet_members_sheet_id_user_id_pk" PRIMARY KEY("sheet_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "sheet_rows" (
	"id" text PRIMARY KEY NOT NULL,
	"sheet_id" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_by_user_id" text,
	"updated_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sheets" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"name" text NOT NULL,
	"sheet_date" date,
	"is_template" boolean DEFAULT false NOT NULL,
	"columns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"columns_version" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sheet_members" ADD CONSTRAINT "sheet_members_sheet_id_sheets_id_fk" FOREIGN KEY ("sheet_id") REFERENCES "public"."sheets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_members" ADD CONSTRAINT "sheet_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_rows" ADD CONSTRAINT "sheet_rows_sheet_id_sheets_id_fk" FOREIGN KEY ("sheet_id") REFERENCES "public"."sheets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_rows" ADD CONSTRAINT "sheet_rows_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_rows" ADD CONSTRAINT "sheet_rows_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheets" ADD CONSTRAINT "sheets_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sheet_members_user_idx" ON "sheet_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sheet_rows_sheet_position_idx" ON "sheet_rows" USING btree ("sheet_id","position");--> statement-breakpoint
CREATE INDEX "sheets_owner_updated_idx" ON "sheets" USING btree ("owner_user_id","updated_at");