/** Map host/DB errors to one plain operator sentence. */
export function operatorLoadError(message?: string | null): string | null {
  if (!message) return null;
  if (/database connection string|neon\(|DATABASE_URL/i.test(message)) {
    return 'Could not load store data. Check the database connection, then refresh.';
  }
  return message;
}

/**
 * Profile slug → names that mean that profile.
 * First name is the label on the Setup button.
 * Kept equal to ads SKILL_CLIENT_ALIASES by the checklist test.
 */
export const SKILL_PROFILE_ALIASES: Record<string, readonly string[]> = {
  'hvac-usa': ['HVAC USA'],
  'got-ductless': ['Got Ductless'],
  'kc-prestige-hvac': ['KC Prestige HVAC', 'KC Prestige'],
  'elmar-hvac': ['Elmar HVAC'],
  'tharros-media': ['Tharros Media', 'Tharros Media (agency brand)'],
  cerevex: ['Cerevex'],
};

export function skillProfileSlugForName(name: string): string | null {
  for (const [slug, aliases] of Object.entries(SKILL_PROFILE_ALIASES)) {
    if (aliases.includes(name)) return slug;
  }
  return null;
}

export function skillProfileLabel(slug: string | null | undefined): string | null {
  if (!slug) return null;
  return SKILL_PROFILE_ALIASES[slug]?.[0] ?? null;
}

export function loadProfileCta(name: string | null): string {
  return name ? `Load the ${name} profile` : 'Load a skills profile';
}

export const ADD_CLIENT = 'Add a client';
export const CLIENT_NAME_LABEL = 'Client name';
export const WHO_IS_THIS = 'Who is this for?';
export const WHAT_KIND_OF_BUSINESS = 'What kind of business?';
export const THEIR_WEBSITE = 'Their website.';
export const CONTINUE_ADD = 'Continue';
export const MAKE_NEW_CLIENT = 'Make a new client';
export const SKILLS_PROFILE_FOUND = 'Skills profile found. It will link when you finish.';
export const ADD_STORE_CONNECT_LATER = 'Add store, connect Shopify later';
export const PASTE_ADMIN_TOKEN = 'Already have an Admin API token? Paste it here';
export const ENTER_CLIENT_NAME = 'Enter a client name.';
export const CLIENT_NAME_TOO_LONG = 'Client name is too long.';
export const TYPE_A_DIFFERENT_NAME = 'Type a different name.';
export const ENTER_STORE_ADDRESS = 'Enter your store address, like mystore.myshopify.com.';
export const PASTE_ADMIN_TOKEN_REQUIRED = 'Paste the Admin API access token.';
export const WORDPRESS_UNREACHABLE = "Couldn't reach that site. Check the address and that the plugin is active.";

export function alreadyClientUse(name: string): string {
  return `There's already a client called ${name}. Use that one?`;
}

export function useExistingClient(name: string): string {
  return `Use ${name}`;
}

export function alreadyAClient(name: string): string {
  return `There's already a client called ${name}.`;
}

export function storeAddressTaken(name: string): string {
  return `That store address is already a client: ${name}.`;
}

export function siteAlreadyLinked(name: string): string {
  return `That site is already linked to ${name}.`;
}

/** H1 sentence. The checklist test keeps this equal to META_RECONNECT_MESSAGE. */
export const META_NEEDS_RECONNECT = 'Meta sign-in expired. Reconnect Meta for this site.';
/** H1 sentence. The checklist test keeps this equal to META_PERMISSION_MESSAGE. */
export const META_PERMISSION = "Connected, but Meta didn't grant ad management. Reconnect and allow it.";
/** H1 sentence. The checklist test keeps this equal to META_RATE_LIMIT_MESSAGE. */
export const META_RATE_LIMIT = 'Meta asked us to slow down. Cerevex will retry.';

export const META_NOT_ON_SERVER = "Meta isn't set up on Cerevex yet.";
export const META_NO_ANSWER = "Meta didn't answer. Cerevex will try again later.";
export const META_EXPIRING = 'Meta sign-in is ending soon. Reconnect before then to keep syncing.';
export const META_PENDING = "Meta sign-in didn't finish.";
export const META_SYNCING = 'Meta is still syncing.';
export const META_DISCONNECTED = "Meta isn't connected yet.";
export const META_CONNECTED = 'Meta is connected.';
export const CONNECT_META = 'Connect Meta';
export const RECONNECT_META = 'Reconnect Meta';

export const GOOGLE_NEEDS_RECONNECT = 'Google Ads sign-in expired. Reconnect Google Ads for this site.';
export const GOOGLE_NOT_ON_SERVER = "Google Ads isn't set up on Cerevex yet. Nothing to do here today.";
export const GOOGLE_PERMISSION = "Connected, but Google Ads didn't grant campaign access. Reconnect and allow it.";
export const GOOGLE_RATE_LIMIT = 'Google Ads asked us to slow down. Cerevex will retry.';
export const GOOGLE_NO_ANSWER = "Google Ads didn't answer. Cerevex will try again later.";
export const GOOGLE_EXPIRING = 'Google Ads sign-in is ending soon. Reconnect before then to keep syncing.';
export const GOOGLE_PENDING = "Google Ads sign-in didn't finish.";
export const GOOGLE_SYNCING = 'Google Ads is still syncing.';
export const GOOGLE_DISCONNECTED = "Google Ads isn't connected yet.";
export const GOOGLE_CONNECTED = 'Google Ads is connected.';
export const CONNECT_GOOGLE = 'Connect Google Ads';
export const RECONNECT_GOOGLE = 'Reconnect Google Ads';

export const SHOPIFY_NOT_CONNECTED = 'Shopify not connected yet. You can still connect ads.';
export const SHOPIFY_CONNECTED = 'Shopify is connected.';
export const ADD_SHOPIFY = 'Add the Shopify connection';
export const WORDPRESS_NOT_ANSWERING = "WordPress plugin isn't answering. Check it's active.";
export const WORDPRESS_ANSWERING = 'WordPress plugin is answering.';
export const CHECK_PLUGIN = 'Check the plugin';

export const PICK_BUSINESS_TYPE = 'Pick home-service or online store.';
export const ADS_CLIENT_MISSING = 'Not linked yet.';
export const NAME_THIS_CLIENT = 'Name this client';
export const FIX_CLIENT_NAME = 'Fix the name';
export const ADS_CLIENT_LINKED = 'Ads client is linked.';
export const ADS_CLIENT_DUPLICATE = 'This store is linked to more than one ads client.';

export const CONNECT_SEARCH_CONSOLE = 'Connect Search Console';
export const SEARCH_CONSOLE_MISSING = "Search Console isn't connected yet.";
export const SEARCH_CONSOLE_PICK = 'Pick a Search Console property.';
export const SEARCH_CONSOLE_DONE = 'Search Console property is picked.';

export const GA4_LATER = 'Comes with the GA4 update.';
export const GA4_MISSING = "GA4 isn't connected yet.";
export const GA4_DONE = 'GA4 property is picked.';
export const CONNECT_GA4 = 'Connect GA4';

export const CONNECT_CALLRAIL = 'Connect CallRail (optional)';
export const CALLRAIL_MISSING = "CallRail isn't connected yet.";
export const CALLRAIL_DONE = 'CallRail is connected.';

export const SKILLS_LINKED = 'Skills profile is linked.';
export const SKILLS_LOADED_NOT_LINKED = "The profile is loaded, but it isn't linked to this site yet.";
export const SKILLS_OWNER_ONLY = 'Only the owner can load a profile.';
export const COULD_NOT_LOAD = "Couldn't load this. Refresh and try again.";
export const COULD_NOT_LOAD_ADS = "Couldn't load the ads checklist. Refresh and try again.";
export const COULD_NOT_LOAD_FLAGS = "Couldn't load which settings are on for every client.";
export const NO_FLAGS_ON = 'Nothing is turned on for every client right now.';

export function missingFactsSentence(count: number): string {
  if (count === 1) return '1 fact still missing.';
  return `${count} facts still missing.`;
}

export function adsClientMismatch(name: string): string {
  return `The ads client is named ${name}. It doesn't match this store.`;
}

export function sharedFlagsSummary(labels: string[]): string {
  if (labels.length === 0) return NO_FLAGS_ON;
  const preview = labels.slice(0, 3).join(', ');
  return `These are on for every client: ${preview}${labels.length > 3 ? '…' : ''}`;
}
