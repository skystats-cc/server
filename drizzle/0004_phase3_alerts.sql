CREATE TABLE "alert_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"product_id" text NOT NULL,
	"side" text DEFAULT 'buy' NOT NULL,
	"op" text,
	"threshold" double precision,
	"cooldown_minutes" integer DEFAULT 60 NOT NULL,
	"armed" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_fired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "money_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"profile_id" text NOT NULL,
	"target" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reached_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notification_prefs" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"discord_dm" boolean DEFAULT false NOT NULL,
	"quiet_start_min" integer,
	"quiet_end_min" integer,
	"time_zone" text DEFAULT 'Europe/London' NOT NULL,
	"daily_digest" boolean DEFAULT false NOT NULL,
	"weekly_recap" boolean DEFAULT false NOT NULL,
	"coop_activity" boolean DEFAULT false NOT NULL,
	"mayor_reminder" boolean DEFAULT false NOT NULL,
	"patch_notes" boolean DEFAULT false NOT NULL,
	"outages" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"url" text,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deliver_after" timestamp with time zone DEFAULT now() NOT NULL,
	"dm_status" text DEFAULT 'none' NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "skyblock_election" (
	"id" text PRIMARY KEY NOT NULL,
	"year" integer,
	"mayor" text,
	"perks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"candidates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"open" boolean DEFAULT false NOT NULL,
	"checked_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skyblock_news" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"published_at" timestamp with time zone,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"announced_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_goals" ADD CONSTRAINT "money_goals_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD CONSTRAINT "notification_prefs_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alert_rules_account_idx" ON "alert_rules" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "alert_rules_product_idx" ON "alert_rules" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "notifications_account_idx" ON "notifications" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_dm_idx" ON "notifications" USING btree ("dm_status","deliver_after");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_idx" ON "notifications" USING btree ("account_id","dedupe_key");