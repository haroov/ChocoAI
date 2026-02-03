import { OrganisationInfo } from '@prisma/client';
import { ToolExecutor } from '../types';
import { config as envConfig, prisma } from '../../../../core';
import { trackApiCall } from '../../../../utils/trackApiCall';
import { logger } from '../../../../utils/logger';
import { flowHelpers } from '../../flowHelpers';
import { GuidestarOrganisation, OrganisationRegion, USAOrganisation } from '../../../../types/kycOrganisation';

type LookupProvider = 'Guidestar' | 'CharityAPI' | 'cache';

type OrgLookupResult = {
  organisation: OrganisationInfo;
  provider: LookupProvider;
};

type RawPhoneHint = {
  raw?: string;
  digits?: string;
  language?: string;
};

const parsePhoneCountryHint = (rawHint: unknown): RawPhoneHint | null => {
  if (!rawHint) return null;

  if (typeof rawHint === 'string') {
    try {
      const parsed = JSON.parse(rawHint);
      if (parsed && typeof parsed === 'object') {
        return {
          raw: typeof parsed.raw === 'string' ? parsed.raw : undefined,
          digits: typeof parsed.digits === 'string' ? parsed.digits : undefined,
          language: typeof parsed.language === 'string' ? parsed.language : undefined,
        };
      }
    } catch {
      // Fallback: treat the raw string as the actual phone input
      return {
        raw: rawHint,
        digits: rawHint.replace(/\D/g, ''),
      };
    }
  }

  if (typeof rawHint === 'object') {
    const parsed = rawHint as Record<string, unknown>;
    return {
      raw: typeof parsed.raw === 'string' ? parsed.raw : undefined,
      digits: typeof parsed.digits === 'string' ? parsed.digits : undefined,
      language: typeof parsed.language === 'string' ? parsed.language : undefined,
    };
  }

  return null;
};

const detectRegionFromPhone = (hint: RawPhoneHint | null, fallbackPhone?: string): OrganisationRegion | undefined => {
  const raw = hint?.raw ?? fallbackPhone ?? '';
  const digitsOnly = (hint?.digits ?? raw.replace(/\D/g, '')).replace(/\s+/g, '');
  if (!raw && !digitsOnly) return undefined;

  const digitsWithoutIntl = digitsOnly.replace(/^00/, '');
  const normalizedRaw = raw.replace(/\s+/g, '');

  const hasIsraeliCountryCode = /^(\+?972|00972)/.test(normalizedRaw) || digitsWithoutIntl.startsWith('972');
  const hasIsraeliDomesticPrefix = /^0\d{8,10}$/.test(digitsOnly);

  if (hasIsraeliCountryCode || hasIsraeliDomesticPrefix) {
    return OrganisationRegion.Israel;
  }

  const hasUsCountryCode = /^(\+?1|001)/.test(normalizedRaw);
  if (hasUsCountryCode) {
    return OrganisationRegion.USA;
  }

  if (digitsWithoutIntl.length === 11 && digitsWithoutIntl.startsWith('1')) {
    return OrganisationRegion.USA;
  }

  if (digitsWithoutIntl.length === 10 && !digitsWithoutIntl.startsWith('0')) {
    return OrganisationRegion.USA;
  }

  return undefined;
};

