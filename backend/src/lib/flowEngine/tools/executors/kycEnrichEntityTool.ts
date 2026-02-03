import { ToolExecutor } from '../types';
import { flowHelpers } from '../../flowHelpers';
import { logger } from '../../../../utils/logger';
import { prisma } from '../../../../core';
import { OrganisationRegion } from '../../../../types/kycOrganisation';

export const kycEnrichEntityTool: ToolExecutor = async (payload, { conversationId }) => {
  try {
    // 1. Resolve User and Flow
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

    // 2. Get tax ID from userData (should be there from previous step)
    const regNum = userData.entity_tax_id as string;

    if (!regNum) {
      return { success: false, error: 'No entity tax ID found in context' };
    }

    // 3. Find OrganisationInfo in DB
    // We try to match by einOrRegNum.
    // nonprofit.lookup tool saves it with standard formatting.
    // We try exact match or simplified.

    const simpleRegNum = regNum.replace(/\D/g, '');
    // Usually lookup tool does: einOrRegNum.replace(/\D/g, '') for lookup

    const orgInfo = await prisma.organisationInfo.findFirst({
      where: {
        OR: [
          { einOrRegNum: regNum },
          { einOrRegNum: simpleRegNum },
        ],
      },
    });

    if (!orgInfo || !orgInfo.data) {
      return {
        success: true,
        message: 'No enrichment data found',
        data: { enriched: false },
      };
    }

    const data = orgInfo.data as any;
    const enrichedFields: any = {};

    // 4. Map fields based on region/data structure
    if (orgInfo.region === OrganisationRegion.Israel) {
      // Guidestar mapping
      // Fields usually: addressCity, fullAddress, addressZipCode
      const city = data.addressCity || data.city;
      if (city) enrichedFields.entity_city = city;

      const address = data.fullAddress || data.addressStreet || data.street || data.address;
      if (address) {
        // Clean up address if it contains duplicate city info or needs formatting
        enrichedFields.entity_address_line_1 = address;
      }

      const zip = data.addressZipCode || data.zip_code || data.zip;
      if (zip) enrichedFields.entity_zip = zip;

      enrichedFields.entity_country = 'IL';
      if (data.name) enrichedFields.entity_name = data.name; // Use official name if available

    } else if (orgInfo.region === OrganisationRegion.USA) {
      // CharityAPI / USA mapping
      // Fields usually: street, city, state, zip
      if (data.city) enrichedFields.entity_city = data.city;
      if (data.street) enrichedFields.entity_address_line_1 = data.street;
      if (data.zip) enrichedFields.entity_zip = data.zip;
      if (data.state) enrichedFields.entity_state = data.state;
      enrichedFields.entity_country = 'US';
      if (data.name) enrichedFields.entity_name = data.name;
    }

    // 5. Save to userData
    await flowHelpers.setUserData(userId, flowId, enrichedFields, conversationId);

    return {
      success: true,
      data: {
        enriched: true,
        fields: enrichedFields,
      },
    };

  } catch (error: any) {
    logger.error('[kycEnrichEntityTool] Error', error);
    return {
      success: false,
      error: error.message,
    };
  }
};
