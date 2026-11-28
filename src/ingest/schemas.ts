import { z } from 'zod';

// GET /v2/skyblock/bazaar (no key required)
// quick_status.buyPrice  = price to instabuy (weighted top 2% of sell offers)
// quick_status.sellPrice = price you get to instasell (weighted top 2% of buy orders)
export const bazaarQuickStatusSchema = z.object({
  productId: z.string(),
  sellPrice: z.number(),
  sellVolume: z.number(),
  sellMovingWeek: z.number(),
  sellOrders: z.number(),
  buyPrice: z.number(),
  buyVolume: z.number(),
  buyMovingWeek: z.number(),
  buyOrders: z.number(),
});

export const bazaarResponseSchema = z.object({
  success: z.boolean(),
  lastUpdated: z.number(),
  products: z.record(
    z
      .object({
        product_id: z.string(),
        quick_status: bazaarQuickStatusSchema,
        buy_summary: z.array(z.object({ amount: z.number(), pricePerUnit: z.number(), orders: z.number() })).default([]),
        sell_summary: z.array(z.object({ amount: z.number(), pricePerUnit: z.number(), orders: z.number() })).default([]),
      })
      .passthrough(),
  ),
});

export type BazaarResponse = z.infer<typeof bazaarResponseSchema>;

// status.hypixel.net summary feed. Kept lenient on purpose.
export const statusSummarySchema = z
  .object({
    status: z.object({ indicator: z.string(), description: z.string() }),
    components: z
      .array(z.object({ name: z.string(), status: z.string() }).passthrough())
      .default([]),
    incidents: z
      .array(
        z
          .object({
            name: z.string(),
            status: z.string(),
            impact: z.string().optional(),
            shortlink: z.string().optional(),
          })
          .passthrough(),
      )
      .default([]),
  })
  .passthrough();

export type StatusSummary = z.infer<typeof statusSummarySchema>;

// GET /v2/skyblock/profiles?uuid=  (API key required). Member objects are huge; we only read a few fields.
const profileMemberSchema = z
  .object({
    profile: z
      .object({
        first_join: z.number().optional(),
        bank_account: z.number().optional(), // personal bank
        coop_invitation: z.object({ confirmed: z.boolean() }).passthrough().optional(),
        deletion_notice: z.object({ timestamp: z.number() }).passthrough().optional(), // left the profile
      })
      .passthrough()
      .optional(),
    currencies: z.object({ coin_purse: z.number().optional() }).passthrough().optional(),
    leveling: z.object({ experience: z.number().optional() }).passthrough().optional(),
  })
  .passthrough();

export const skyblockProfileSchema = z
  .object({
    profile_id: z.string(),
    cute_name: z.string().optional(),
    selected: z.boolean().optional(),
    game_mode: z.string().optional(),
    banking: z.object({ balance: z.number().optional() }).passthrough().optional(),
    members: z.record(profileMemberSchema),
  })
  .passthrough();

export const skyblockProfilesResponseSchema = z.object({
  success: z.boolean(),
  profiles: z.array(skyblockProfileSchema).nullable(),
});

export type SkyblockProfilesResponse = z.infer<typeof skyblockProfilesResponseSchema>;