const detectRegionFromRegNum = (regNum?: string): OrganisationRegion | undefined => {
  if (!regNum || typeof regNum !== 'string') return undefined;
  const trimmed = regNum.trim();
  if (!trimmed) return undefined;

  if (/^\d{2}-\d{7}$/.test(trimmed)) {
    return OrganisationRegion.USA;
  }

  if (/[א-ת]/.test(trimmed) || /(ח\.?פ|ע\"?ר)/i.test(trimmed)) {
    return OrganisationRegion.Israel;
  }

  return undefined;
};

/**
 * Compares two organization names to determine if they refer to the same organization
 * Extracts key keywords (location, business type) and calculates similarity score
 */
function compareOrganizationNames(
  userProvidedName: string,
  lookupName: string,
): { isSimilar: boolean; confidence: number; shouldVerify: boolean } {
  if (!userProvidedName || !lookupName) {
    return { isSimilar: false, confidence: 0, shouldVerify: true };
  }

  // Normalize names: lowercase, remove extra spaces, remove common suffixes
  const normalize = (name: string) => name
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s*(ע"ר|ע.ר.|עמ"ר|עמ.ר.|ltd|llc|inc|corp|corporation)\s*$/gi, '')
    .trim();

  const normalizedUser = normalize(userProvidedName);
  const normalizedLookup = normalize(lookupName);

  // Exact match after normalization
  if (normalizedUser === normalizedLookup) {
    return { isSimilar: true, confidence: 1.0, shouldVerify: false };
  }

  // Extract keywords: location names, business type indicators
  const extractKeywords = (name: string): { locations: string[]; businessTypes: string[]; other: string[] } => {
    const locations: string[] = [];
    const businessTypes: string[] = [];
    const other: string[] = [];

    // Common location patterns (Hebrew and English)
    const locationPatterns = [
      /\b(תל אביב|תל-אביב|תל אביב יפו|יפו|ירושלים|חיפה|באר שבע|רמת גן|פתח תקווה|נתניה|אשדוד|בני ברק|רמת השרון|הרצליה|רעננה|כפר סבא|רחובות|אשקלון|לוד|רמלה|טבריה|צפת|עכו|נצרת|אילת|דימונה|קריית גת|קריית שמונה|קריית מלאכי|קריית ארבע|קריית אונו|קריית ביאליק|קריית טבעון|קריית ים|קריית מוצקין|קריית עקרון|קריית שמואל)\b/gi,
      /\b(tel aviv|jerusalem|haifa|beer sheva|ramat gan|petah tikva|netanya|ashdod|bnei brak|ramat hasharon|herzliya|raanana|kfar saba|rehovot|ashkelon|lod|ramla|tiberias|safed|acre|nazareth|eilat|dimona)\b/gi,
    ];

    // Common business type patterns
    const businessTypePatterns = [
      /\b(בית כנסת|בית-כנסת|כנסייה|כנסיה|מסגד|מרכז|עמותה|ארגון|קרן|קרן|foundation|synagogue|church|mosque|center|organization|nonprofit|charity|foundation)\b/gi,
    ];

    // Extract locations
    locationPatterns.forEach((pattern) => {
      const matches = name.match(pattern);
      if (matches) {
        locations.push(...matches.map((m) => m.toLowerCase()));
      }
    });

    // Extract business types
    businessTypePatterns.forEach((pattern) => {
      const matches = name.match(pattern);
      if (matches) {
        businessTypes.push(...matches.map((m) => m.toLowerCase()));
      }
    });

    // Extract other significant words (2+ characters, not common words)
    const commonWords = new Set(['בית', 'של', 'את', 'על', 'את', 'the', 'of', 'and', 'a', 'an', 'in', 'on', 'at', 'to', 'for']);
    const words = name
      .split(/\s+/)
      .map((w) => w.toLowerCase().replace(/[^\u0590-\u05FFa-z0-9]/g, ''))
      .filter((w) => w.length >= 2 && !commonWords.has(w));
    other.push(...words);

    return { locations, businessTypes, other };
  };

  const userKeywords = extractKeywords(normalizedUser);
  const lookupKeywords = extractKeywords(normalizedLookup);

  // Calculate similarity scores
  let score = 0;
  let maxScore = 0;

  // Location match (high weight)
  const userLocations = new Set(userKeywords.locations);
  const lookupLocations = new Set(lookupKeywords.locations);
  const locationOverlap = [...userLocations].filter((loc) => lookupLocations.has(loc)).length;
  const locationTotal = Math.max(userLocations.size, lookupLocations.size, 1);
  const locationScore = locationOverlap / locationTotal;
  score += locationScore * 0.4; // 40% weight
  maxScore += 0.4;

  // Business type match (high weight)
  const userTypes = new Set(userKeywords.businessTypes);
  const lookupTypes = new Set(lookupKeywords.businessTypes);
  const typeOverlap = [...userTypes].filter((type) => lookupTypes.has(type)).length;
  const typeTotal = Math.max(userTypes.size, lookupTypes.size, 1);
  const typeScore = typeOverlap / typeTotal;
  score += typeScore * 0.4; // 40% weight
  maxScore += 0.4;

  // Other keywords match (lower weight)
  const userOther = new Set(userKeywords.other);
  const lookupOther = new Set(lookupKeywords.other);
  const otherOverlap = [...userOther].filter((word) => lookupOther.has(word)).length;
  const otherTotal = Math.max(userOther.size, lookupOther.size, 1);
  const otherScore = otherOverlap / otherTotal;
  score += otherScore * 0.2; // 20% weight
  maxScore += 0.2;

  // Normalize score
  const confidence = maxScore > 0 ? score / maxScore : 0;

  // Determine if similar and if verification needed
  const isSimilar = confidence >= 0.5; // At least 50% similarity
  const shouldVerify = confidence < 0.7; // Verify if confidence is below 70%

  return { isSimilar, confidence, shouldVerify };
}

