CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_uuid" text NOT NULL,
	"tracking_enabled" boolean DEFAULT true NOT NULL,
	"mod_last_seen_at" timestamp with time zone,
	"mod_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "accounts_player_uuid_unique" UNIQUE("player_uuid")
);
--> statement-breakpoint
CREATE TABLE "auth_challenges" (
	"server_id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"player_uuid" text NOT NULL,
	"taken_at" timestamp with time zone DEFAULT now() NOT NULL,
	"purse" double precision,
	"personal_bank" double precision,
	"profile_bank" double precision,
	"skyblock_xp" double precision
);
--> statement-breakpoint
CREATE TABLE "pairings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"secret_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"linked_at" timestamp with time zone,
	CONSTRAINT "pairings_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "players" (
	"uuid" text PRIMARY KEY NOT NULL,
	"username" text,
	"username_checked_at" timestamp with time zone,
	"profiles_fetched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_members" (
	"profile_id" text NOT NULL,
	"player_uuid" text NOT NULL,
	"active" boolean NOT NULL,
	"selected" boolean DEFAULT false NOT NULL,
	"first_join" timestamp with time zone,
	"purse" double precision,
	"personal_bank" double precision,
	"skyblock_xp" double precision,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "profile_members_profile_id_player_uuid_pk" PRIMARY KEY("profile_id","player_uuid")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"token_hash" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "skyblock_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"cute_name" text,
	"game_mode" text DEFAULT 'normal' NOT NULL,
	"bank_balance" double precision,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_player_uuid_players_uuid_fk" FOREIGN KEY ("player_uuid") REFERENCES "public"."players"("uuid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pairings" ADD CONSTRAINT "pairings_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_members" ADD CONSTRAINT "profile_members_profile_id_skyblock_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."skyblock_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_members" ADD CONSTRAINT "profile_members_player_uuid_players_uuid_fk" FOREIGN KEY ("player_uuid") REFERENCES "public"."players"("uuid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_snapshots_member_taken_idx" ON "member_snapshots" USING btree ("player_uuid","profile_id","taken_at");--> statement-breakpoint
CREATE INDEX "member_snapshots_taken_idx" ON "member_snapshots" USING btree ("taken_at");--> statement-breakpoint
CREATE INDEX "profile_members_player_idx" ON "profile_members" USING btree ("player_uuid");--> statement-breakpoint
CREATE INDEX "sessions_account_idx" ON "sessions" USING btree ("account_id");