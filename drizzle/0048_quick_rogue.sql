CREATE TABLE "team_tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "team_tags_name_unique" UNIQUE("name")
);

INSERT INTO team_tags (name) SELECT DISTINCT name FROM tags ON CONFLICT DO NOTHING;