let sessionId: string | undefined;

const getGuidestarToken = async () => {
  if (sessionId) return sessionId;

  const authToken = await prisma.authToken.findUnique({ where: { target: 'guidestar' } });
  sessionId = authToken?.value;
  return sessionId;
};

const obtainGuidestarToken = async (conversationId: string) => {
  sessionId = '';
  try {
    const res = await trackApiCall(
      conversationId,
      'Guidestar',
      'organization-login',
      {
        payload: {
          username: envConfig.guidestar.username,
          password: '********',
        },
        meta: {
          method: 'POST',
          endpoint: 'https://www.guidestar.org.il/services/apexrest/api/login',
        },
      },
      async () => fetch('https://www.guidestar.org.il/services/apexrest/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: envConfig.guidestar.username, password: envConfig.guidestar.password }),
      }).then((res) => res.json()),
    );

    sessionId = res.sessionId;

    await prisma.authToken.upsert({
      where: { target: 'guidestar' },
      update: { value: res.sessionId },
      create: { target: 'guidestar', value: res.sessionId },
    });

    return sessionId;
  } catch (e) {
    logger.error('Failed to obtain Guidestar token:', e);
    throw new Error('Failed to obtain Guidestar token');
  }
};

const getInfoFromGuidestar = async (conversationId: string, einOrRegNum: string) => {
  let authToken = await getGuidestarToken();
  let isTokenFromCache = !!authToken;
  if (!authToken) {
    authToken = await obtainGuidestarToken(conversationId);
    isTokenFromCache = false;
  }

  const endpoint = `https://www.guidestar.org.il/services/apexrest/api/organizations/${einOrRegNum}?fullObject=true`;

  return trackApiCall(
    conversationId,
    'Guidestar',
    'organization-lookup',
    {
      payload: {},
      meta: {
        method: 'GET',
        endpoint,
        headers: { Authorization: 'Bearer [session id]' },
      },
    },
    async () => {
      let res = await fetch(endpoint, { headers: { Authorization: `Bearer ${authToken}` } });

      if (res.status === 401 && isTokenFromCache) {
        authToken = await obtainGuidestarToken(conversationId);
        res = await fetch(endpoint, { headers: { Authorization: `Bearer ${authToken}` } });
      }

      const { status } = res;
      const data = await res.json();

      if (status === 200) {
        return prisma.organisationInfo.upsert({
          where: { einOrRegNum_region: { einOrRegNum, region: OrganisationRegion.Israel } },
          update: { data },
          create: { einOrRegNum, region: OrganisationRegion.Israel, data },
        });
      }

      throw data;
    },
  );
};

const getInfoFromCharityAPI = async (conversationId: string, ein: string) => {
  const endpoint = `https://api.charityapi.org/api/organizations/${ein}`;

  return trackApiCall(
    conversationId,
    'Charity API',
    'organization-lookup',
    {
      payload: {},
      meta: {
        method: 'GET',
        endpoint,
        headers: { apikey: '[charity API key]' },
      },
    },
    async () => {
      const res = await fetch(endpoint, { headers: { apiKey: envConfig.charityApiKey } });

      const { status } = res;
      const data = await res.json();

      if (status === 200) {
        return prisma.organisationInfo.upsert({
          where: { einOrRegNum_region: { einOrRegNum: ein, region: OrganisationRegion.USA } },
          update: { data: data.data },
          create: { einOrRegNum: ein, region: OrganisationRegion.USA, data: data.data },
        });
      }

      throw data;
    },
  );
};

