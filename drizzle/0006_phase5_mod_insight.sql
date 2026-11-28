CREATE TABLE "annotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"profile_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"text" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mod_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"profile_id" text,
	"at" timestamp with time zone NOT NULL,
	"type" text NOT NULL,
	"item_id" text,
	"item_name" text,
	"qty" integer
);
--> statement-breakpoint
CREATE TABLE "play_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"profile_id" text,
	"started_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"coins_start" double precision,
	"coins_end" double precision,
	"activity" text,
	"method_id" text
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "activity_insights" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "member_snapshots" ADD COLUMN "inventory_value" double precision;--> statement-breakpoint
ALTER TABLE "member_snapshots" ADD COLUMN "kind" text DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_events" ADD CONSTRAINT "mod_events_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "play_sessions" ADD CONSTRAINT "play_sessions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "annotations_account_idx" ON "annotations" USING btree ("account_id","profile_id");--> statement-breakpoint
CREATE INDEX "mod_events_account_idx" ON "mod_events" USING btree ("account_id","at");--> statement-breakpoint
CREATE INDEX "play_sessions_account_idx" ON "play_sessions" USING btree ("account_id","started_at");