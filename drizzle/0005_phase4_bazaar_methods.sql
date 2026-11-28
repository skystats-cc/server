CREATE TABLE "auction_prices" (
	"item_id" text NOT NULL,
	"hour" timestamp with time zone NOT NULL,
	"sales" integer NOT NULL,
	"median" double precision NOT NULL,
	"min" double precision NOT NULL,
	CONSTRAINT "auction_prices_item_id_hour_pk" PRIMARY KEY("item_id","hour")
);
--> statement-breakpoint
CREATE TABLE "auction_sales" (
	"auction_id" text PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"price_per_unit" double precision NOT NULL,
	"sold_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bazaar_anomalies" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"z" double precision NOT NULL,
	"price" double precision NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bazaar_correlations" (
	"product_id" text NOT NULL,
	"other_id" text NOT NULL,
	"r" double precision NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "bazaar_correlations_product_id_other_id_pk" PRIMARY KEY("product_id","other_id")
);
--> statement-breakpoint
CREATE TABLE "custom_methods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"spec" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "election_history" (
	"year" integer PRIMARY KEY NOT NULL,
	"mayor" text,
	"perks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"tier" text,
	"npc_sell_price" double precision,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lowest_bins" (
	"item_id" text PRIMARY KEY NOT NULL,
	"price" double precision NOT NULL,
	"count" integer NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "method_values" (
	"method_id" text NOT NULL,
	"hour" timestamp with time zone NOT NULL,
	"value" double precision NOT NULL,
	CONSTRAINT "method_values_method_id_hour_pk" PRIMARY KEY("method_id","hour")
);
--> statement-breakpoint
CREATE TABLE "method_votes" (
	"method_id" text NOT NULL,
	"account_id" uuid NOT NULL,
	"vote" integer NOT NULL,
	"still_works" boolean,
	"difficulty" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "method_votes_method_id_account_id_pk" PRIMARY KEY("method_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "recipes" (
	"output_id" text PRIMARY KEY NOT NULL,
	"output_count" integer DEFAULT 1 NOT NULL,
	"inputs" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watchlist" (
	"account_id" uuid NOT NULL,
	"product_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "watchlist_account_id_product_id_pk" PRIMARY KEY("account_id","product_id")
);
--> statement-breakpoint
ALTER TABLE "bazaar_products" ADD COLUMN "buy_summary" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "bazaar_products" ADD COLUMN "sell_summary" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "custom_methods" ADD CONSTRAINT "custom_methods_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "method_votes" ADD CONSTRAINT "method_votes_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist" ADD CONSTRAINT "watchlist_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auction_sales_sold_idx" ON "auction_sales" USING btree ("sold_at");--> statement-breakpoint
CREATE INDEX "bazaar_anomalies_detected_idx" ON "bazaar_anomalies" USING btree ("detected_at");