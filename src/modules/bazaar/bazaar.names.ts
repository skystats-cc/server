// ENCHANTED_DIAMOND -> "Enchanted Diamond". Placeholder until we pull real names
// from /v2/resources/skyblock/items.
export function displayName(productId: string): string {
  return productId
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
