CREATE TABLE "player_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"player_uuid" text NOT NULL,
	"taken_at" timestamp with time zone DEFAULT now() NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "players" (
	"uuid" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_fetched_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "player_snapshots" ADD CONSTRAINT "player_snapshots_player_uuid_players_uuid_fk" FOREIGN KEY ("player_uuid") REFERENCES "public"."players"("uuid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "player_snapshots_player_taken_idx" ON "player_snapshots" USING btree ("player_uuid","taken_at");