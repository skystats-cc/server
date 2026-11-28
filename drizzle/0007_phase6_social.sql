CREATE TABLE "achievements" (
	"account_id" uuid NOT NULL,
	"key" text NOT NULL,
	"earned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "achievements_account_id_key_pk" PRIMARY KEY("account_id","key")
);
--> statement-breakpoint
CREATE TABLE "competition_entries" (
	"competition_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "competition_entries_competition_id_account_id_pk" PRIMARY KEY("competition_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "competitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"name" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"created_by_discord" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "follows" (
	"follower_id" uuid NOT NULL,
	"followed_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "follows_follower_id_followed_id_pk" PRIMARY KEY("follower_id","followed_id")
);
--> statement-breakpoint
CREATE TABLE "game_plays" (
	"game" text NOT NULL,
	"day" date NOT NULL,
	"discord_id" text NOT NULL,
	"answer" double precision NOT NULL,
	"points" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_plays_game_day_discord_id_pk" PRIMARY KEY("game","day","discord_id")
);
--> statement-breakpoint
CREATE TABLE "game_rounds" (
	"game" text NOT NULL,
	"day" date NOT NULL,
	"product_id" text NOT NULL,
	"start_price" double precision NOT NULL,
	"end_price" double precision,
	CONSTRAINT "game_rounds_game_day_pk" PRIMARY KEY("game","day")
);
--> statement-breakpoint
CREATE TABLE "leaderboard_entries" (
	"board" text NOT NULL,
	"period" text NOT NULL,
	"scope" text NOT NULL,
	"subject" text NOT NULL,
	"rank" integer NOT NULL,
	"value" double precision NOT NULL,
	"label" text NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "leaderboard_entries_board_period_scope_subject_pk" PRIMARY KEY("board","period","scope","subject")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "profile_theme" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "vanity" text;--> statement-breakpoint
ALTER TABLE "achievements" ADD CONSTRAINT "achievements_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_entries" ADD CONSTRAINT "competition_entries_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_entries" ADD CONSTRAINT "competition_entries_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_follower_id_accounts_id_fk" FOREIGN KEY ("follower_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_followed_id_accounts_id_fk" FOREIGN KEY ("followed_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_vanity_unique" UNIQUE("vanity");