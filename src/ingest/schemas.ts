import { z } from 'zod';

// TODO: replace with the real upstream response shape.
// Validating here means bad upstream data fails loudly instead of corrupting snapshots.
export const upstreamPlayerSchema = z
  .object({
    uuid: z.string(),
    username: z.string(),
  })
  .passthrough();

export type UpstreamPlayer = z.infer<typeof upstreamPlayerSchema>;
