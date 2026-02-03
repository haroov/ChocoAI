/**
 * Payment Gateway Configuration
 * Contains supported payment gateway providers and helper functions
 */

export interface PaymentGatewayProvider {
  id: string;
  display_name: string;
  primary_country: string;
  groups: string[];
  type: string;
  is_preferred: boolean;
  channels: Array<{
    id: string;
    label: string;
    methods: string[];
    tags: string[];
    aliases: string[];
  }>;
  requiredFields?: Array<{
    name: string;
    label: string;
    optional?: boolean;
    description?: string;
  }>;
}

export interface PaymentGatewaySchema {
  schema_version: string;
  providers: PaymentGatewayProvider[];
}

// Payment gateway schema - all supported providers
const GATEWAY_SCHEMA: PaymentGatewaySchema = {
  schema_version: '1.0',
  providers: [
    // Israeli providers
    {
      id: 'yaad_pay',
      display_name: 'Yaad Pay',
      primary_country: 'IL',
      groups: ['israel_providers'],
      type: 'payment_gateway',
      is_preferred: false,
      requiredFields: [
        { name: 'terminal_number', label: 'Terminal Number' },
        { name: 'api_key', label: 'API Key' },
      ],
      channels: [
        {
          id: 'yaad_pay_card',
          label: 'Yaad Pay (Card)',
          methods: ['card'],
          tags: ['online', 'gateway'],
          aliases: ['Yaad Pay'],
        },
      ],
    },
    {
      id: 'meshulam',
      display_name: 'Meshulam',
      primary_country: 'IL',
      groups: ['israel_providers'],
      type: 'payment_gateway',
      is_preferred: false,
      requiredFields: [
        { name: 'page_code', label: 'Page Code' },
        { name: 'user_id', label: 'User ID' },
        { name: 'api_key', label: 'API Key' },
      ],
      channels: [
        {
          id: 'meshulam_card',
          label: 'Meshulam (Card)',
          methods: ['card'],
          tags: ['online', 'gateway'],
          aliases: ['Meshulam'],
        },
        {
          id: 'meshulam_bit',
          label: 'Meshulam Bit',
          methods: ['wallet'],
          tags: ['bit', 'wallet'],
          aliases: ['Meshulam Bit'],
        },
        {
          id: 'meshulam_google_pay',
          label: 'Meshulam Google Pay',
          methods: ['wallet'],
          tags: ['google_pay'],
          aliases: ['Meshulam google Pay'],
        },
        {
          id: 'meshulam_bank_transfer',
          label: 'Meshulam Bank Transfer',
          methods: ['bank_transfer'],
          tags: ['bank_transfer'],
          aliases: ['Meshulam Bank Transfer'],
        },
      ],
    },
    {
      id: 'cardcom',
      display_name: 'Cardcom',
      primary_country: 'IL',
      groups: ['israel_providers', 'usa_providers'],
      type: 'payment_gateway',
      is_preferred: false,
      requiredFields: [
        { name: 'terminal_number', label: 'Terminal Number' },
        { name: 'user_name', label: 'Username' },
        { name: 'user_password', label: 'Password' },
        { name: 'currency', label: 'Currency Code (ILS/USD/EUR)' },
      ],
      channels: [
        {
          id: 'cardcom_card',
          label: 'Cardcom (Card)',
          methods: ['card'],
          tags: ['online', 'gateway'],
          aliases: ['Cardcom'],
        },
        {
          id: 'cardcom_bit',
          label: 'Cardcom Bit',
          methods: ['wallet'],
          tags: ['bit'],
          aliases: ['Cardcom Bit'],
        },
      ],
    },
    {
      id: 'nedarim_plus',
      display_name: 'Nedarim Plus',
      primary_country: 'IL',
      groups: ['israel_providers'],
      type: 'payment_gateway',
      is_preferred: false,
      requiredFields: [
        { name: 'mosad_id', label: 'Mosad ID' },
        { name: 'api_password', label: 'API Password' },
      ],
      channels: [
        {
          id: 'nedarim_plus_card',
          label: 'Nedarim Plus (Card)',
          methods: ['card'],
          tags: ['online', 'gateway'],
          aliases: ['Nedarim Plus'],
        },
        {
          id: 'nedarim_plus_bit',
          label: 'Nedarim Plus Bit',
          methods: ['wallet'],
          tags: ['bit'],
          aliases: ['Nedarim Plus Bit'],
        },
        {
          id: 'nedarim_plus_bank_transfer',
          label: 'Nedarim Plus Bank Transfer',
          methods: ['bank_transfer'],
          tags: ['bank_transfer'],
          aliases: ['Nedarim Plus Bank Transfer'],
        },
      ],
    },
    {
      id: 'israeltoremet',
      display_name: 'Israeltoremet',
      primary_country: 'IL',
      groups: ['israel_providers'],
      type: 'payment_gateway',
      is_preferred: false,
      requiredFields: [
        { name: 'organization_id', label: 'Organization ID' },
      ],
      channels: [
        {
          id: 'israeltoremet_default',
          label: 'Israeltoremet',
          methods: ['card'],
          tags: ['online', 'gateway'],
          aliases: ['Israeltoremet'],
        },
      ],
    },
    {
      id: 'mancal',
      display_name: 'Mancal',
      primary_country: 'IL',
      groups: ['israel_providers'],
      type: 'payment_gateway',
      is_preferred: false,
      requiredFields: [
        { name: 'username', label: 'Username' },
        { name: 'password', label: 'Password' },
        { name: 'terminal', label: 'Terminal ID' },
      ],
      channels: [
        {
          id: 'mancal_card',
          label: 'Mancal (Card)',
          methods: ['card'],
          tags: ['online', 'gateway'],
          aliases: ['Mancal'],
        },
        {
          id: 'mancal_bit',
          label: 'Mancal Bit',
          methods: ['wallet'],
          tags: ['bit'],
          aliases: ['Mancal Bit'],
        },
      ],
    },
    {
      id: 'jaffa',
      display_name: 'Jaffa',
      primary_country: 'IL',
      groups: ['israel_providers'],
      type: 'payment_gateway',
      is_preferred: false,
      requiredFields: [],
      channels: [
        {
          id: 'jaffa_card',
          label: 'Jaffa (Card)',
          methods: ['card'],
          tags: ['online', 'gateway'],
          aliases: ['Jaffa'],
        },
        {
          id: 'jaffa_bit',
          label: 'Jaffa Bit',
          methods: ['wallet'],
          tags: ['bit'],
          aliases: ['Jaffa Bit'],
        },
      ],
    },
    {
      id: 'aminut',
      display_name: 'Aminut',
      primary_country: 'IL',
      groups: ['israel_providers'],
      type: 'payment_gateway',
      is_preferred: false,
      requiredFields: [],
      channels: [
        {
          id: 'aminut_card',
          label: 'Aminut (Card)',
          methods: ['card'],
          tags: ['online', 'gateway'],
          aliases: ['Aminut'],
        },
      ],
    },
    {
      id: 'tranzila',
      display_name: 'Tranzila',
      primary_country: 'IL',
      groups: ['israel_providers'],
      type: 'payment_gateway',
      is_preferred: false,
      requiredFields: [
        { name: 'terminal_name', label: 'Terminal Name' },
        { name: 'tranzila_pw', label: 'Tranzila Password' },
        { name: 'currency', label: 'Currency (ILS/USD/EUR)' },
      ],
      channels: [
        {
          id: 'tranzila_card',
          label: 'Tranzila (Card)',
          methods: ['card'],
          tags: ['online', 'gateway'],
          aliases: ['Tranzila'],
        },
        {
          id: 'tranzila_bit',
          label: 'Tranzila Bit',
          methods: ['wallet'],
          tags: ['bit'],
          aliases: ['Tranzila Bit'],
        },
      ],
    },
    {
      id: 'peach',
      display_name: 'Peach',
      primary_country: 'IL',
      groups: ['israel_providers'],
      type: 'payment_gateway',
      is_preferred: false,
      requiredFields: [],
      channels: [
        {
          id: 'peach_card',
          label: 'Peach (Card)',
          methods: ['card'],
          tags: ['online', 'gateway'],
          aliases: ['Peach'],
        },
        {
          id: 'peach_bit',
          label: 'Peach Bit',
          methods: ['wallet'],
          tags: ['bit'],
          aliases: ['Peach Bit'],
        },
      ],
    },
    {
      id: 'gama',
      display_name: 'Gama',
      primary_country: 'IL',
      groups: ['israel_providers'],
      type: 'payment_gateway',
      is_preferred: false,
      requiredFields: [],
      channels: [
        {
          id: 'gama_card',
          label: 'Gama (Card)',
          methods: ['card'],
          tags: ['online', 'gateway'],
          aliases: ['Gama'],
        },
        {
          id: 'gama_bit',
          label: 'Gama Bit',
          methods: ['wallet'],
          tags: ['bit'],
          aliases: ['Gama Bit'],
        },
      ],
    },
    {
      id: 'kehilot',
      display_name: 'Kehilot',
      primary_country: 'IL',
      groups: ['israel_providers'],
      type: 'payment_gateway',
      is_preferred: false,
      requiredFields: [],
      channels: [
        {
          id: 'kehilot_card',
          label: 'Kehilot (Card)',
          methods: ['card'],
          tags: ['online', 'gateway'],
          aliases: ['Kehilot'],
        },
        {
          id: 'kehilot_bit',
          label: 'Kehilot Bit',
          methods: ['wallet'],
          tags: ['bit'],
          aliases: ['Kehilot Bit'],
        },
      ],
    },
    {
      id: 'powerdoc',
      display_name: 'Powerdoc',
      primary_country: 'IL',
      groups: ['israel_providers'],
      type: 'payment_gateway',
      is_preferred: false,
      requiredFields: [],
      channels: [
        {
          id: 'powerdoc_direct_debit',
          label: 'Powerdoc Direct Debit',
          methods: ['direct_debit'],
          tags: ['direct_debit'],
          aliases: ['Powerdoc Direct Debit'],
        },
      ],
    },
    {
      id: 'sumit',
      display_name: 'Sumit',
      primary_country: 'IL',
      groups: ['israel_providers'],
      type: 'payment_gateway',
      is_preferred: false,
      requiredFields: [],
      channels: [
        {
          id: 'sumit_card',
          label: 'Sumit (Card)',
          methods: ['card'],
          tags: ['online', 'gateway'],
          aliases: ['Sumit'],
        },
      ],
    },
    // US providers
    {
      id: 'stripe',
      display_name: 'Stripe',
      primary_country: 'US',
      groups: ['usa_providers'],
      type: 'payment_gateway',
      is_preferred: true,
      requiredFields: [], // OAuth
      channels: [
        {
          id: 'stripe_standard',
          label: 'Stripe (Standard)',
          methods: ['card'],
          tags: ['online', 'gateway'],
          aliases: ['Stripe'],
        },
        {
          id: 'stripe_elements',
          label: 'Stripe Elements',
          methods: ['card'],
          tags: ['elements', 'hosted_fields'],
          aliases: ['Stripe Element'],
        },
        {
          id: 'stripe_apple_google_pay',
          label: 'Stripe Apple / Google Pay',
          methods: ['wallet'],
          tags: ['apple_pay', 'google_pay', 'wallet'],
          aliases: ['Stripe Apple / Google Pay'],
        },
        {
          id: 'stripe_ideal',
          label: 'Stripe iDEAL',
          methods: ['bank_transfer'],
          tags: ['ideal', 'eu'],
          aliases: ['Stripe iDEAL'],
        },
        {
          id: 'stripe_becs',
          label: 'Stripe BECS Direct Debit',
          methods: ['direct_debit'],
          tags: ['becs', 'direct_debit', 'au'],
          aliases: ['Stripe BECS'],
        },
      ],
    },
    {
      id: 'authorize_net',
      display_name: 'Authorize.net',
      primary_country: 'US',
      groups: ['usa_providers'],
      type: 'payment_gateway',
      is_preferred: true,
      requiredFields: [
        { name: 'api_login_id', label: 'API Login ID' },
        { name: 'transaction_key', label: 'Transaction Key' },
      ],
      channels: [
        {
          id: 'authorize_net_card',
          label: 'Authorize.net (Card)',
          methods: ['card'],
          tags: ['online', 'gateway'],
          aliases: ['Authorize.net'],
        },
      ],
    },
    {
      id: 'cardknox_sola',
      display_name: 'Cardknox / Sola',
      primary_country: 'US',
      groups: ['usa_providers'],
      type: 'payment_gateway',
      is_preferred: true,
      requiredFields: [],
      channels: [
        {
          id: 'cardknox_sola_card',
          label: 'Cardknox / Sola (Card)',
          methods: ['card'],
          tags: ['online', 'gateway'],
          aliases: ['Cardknox/Sola'],
        },
      ],
    },
    {
      id: 'paypal',
      display_name: 'PayPal',
      primary_country: 'US',
      groups: ['usa_providers'],
      type: 'wallet',
      is_preferred: true,
      requiredFields: [],
      channels: [
        {
          id: 'paypal_wallet',
          label: 'PayPal',
          methods: ['wallet'],
          tags: ['wallet', 'online'],
          aliases: ['PayPal'],
        },
      ],
    },
    {
      id: 'venmo',
      display_name: 'Venmo',
      primary_country: 'US',
      groups: ['usa_providers'],
      type: 'wallet',
      is_preferred: true,
      requiredFields: [],
      channels: [
        {
          id: 'venmo_wallet',
          label: 'Venmo',
          methods: ['wallet'],
          tags: ['wallet', 'p2p'],
          aliases: ['Venmo'],
        },
      ],
    },
    // Additional providers (abbreviated for space - include all from schema)
    {
      id: 'banquest',
      display_name: 'Banquest',
      primary_country: 'US',
      groups: ['usa_providers', 'other'],
      type: 'payment_gateway',
      is_preferred: true,
      requiredFields: [],
      channels: [
        {
          id: 'banquest_card',
          label: 'Banquest (Gateway)',
          methods: ['card'],
          tags: ['online', 'gateway'],
          aliases: ['Banquest'],
        },
      ],
    },
    // Note: Add remaining providers from schema as needed
  ],
};

