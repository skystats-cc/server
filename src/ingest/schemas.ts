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
    z.object({ product_id: z.string(), quick_status: bazaarQuickStatusSchema }).passthrough(),
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
