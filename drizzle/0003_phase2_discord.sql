CREATE TABLE "discord_identities" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"discord_id" text NOT NULL,
	"discord_username" text,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_states" (
	"state_hash" text PRIMARY KEY NOT NULL,
	"mode" text NOT NULL,
	"account_id" uuid,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "discord_public" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "show_tier_role" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pairings" ADD COLUMN "discord_id" text;--> statement-breakpoint
ALTER TABLE "pairings" ADD COLUMN "discord_username" text;--> statement-breakpoint
ALTER TABLE "discord_identities" ADD CONSTRAINT "discord_identities_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discord_identities_discord_idx" ON "discord_identities" USING btree ("discord_id");