/**
 * Get default payment gateways for a country
 */
export function getDefaultGateways(country: 'IL' | 'US'): string[] {
  if (country === 'IL') {
    return ['meshulam', 'cardcom']; // Always 2 for backup in Israel
  }
  return ['stripe']; // US default
}

/**
 * Normalize gateway name to provider ID
 * Checks against provider IDs, display names, and aliases
 */
export function normalizeGatewayName(gatewayName: string): string | null {
  if (!gatewayName) return null;

  const normalized = gatewayName.toLowerCase().trim();

  for (const provider of GATEWAY_SCHEMA.providers) {
    // Check provider ID
    if (provider.id.toLowerCase() === normalized) {
      return provider.id;
    }

    // Check display name
    if (provider.display_name.toLowerCase() === normalized) {
      return provider.id;
    }

    // Check aliases
    for (const channel of provider.channels) {
      for (const alias of channel.aliases) {
        if (alias.toLowerCase() === normalized) {
          return provider.id;
        }
      }
    }
  }

  return null;
}

/**
 * Check if a gateway is supported
 */
export function isGatewaySupported(gatewayName: string): boolean {
  return normalizeGatewayName(gatewayName) !== null;
}

/**
 * Find similar gateways to suggest as alternatives
 * Returns 2 most similar provider IDs based on fuzzy matching
 */
