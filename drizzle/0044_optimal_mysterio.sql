CREATE TABLE "research_tldr_claims" (
	"ticker" text PRIMARY KEY NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL
);
