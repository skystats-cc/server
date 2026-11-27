CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"account_id" uuid,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entitlements" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"tier" text DEFAULT 'free' NOT NULL,
	"status" text DEFAULT 'none' NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"grace_until" timestamp with time zone,
	"downgraded_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entitlements_stripe_customer_id_unique" UNIQUE("stripe_customer_id"),
	CONSTRAINT "entitlements_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id")
);
--> statement-breakpoint
CREATE TABLE "member_daily" (
	"player_uuid" text NOT NULL,
	"profile_id" text NOT NULL,
	"day" date NOT NULL,
	"open_total" double precision,
	"close_total" double precision,
	"min_total" double precision,
	"max_total" double precision,
	"samples" integer NOT NULL,
	CONSTRAINT "member_daily_player_uuid_profile_id_day_pk" PRIMARY KEY("player_uuid","profile_id","day")
);
--> statement-breakpoint
CREATE TABLE "stripe_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "profile_public" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "show_on_leaderboards" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "allow_activity_pings" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "hide_bank" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "member_snapshots" ADD COLUMN "source" text DEFAULT 'mod' NOT NULL;--> statement-breakpoint
-- Every snapshot written before this migration came from polling the Hypixel API.
UPDATE "member_snapshots" SET "source" = 'hypixel_api';--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_account_idx" ON "audit_log" USING btree ("account_id","at");