export function findSimilarGateways(gatewayName: string, country: 'IL' | 'US'): string[] {
  if (!gatewayName) {
    return getDefaultGateways(country);
  }

  const normalized = gatewayName.toLowerCase().trim();
  const countryGroup = country === 'IL' ? 'israel_providers' : 'usa_providers';

  // Filter providers by country
  const countryProviders = GATEWAY_SCHEMA.providers.filter(
    (p) => p.primary_country === country || p.groups.includes(countryGroup),
  );

  // Calculate similarity scores
  const scores: Array<{ provider: PaymentGatewayProvider; score: number }> = [];

  for (const provider of countryProviders) {
    let score = 0;

    // Check display name similarity (simple substring/contains match)
    const displayNameLower = provider.display_name.toLowerCase();
    if (displayNameLower.includes(normalized) || normalized.includes(displayNameLower)) {
      score += 0.5;
    }

    // Check if any word matches
    const normalizedWords = normalized.split(/\s+/);
    const displayWords = displayNameLower.split(/\s+/);
    const matchingWords = normalizedWords.filter((word) =>
      displayWords.some((dw) => dw.includes(word) || word.includes(dw)),
    );
    score += (matchingWords.length / Math.max(normalizedWords.length, displayWords.length)) * 0.3;

    // Check aliases
    for (const channel of provider.channels) {
      for (const alias of channel.aliases) {
        const aliasLower = alias.toLowerCase();
        if (aliasLower.includes(normalized) || normalized.includes(aliasLower)) {
          score += 0.2;
          break;
        }
      }
    }

    if (score > 0) {
      scores.push({ provider, score });
    }
  }

  // Sort by score and return top 2
  scores.sort((a, b) => b.score - a.score);

  if (scores.length >= 2) {
    return [scores[0].provider.id, scores[1].provider.id];
  } else if (scores.length === 1) {
    // If only one match, add default as second
    const defaults = getDefaultGateways(country);
    return [scores[0].provider.id, defaults[0]];
  }

  // No good matches, return defaults
  return getDefaultGateways(country);
}

/**
 * Get provider display name by ID
 */
export function getProviderDisplayName(providerId: string): string | null {
  const provider = GATEWAY_SCHEMA.providers.find((p) => p.id === providerId);
  return provider?.display_name || null;
}

/**
 * Get full supported gateway list
 */
export function getSupportedGateways(): PaymentGatewayProvider[] {
  return GATEWAY_SCHEMA.providers;
}

/**
 * Get gateway configuration by ID
 */
export function getGatewayConfig(providerId: string): PaymentGatewayProvider | null {
  return GATEWAY_SCHEMA.providers.find((p) => p.id === providerId) || null;
}
