import { ToolExecutor } from '../types';
import { flowHelpers } from '../../flowHelpers';
import { logger } from '../../../../utils/logger';
import { prisma } from '../../../../core'; // For context/fuzzy matching if needed?

export const resolveEntitySelectionTool: ToolExecutor = async (payload, { conversationId }) => {
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { userId: true },
    });

    if (!conversation?.userId) {
      return { success: false, error: 'User not found in conversation' };
    }
    const { userId } = conversation;

    const userFlow = await prisma.userFlow.findUnique({
      where: { userId },
    });
    const flowId = userFlow?.flowId || '';

    const userData = await flowHelpers.getUserData(userId, flowId);

    const choice = payload.entity_selection as string;
    const entitiesJson = userData.available_entities_json as string; // THIS is scoped to the selected Org from loadOrgEntitiesTool

    if (!choice) return { success: false, error: 'No selection provided' };
    if (!entitiesJson) return { success: true, data: { isNew: true } }; // No entities in this org -> must be new

    let entities: any[] = [];
    try {
      entities = JSON.parse(entitiesJson);
    } catch {
      entities = [];
    }

    const normalizeForMatch = (s: string): string => (
      s
        .toLowerCase()
        // Replace punctuation (including Hebrew quotes/dashes) with spaces
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    );

    const tokenize = (s: string): string[] => {
      const normalized = normalizeForMatch(s);
      if (!normalized) return [];
      return normalized
        .split(' ')
        .map((t) => t.trim())
        .filter((t) => t.length >= 2);
    };

    const cleanChoice = normalizeForMatch(choice);
    const choiceTokens = tokenize(choice);

    // Check for "new" keyword
    if (cleanChoice.includes('new') || cleanChoice.includes('create') || cleanChoice.includes('other') || cleanChoice.includes('חדש') || cleanChoice.includes('אחר')) {
      return {
        success: true,
        data: { isNew: true },
      };
    }

    // Matching Logic (Hierarchy: Exact ID -> Exact Name -> Fuzzy Name)
    let matched = entities.find((e: any) => String(e.id) === cleanChoice || String(e.attributes?.id) === cleanChoice);

    if (!matched) {
      matched = entities.find((e: any) => {
        const name = normalizeForMatch(e.attributes?.name || e.name || '');
        return name && name === cleanChoice;
      });
    }

    if (!matched) {
      matched = entities.find((e: any) => {
        const name = normalizeForMatch(e.attributes?.name || e.name || '');
        if (!name || !cleanChoice) return false;
        // Substring match after normalization
        if (name.includes(cleanChoice) || cleanChoice.includes(name)) return true;
        // Token-subset match (handles cases like "ידידים בדרכים" vs "ידידים - סיוע בדרכים")
        const nameTokens = tokenize(name);
        if (choiceTokens.length >= 2 && nameTokens.length >= 2) {
          return choiceTokens.every((t) => nameTokens.includes(t));
        }
        return false;
      });
    }

    if (matched) {
      // Auto-select gateway provider based on country
      const country = String(matched.attributes?.country || matched.country || 'IL').toUpperCase();
      let gatewayProvider = 'stripe';
      if (country === 'IL') gatewayProvider = 'meshulam';
      else if (country === 'US') gatewayProvider = 'stripe';

      const matchedName = matched.attributes?.name || matched.name;
      const matchedId = matched.id || matched.attributes?.id;

      logger.info('[resolveEntitySelectionTool] Debug Match:', {
        name: matchedName,
        id: matchedId,
        idType: typeof matchedId,
        fullObject: matched,
      });

      // Save matched entity details to userData
      // CRITICAL: We do NOT overwrite org_id. We only set entity_id and entity details.
      await flowHelpers.setUserData(userId, flowId, {
        entity_id: String(matchedId),
        selected_entity_id: String(matchedId),
        entity_name: matchedName,
        entity_tax_id: matched.attributes?.tax_id || matched.attributes?.regNum || matched.tax_id || matched.taxId,
        entity_country: country,
        entity_address_line_1: matched.attributes?.address_line_1 || matched.address_line_1 || '',
        entity_city: matched.attributes?.city || matched.city || '',
        entity_zip: matched.attributes?.zip || matched.zip || '',
        gateway_providers: gatewayProvider,
        is_new_entity: 'false',
      }, conversationId);

      logger.info(`[resolveEntitySelectionTool] Selected entity: ${matchedName} (${matchedId}) for Org Context`);

      return {
        success: true,
        data: {
          isNew: false,
          entityId: matchedId,
          entityName: matchedName,
        },
      };
    }

    // If no match found, treat as new entity request with this name
    logger.info(`[resolveEntitySelectionTool] No entity match for "${choice}", treating as new entity name`);

    // Pre-fill entity name for creation flow
    await flowHelpers.setUserData(userId, flowId, { entity_name: choice }, conversationId);

    return {
      success: true,
      data: { isNew: true },
    };

  } catch (error: any) {
    logger.error('[resolveEntitySelectionTool] Error', error);
    return {
      success: false,
      error: error.message,
    };
  }
};
