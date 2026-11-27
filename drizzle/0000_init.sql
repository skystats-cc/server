CREATE TABLE "bazaar_products" (
	"product_id" text PRIMARY KEY NOT NULL,
	"buy_price" double precision NOT NULL,
	"sell_price" double precision NOT NULL,
	"buy_volume" bigint NOT NULL,
	"sell_volume" bigint NOT NULL,
	"buy_moving_week" bigint NOT NULL,
	"sell_moving_week" bigint NOT NULL,
	"buy_orders" integer NOT NULL,
	"sell_orders" integer NOT NULL,
	"upstream_updated_at" timestamp with time zone NOT NULL,
	"polled_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bazaar_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"taken_at" timestamp with time zone DEFAULT now() NOT NULL,
	"buy_price" double precision NOT NULL,
	"sell_price" double precision NOT NULL,
	"buy_volume" bigint NOT NULL,
	"sell_volume" bigint NOT NULL,
	"buy_moving_week" bigint NOT NULL,
	"sell_moving_week" bigint NOT NULL,
	"buy_orders" integer NOT NULL,
	"sell_orders" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hypixel_status" (
	"id" text PRIMARY KEY NOT NULL,
	"indicator" text NOT NULL,
	"description" text NOT NULL,
	"components" jsonb NOT NULL,
	"incidents" jsonb NOT NULL,
	"checked_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bazaar_snapshots" ADD CONSTRAINT "bazaar_snapshots_product_id_bazaar_products_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."bazaar_products"("product_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bazaar_snapshots_product_taken_idx" ON "bazaar_snapshots" USING btree ("product_id","taken_at");--> statement-breakpoint
CREATE INDEX "bazaar_snapshots_taken_idx" ON "bazaar_snapshots" USING btree ("taken_at");