const requestOrgInfo = async (
  conversationId: string,
  einOrRegNum: string,
  preferRegion: OrganisationRegion | undefined,
  providerAttempts: LookupProvider[],
): Promise<OrgLookupResult> => {
  const ein = `${einOrRegNum.slice(0, 2)}-${einOrRegNum.slice(2)}`;
  const organisations = await prisma.organisationInfo.findMany({
    where: {
      OR: [{ einOrRegNum }, { einOrRegNum: ein }],
    },
  });

  if (organisations.length === 1) {
    return { organisation: organisations[0], provider: 'cache' };
  }
  // If multiple organizations found in DB, prefer Israel organization, otherwise return first
  if (organisations.length > 1) {
    const israelOrg = organisations.find((org) => org.region === OrganisationRegion.Israel);
    const selectedOrg = israelOrg || organisations[0];
    return { organisation: selectedOrg, provider: 'cache' };
  }

  const attemptGuidestar = async (): Promise<OrgLookupResult> => {
    providerAttempts.push('Guidestar');
    const organisation = await getInfoFromGuidestar(conversationId, einOrRegNum);
    return { organisation, provider: 'Guidestar' };
  };

  const attemptCharityApi = async (): Promise<OrgLookupResult> => {
    providerAttempts.push('CharityAPI');
    const organisation = await getInfoFromCharityAPI(conversationId, ein);
    return { organisation, provider: 'CharityAPI' };
  };

  const preferredOrder: LookupProvider[] = (() => {
    if (preferRegion === OrganisationRegion.Israel) return ['Guidestar', 'CharityAPI'];
    if (preferRegion === OrganisationRegion.USA) return ['CharityAPI', 'Guidestar'];
    return ['Guidestar', 'CharityAPI'];
  })();

  const uniqueOrder = preferredOrder.filter((provider, index, arr) => arr.indexOf(provider) === index);

  let lastError: unknown;

  for (const provider of uniqueOrder) {
    try {
      if (provider === 'Guidestar') {
        return await attemptGuidestar();
      }
      if (provider === 'CharityAPI') {
        return await attemptCharityApi();
      }
    } catch (error) {
      lastError = error;
      logger.debug('Nonprofit lookup provider failed', {
        provider,
        preferRegion,
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Organization not found');
};

export const nonprofitLookupTool: ToolExecutor = async (payload, { conversationId }) => {
  try {
    const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conversation) throw new Error('Conversation not found');
    if (!conversation.userId) throw new Error('User not found in conversation');
    // Check payload first, then fallback to userData (for multi-stage flows)
    let regNumInput = payload.regNum || payload.entity_tax_id;
    if (!regNumInput) {
      // IMPORTANT: We must read the value from the CURRENT flow.
      // Never query user_data without flowId (can accidentally pick unrelated values like OTP codes).
      const activeFlow = await prisma.userFlow.findUnique({
        where: { userId: conversation.userId },
        select: { flowId: true },
      });

      let flowId = activeFlow?.flowId;
      if (!flowId) {
        const lastFlow = await prisma.flowHistory.findFirst({
          where: { userId: conversation.userId },
          orderBy: { completedAt: 'desc' },
          select: { flowId: true },
        });
        flowId = lastFlow?.flowId;
      }

      if (flowId) {
        const storedTaxId = await prisma.userData.findFirst({
          where: {
            userId: conversation.userId,
            flowId,
            key: { in: ['entity_tax_id', 'regNum'] },
          },
        });
        if (storedTaxId?.value) regNumInput = storedTaxId.value;
      }
    }

    if (!regNumInput) throw new Error('Neither a registration number nor an EIN was provided');

    const einOrRegNum = (regNumInput as string).replace(/\D/g, '');

    logger.info('[nonprofitLookupTool] Validation Debug', {
      originalInput: regNumInput,
      processed: einOrRegNum,
      length: einOrRegNum.length,
      regexMatch: /^\d{9}$/.test(einOrRegNum),
    });

    if (!/^\d{9}$/.test(einOrRegNum)) throw new Error(`Invalid EIN/registration number format. Input: "${regNumInput}", Processed: "${einOrRegNum}"`);

    const phoneHint = parsePhoneCountryHint(payload.raw_phone_country_hint);
    const normalizedPhone = typeof payload.phone === 'string' ? payload.phone : undefined;
    const rawRegNumInput = typeof regNumInput === 'string' ? regNumInput : undefined;

    // Check conversation language (Hebrew = Israel, English = US)
    const recentMessages = await prisma.message.findMany({
      where: { conversationId, role: 'user' },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { content: true },
    });
    const hasHebrew = recentMessages.some((msg) => /[\u0590-\u05FF]/.test(msg.content));

    const phoneRegion = detectRegionFromPhone(phoneHint, normalizedPhone);
    const regNumRegion = detectRegionFromRegNum(rawRegNumInput);

    // Determine preferred region based on raw phone/regNum hints, falling back to language
    let preferRegion: OrganisationRegion | undefined = phoneRegion || regNumRegion;
    if (!preferRegion) {
      preferRegion = (phoneHint?.language === 'he' || hasHebrew) ? OrganisationRegion.Israel : OrganisationRegion.USA;
    }

    const providerAttempts: LookupProvider[] = [];
    const { organisation: orgInfo, provider: selectedProvider } = await requestOrgInfo(
      conversationId,
      einOrRegNum,
      preferRegion,
      providerAttempts,
    );

    // Compare user-provided organization name with lookup result
    const userProvidedName = payload.organization_name as string | undefined;
    const lookupOrgData = orgInfo.data as GuidestarOrganisation | USAOrganisation;
    let lookupName = '';
    if (lookupOrgData) {
      if ('name' in lookupOrgData) {
        lookupName = lookupOrgData.name || '';
      } else if ('fullName' in lookupOrgData) {
        lookupName = (lookupOrgData as GuidestarOrganisation).fullName || '';
      }
    }

    let nameMatch: 'similar' | 'different' | 'not_provided' = 'not_provided';
    let orgNameVerificationNeeded = false;

    if (userProvidedName && lookupName) {
      const comparison = compareOrganizationNames(userProvidedName, lookupName);

      if (comparison.isSimilar && comparison.confidence > 0.7) {
        // High confidence - use lookup name (override user name)
        nameMatch = 'similar';
        orgNameVerificationNeeded = false;
      } else if (comparison.isSimilar && comparison.confidence >= 0.5) {
        // Medium confidence - similar but should verify
        nameMatch = 'similar';
        orgNameVerificationNeeded = true;
      } else {
        // Low confidence - different organization
        nameMatch = 'different';
        orgNameVerificationNeeded = true;
      }
    } else if (userProvidedName && !lookupName) {
      // User provided name but lookup didn't return one
      nameMatch = 'not_provided';
      orgNameVerificationNeeded = false;
    }

    // Save the organization data
    await prisma.userOrganisation.upsert({
      where: { userId_organisationId: { userId: conversation.userId, organisationId: orgInfo.id } },
      update: { userId: conversation.userId, organisationId: orgInfo.id },
      create: { userId: conversation.userId, organisationId: orgInfo.id },
    });

    // Return success with name matching information
    return {
      success: true,
      data: orgInfo,
      saveResults: {
        nameMatch,
        org_name_verification_needed: orgNameVerificationNeeded,
        user_provided_name: userProvidedName,
        lookup_name: lookupName,
        lookup_provider_attempts: JSON.stringify(providerAttempts),
        lookup_provider_used: selectedProvider,
        lookup_preferred_region: preferRegion || 'undetermined',
      },
    };
  } catch (error: any) {
    // Only return failure if organization was truly not found
    const errorMessage = error?.message || 'Failed to extract organization info';
    if (errorMessage.includes('Organization not found')) {
      return {
        success: false,
        error: errorMessage,
      };
    }

    // For any other error, log it and return failure
    // This should not happen now that we handle multiple organizations gracefully
    logger.error('Nonprofit lookup tool error:', errorMessage, error);
    return {
      success: false,
      error: errorMessage,
    };
  }
};
