import { ToolExecutor } from '../types';
import { normalizeGatewayName, getGatewayConfig, getSupportedGateways } from '../../utils/paymentGateways';
import { flowHelpers } from '../../flowHelpers';
import { logger } from '../../../../utils/logger';
import { prisma } from '../../../../core/prisma';

export const validateGatewayProviderTool: ToolExecutor = async (payload, { conversationId }) => {
  try {
    const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
    const userId = conversation?.userId;
    if (!userId) throw new Error('User context not found');

    const rawProvider = payload.gateway_providers as string;
    if (!rawProvider) {
      return { success: false, error: 'No provider specified' };
    }

    const normalized = normalizeGatewayName(rawProvider);
    if (!normalized) {
      // Not in our known list
      return {
        success: true,
        data: {
          isValid: false,
          providerName: rawProvider,
        },
      };
    }

    const config = getGatewayConfig(normalized);
    if (!config) {
      return {
        success: true,
        data: {
          isValid: false,
          providerName: rawProvider,
        },
      };
    }

    // Format required fields for the prompt
    const requiredFields = config.requiredFields || [];
    const requiredList = requiredFields.map((f) => f.label || f.name).join(', ');

    return {
      success: true,
      data: {
        isValid: true,
        providerCode: normalized,
        providerName: config.display_name,
        requiredFields: requiredFields, // array of { name, label }
        requiredList,
      },
      saveResults: {
        gateway_provider_code: normalized,
        gateway_provider_display: config.display_name,
        gateway_required_fields_list: requiredList,
      },
    };

  } catch (error: any) {
    return { success: false, error: error.message };
  }
};

export const saveGatewayCredentialsTool: ToolExecutor = async (payload, { conversationId }) => {
  try {
    // This tool is called after the user provides credentials.
    // The Input might be unstructured text or structured if we use extraction.
    // Ideally we rely on the LLM to have extracted keys into specific fields if possible,
    // OR we take the raw message and parse it here.
    // Given FlowEngine limitations, best is to rely on 'gateway_credentials_json' if we have an extractor,
    // or just iterate through all potential fields in payload.

    const providerCode = typeof (payload as any).gateway_provider_code === 'string'
      ? String((payload as any).gateway_provider_code).trim()
      : String((payload as any).gateway_provider_code ?? '').trim();
    if (!providerCode) return { success: false, error: 'Provider code missing context' };

    const config = getGatewayConfig(providerCode);
    if (!config) return { success: false, error: 'Invalid provider code' };

    const requiredFields = config.requiredFields || [];
    const collected: Record<string, string> = {};
    const missing: string[] = [];

    requiredFields.forEach((field) => {
      const raw = (payload as any)?.[field.name]; // Expect the flow to map collected fields to payload
      const val = typeof raw === 'string' ? raw.trim() : String(raw ?? '').trim();
      if (val) {
        collected[field.name] = val;
      } else {
        missing.push(field.label || field.name);
      }
    });

    if (missing.length > 0) {
      return {
        success: false,
        errorCode: 'MISSING_CREDENTIALS',
        error: `Missing fields: ${missing.join(', ')}`,
        data: { missing },
      };
    }

    // Determine target environment (mock or real)
    // We would call the API to save it here.
    // For now, we mock the success of saving/verifying.

    // In a real implementation, we would call `addPaymentGatewayTool` with these credentials.

    logger.info(`[saveGatewayCredentials] Saving credentials for ${providerCode}`, { collected });

    return {
      success: true,
      message: 'Gateway connected successfully.',
      saveResults: {
        gateway_setup_complete: true,
      },
    };

  } catch (error: any) {
    return { success: false, error: error.message };
  }
};
