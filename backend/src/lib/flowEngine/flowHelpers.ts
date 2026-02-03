/**
 * PROTECTED CORE ENGINE FILE
 *
 * ⚠️ DO NOT MODIFY WITHOUT ARCHITECT APPROVAL
 *
 * This file is part of the core flow engine. Changes here affect all flows.
 *
 * If you need to change behavior:
 * 1. Use flow config (onComplete, completionCondition)
 * 2. Use tool executors (move logic to tools/)
 * 3. Use error handling configs (onError)
 *
 * See: project documentation
 */

import {
  z,
  ZodBoolean,
  ZodEnum,
  ZodNull,
  ZodNumber,
  ZodString,
} from 'zod';
import { switchCaseGuard } from '../../utils/switchCaseGuard';
import { prisma } from '../../core/prisma';
import { GuidestarOrganisation, OrganisationRegion, USAOrganisation } from '../../types/kycOrganisation';
import { FieldDefinition, FieldsExtractionContext, FlowDefinition } from './types';

class FlowHelpers {
  private isAutoPopulating = false;

  extractStageFields(flowDefinition: FlowDefinition, stage: string): Array<[string, FieldDefinition]> {
    const stageFields = flowDefinition.stages[stage]?.fieldsToCollect || [];
    return Object.entries(flowDefinition.fields)
      .filter(([fieldSlug]) => stageFields.includes(fieldSlug));

  }

  generateExtractionContext(fields: FlowDefinition['fields'], stageDescription: string): FieldsExtractionContext {
    const fieldsDescription: Record<string, string> = {};
    const zodSchemaObject: Record<string, z.ZodTypeAny> = {};

    Object.entries(fields).forEach(([key, field]) => {
      const types = [];
      let rule: ZodString | ZodEnum<[string, ...string[]]> | ZodNumber | ZodBoolean | ZodNull;

      switch (field.type) {
        case 'string':
          rule = field.enum ? z.enum(field.enum as never) : z.string();
          break;

        case 'number':
          rule = z.number();
          break;

        case 'boolean':
          rule = z.boolean();
          break;

        default:
          rule = z.null();
          switchCaseGuard(field.type);
      }

      fieldsDescription[key] = field.description;
      zodSchemaObject[key] = rule.nullish();
    });

    return {
      fieldsDescription,
      stageDescription,
      zodSchema: z.object(zodSchemaObject),
    };
  }

  async generateExtraContextForUser(userId: string): Promise<{
    contextString: string | null;
    templateContext: {
      orgName?: string;
      orgGoal?: string;
      orgArea?: string;
      organizationData?: GuidestarOrganisation | USAOrganisation;
    };
  }> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.firstName) {
      return { contextString: null, templateContext: {} };
    }

    const userRelatedOrganisations = await prisma.userOrganisation.findMany({ where: { userId } });
    const organisationIds = userRelatedOrganisations.map((org) => org.organisationId);
    const organisations = await prisma.organisationInfo.findMany({ where: { id: { in: organisationIds } } });

    const context: string[] = [];
    const templateContext: {
      orgName?: string;
      orgGoal?: string;
      orgArea?: string;
      organizationData?: GuidestarOrganisation | USAOrganisation;
    } = {};

    const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ');
    context.push('User:');
    context.push(`- Name: ${fullName}`);
    context.push('');

    if (organisations?.length) {
      context.push(`Organisations (${organisations.length}):`);

      // Use the first organization for template context (primary org)
      const primaryOrg = organisations[0];
      if (primaryOrg?.data) {
        const orgData = primaryOrg.data as GuidestarOrganisation | USAOrganisation;
        const country = primaryOrg.region === OrganisationRegion.USA ? 'USA' : 'Israel';

        context.push(`- ${orgData.name}. ${country}`);

        // Extract template variables from primary organization
        if (primaryOrg.region === OrganisationRegion.Israel) {
          const israelOrg = orgData as GuidestarOrganisation;
          templateContext.orgName = israelOrg.name || israelOrg.fullName || '';
          templateContext.orgGoal = israelOrg.orgGoal || '';
          templateContext.orgArea = israelOrg.activityAreas?.join(', ') ||
            israelOrg.primaryClassifications?.join(', ') || '';
          templateContext.organizationData = israelOrg;
        } else if (primaryOrg.region === OrganisationRegion.USA) {
          const usaOrg = orgData as USAOrganisation;
          templateContext.orgName = usaOrg.name || '';
          // For US orgs, we don't have orgGoal field, so use empty string
          // The organization data will be available in the knowledge base for the AI to use
          templateContext.orgGoal = '';
          templateContext.orgArea = usaOrg.ntee_cd || '';
          templateContext.organizationData = usaOrg;
        }
      }

      // Add remaining organizations to context
      for (let i = 1; i < organisations.length; i++) {
        const org = organisations[i];
        if (org?.data) {
          const orgData = org.data as GuidestarOrganisation | USAOrganisation;
          const country = org.region === OrganisationRegion.USA ? 'USA' : 'Israel';
          context.push(`- ${orgData.name}. ${country}`);
        }
      }
      context.push('');
    }

    // === Assistant hints (compact behavior cues, not a full system prompt) ===
    context.push('AssistantHints:');
    context.push('- PersonalSnippet: If org info exists, add a short warm line like "Oh, {orgName} does wonderful work in {orgGoal}!" If only a short description is known, use it.');
    context.push('- Terminology: Prefer "service" over "flow". Example: "Next, I can guide you through the next service — I\'m here to help you plan and support every step of your campaign, from preparation to launch and beyond."');
    context.push('- Style: Short, warm, natural language. Don\'t ask for info already known from context. Summarize and confirm when helpful.');
    context.push('');

    return {
      contextString: context.join('\n'),
      templateContext,
    };
  }

  async createUser(role: string) {
    return prisma.user.create({ data: { role } });
  }

  /**
   * Normalize phone number to E.164 format with conservative heuristics.
   *
   * Detects Israeli numbers only when a domestic 0 prefix or explicit 972 country code is present
   * and falls back to +1 for NANP-style 10 digit numbers. All other inputs are sanitized and
   * prefixed with '+' without guessing additional locale details.
   *
   * @param phone - Phone number to normalize
   * @returns Normalized phone number in E.164 format (e.g., +972501234567, +12125551234)
   *
   * @example
   * ```typescript
   * normalizePhoneNumber('0501234567'); // Returns '+972501234567'
   * normalizePhoneNumber('2125551234'); // Returns '+12125551234'
   * normalizePhoneNumber('+972501234567'); // Returns '+972501234567' (unchanged)
   * ```
   */
  normalizePhoneNumber(phone: string, _conversationContext?: { messages?: Array<{ content: string; role?: string }> }): string {
    if (!phone || typeof phone !== 'string') return phone;

    const rawInput = phone.trim();
    if (!rawInput) return phone;

    // Remove all non-digit characters except +
    let cleaned = rawInput.replace(/[^\d+]/g, '');
    if (!cleaned) return phone;

    // Handle numbers that start with +00 (e.g., +00972...)
    if (cleaned.startsWith('+00')) {
      cleaned = `+${cleaned.slice(3)}`;
    }

    const digitsOnly = cleaned.replace(/\D/g, '');
    const digitsWithoutIntl = digitsOnly.replace(/^00/, '');

    const formatIsraeliNumber = (): string | null => {
      if (!digitsWithoutIntl) return null;

      if (digitsWithoutIntl.startsWith('972')) {
        const subscriber = digitsWithoutIntl.slice(3).replace(/^0+/, '');
        if (subscriber.length >= 7) {
          return `+972${subscriber}`;
        }
      }

      const nationalDigits = cleaned.startsWith('0') ? cleaned : digitsOnly;
      if (/^0\d{8,10}$/.test(nationalDigits)) {
        const subscriber = nationalDigits.replace(/^0+/, '');
        if (subscriber.length >= 7) {
          return `+972${subscriber}`;
        }
      }

      return null;
    };

    const israeliFormatted = formatIsraeliNumber();
    if (israeliFormatted) {
      return israeliFormatted;
    }

    // If already in E.164 format (starts with + and valid digits), return as-is
    if (cleaned.startsWith('+') && /^\+\d{6,15}$/.test(cleaned)) {
      return cleaned;
    }

    // US number detection: 11 digits starting with 1 (country code) or bare 10 digits
    if (digitsWithoutIntl.length === 11 && digitsWithoutIntl.startsWith('1')) {
      return `+${digitsWithoutIntl}`;
    }

    if (digitsWithoutIntl.length === 10 && !cleaned.startsWith('0')) {
      return `+1${digitsWithoutIntl}`;
    }

    // Return best-effort sanitized number with +
    if (cleaned.startsWith('+')) {
      return cleaned;
    }

    return digitsWithoutIntl ? `+${digitsWithoutIntl}` : rawInput;
  }

  /**
   * Save user data to the database
   *
   * This function handles normalization of phone numbers, date formatting, and auto-population
   * of entity fields when entity_type is set to PRIMARY_ORG.
   *
   * @param userId - User ID
   * @param flowId - Flow ID
   * @param data - Data to save (key-value pairs)
   * @param conversationId - Optional conversation ID for context (used for phone normalization and date parsing)
   *
   * @example
   * ```typescript
   * await flowHelpers.setUserData(
   *   userId,
   *   flowId,
   *   {
   *     first_name: 'John',
   *     email: 'john@example.com',
   *     phone: '0501234567', // Will be normalized to +972501234567
   *   },
   *   conversationId
   * );
   * ```
   *
   * Special handling:
   * - Phone numbers are normalized to E.164 format
   * - Dates are parsed and formatted to ISO 8601
   * - Empty strings, null, and undefined values are skipped
   * - Entity fields are auto-populated when entity_type is PRIMARY_ORG
   */
  async setUserData(userId: string, flowId: string, data: Record<string, unknown>, conversationId?: string) {
    const userUpdateData: Record<string, unknown> = {};

    // Get conversation context for phone normalization if needed
    let conversationContext: { messages?: Array<{ content: string; role?: string }> } | undefined;
    if (conversationId && data.phone) {
      const messages = await prisma.message.findMany({
        where: { conversationId, role: 'user' },
        select: { content: true, role: true },
        orderBy: { createdAt: 'asc' },
        take: 10,
      });
      conversationContext = { messages };
    }

    for (const entry of Object.entries(data)) {
      const [key, rawValue] = entry;

      // Skip empty strings, null, and undefined - only save fields that have actual values
      if (rawValue === null || rawValue === undefined || rawValue === '') {
        continue;
      }

      let value = rawValue;

      // Normalize phone numbers
      if (key === 'phone' && rawValue) {
        const rawPhoneInput = String(rawValue).trim();

        if (rawPhoneInput) {
          const rawDigits = rawPhoneInput.replace(/\D/g, '');
          const isUserHebrew = conversationContext?.messages?.some((msg) =>
            /[\u0590-\u05FF]/.test(msg.content),
          ) ?? false;

          const hintPayload = JSON.stringify({
            raw: rawPhoneInput,
            digits: rawDigits,
            language: isUserHebrew ? 'he' : 'other',
          });

          await prisma.userData.upsert({
            where: { key_userId_flowId: { userId, flowId, key: 'raw_phone_country_hint' } },
            create: { userId, flowId, key: 'raw_phone_country_hint', value: hintPayload, type: 'string' },
            update: { value: hintPayload },
          });
        }

        value = this.normalizePhoneNumber(rawPhoneInput, conversationContext);
        // After normalization, check if phone is still valid (not empty)
        if (!value || value === '') {
          continue;
        }
      }

      // Normalize campaign_start_date to ISO 8601 format
      // CRITICAL: Date MUST be parsed and formatted - raw text is NOT acceptable
      // Also validate Shabbat/holiday dates based on religious affinity
      if (key === 'campaign_start_date' && rawValue) {
        try {
          const { getUserTimezone, formatCampaignDate, isShabbatOrHoliday } = await import('./utils/dateTimeUtils');
          const conversation = conversationId ? await prisma.conversation.findUnique({
            where: { id: conversationId },
            select: { channel: true },
          }) : null;
          const timezone = conversation ? await getUserTimezone(conversationId!, conversation.channel as 'web' | 'whatsapp') : 'UTC';
          const formattedDate = await formatCampaignDate(String(rawValue), timezone);
          if (formattedDate && formattedDate.trim() !== '') {
            // Check if date falls on Shabbat or holiday
            const dateObj = new Date(formattedDate);
            if (isNaN(dateObj.getTime())) {
              // Invalid date object - save as RAW_DATE instead of skipping
              const { logger } = await import('../../utils/logger');
              logger.warn('Invalid date object after parsing, saving as RAW_DATE', {
                rawValue: String(rawValue).substring(0, 100),
                formattedDate,
                conversationId,
              });
              value = `RAW_DATE:${String(rawValue)}`;
              // Continue to save (don't skip)
            } else {
              let shabbatCheck;
              try {
                shabbatCheck = await isShabbatOrHoliday(dateObj);
              } catch (checkError: any) {
                // If holiday check fails, log but continue - don't block date saving
                try {
                  const { logger } = await import('../../utils/logger');
                  logger.error('Error checking Shabbat/holiday:', {
                    error: checkError?.message,
                    formattedDate,
                  });
                } catch {
                  // Ignore logging errors
                }
                // If we can't check for holiday, assume it's valid and save it
                value = formattedDate;
                // Continue to save (don't skip)
              }

              // CRITICAL: Always reject Shabbat/holiday dates, regardless of religious affinity
              // This ensures synagogues never accidentally launch campaigns on these days
              if (shabbatCheck && shabbatCheck.isShabbatOrHoliday) {
                // Check for religious affinity (Hebrew language suggests religious context)
                let hasReligiousAffinity = false;
                if (conversationId) {
                  const messages = await prisma.message.findMany({
                    where: { conversationId, role: 'user' },
                    orderBy: { createdAt: 'asc' },
                    take: 10,
                    select: { content: true },
                  });

                  // Check for Hebrew language or religious expressions
                  const hasHebrew = messages.some((msg) => /[\u0590-\u05FF]/.test(msg.content));
                  const hasReligiousExpressions = messages.some((msg) =>
                    /בעזרת השם|בלי נדר|ברוך השם|יהיה רצון|בס״ד|בס"ד|שבת|שבת שלום|חג|חג שמח|פסח|סוכות|שבועות|ראש השנה|יום כיפור|יוכיפור/i.test(msg.content),
                  );

                  hasReligiousAffinity = hasHebrew || hasReligiousExpressions;
                }

                // If religious affinity detected and date is Shabbat/holiday:
                // Save as RAW_DATE with holiday flag so LLM can see it and ask for confirmation
                // CRITICAL: Always save the field, even if it's a problematic date
                const { logger } = await import('../../utils/logger');
                logger.warn('Date falls on Shabbat/holiday, saving as RAW_DATE with flag', {
                  rawValue: String(rawValue).substring(0, 100),
                  formattedDate,
                  holidayName: shabbatCheck.eventName,
                  hasReligiousAffinity,
                  conversationId,
                });
                // Save with holiday information so LLM can see it
                value = `RAW_DATE:${String(rawValue)}:HOLIDAY:${shabbatCheck.eventName || 'Shabbat/Holiday'}`;
                // Continue to save (don't skip)
              } else {
                // Date is valid and not Shabbat/holiday - save it
                value = formattedDate;
              }
            }
          } else {
            // If parsing fails, store the raw value with a flag so LLM can handle it
            // This allows LLM to ask for Gregorian date or guess a reasonable date
            // Store as "RAW_DATE:<original_text>" so we can detect and handle it
            const { logger } = await import('../../utils/logger');
            logger.warn('Date parsing returned empty, saving as RAW_DATE', {
              rawValue: String(rawValue).substring(0, 100),
              conversationId,
            });
            value = `RAW_DATE:${String(rawValue)}`;
            // Continue to save this raw date value - LLM will be instructed to handle it
          }
        } catch (dateError: any) {
          // If date parsing fails completely, store raw value with flag
          // LLM will be instructed to ask for Gregorian date or guess
          try {
            const { logger } = await import('../../utils/logger');
            logger.warn('Error parsing campaign_start_date, storing raw value for LLM to handle:', {
              error: dateError?.message,
              rawValue: String(rawValue).substring(0, 100),
              conversationId,
            });
          } catch (logError) {
            // If logging fails, just continue
          }
          // Store raw value with flag so LLM can handle it
          value = `RAW_DATE:${String(rawValue)}`;
        }
      }

      // CRITICAL: Auto-populate entity fields from organization data when entity_type is PRIMARY_ORG
      if (key === 'entity_type' && rawValue === 'PRIMARY_ORG' && conversationId) {
        try {
          const conversation = await prisma.conversation.findUnique({
            where: { id: conversationId },
            include: {
              user: {
                include: {
                  UserOrganisation: {
                    include: {
                      organisation: true,
                    },
                  },
                },
              },
            },
          });

          if (conversation?.userId && conversation.user?.UserOrganisation?.[0]?.organisation) {
            const orgInfo = conversation.user.UserOrganisation[0].organisation;
            const orgData = orgInfo.data as GuidestarOrganisation | USAOrganisation | null;

            if (orgData) {
              // Get current userData to check what's already set
              const currentUserData = await this.getUserData(userId, flowId);
              const autoPopulatedData: Record<string, unknown> = {};

              // Populate entity_name if not already set - use "name" from organization object
              if (!currentUserData.entity_name) {
                if (orgData.name) {
                  autoPopulatedData.entity_name = orgData.name;
                } else if ('fullName' in orgData && orgData.fullName) {
                  autoPopulatedData.entity_name = orgData.fullName;
                }
              }

              // Populate entity_tax_id if not already set - use "regNum"
              if (!currentUserData.entity_tax_id) {
                if ('regNum' in orgData && orgData.regNum) {
                  autoPopulatedData.entity_tax_id = orgData.regNum;
                } else if ('ein' in orgData && orgData.ein) {
                  autoPopulatedData.entity_tax_id = orgData.ein;
                }
              }

              // Populate entity_country - stub "ישראל" for now (will be converted to 'IL' in buildEntity tool)
              if (!currentUserData.entity_country) {
                if (orgInfo.region === OrganisationRegion.Israel || orgInfo.region === 'IL' || orgInfo.region === 'Israel') {
                  autoPopulatedData.entity_country = 'ישראל';
                } else if (orgInfo.region === OrganisationRegion.USA || orgInfo.region === 'US' || orgInfo.region === 'USA') {
                  autoPopulatedData.entity_country = 'US';
                }
              }

              // Populate address fields if not already set
              if (orgInfo.region === OrganisationRegion.Israel || orgInfo.region === 'IL' || orgInfo.region === 'Israel') {
                const israelOrg = orgData as GuidestarOrganisation;
                // Use fullAddress directly (not addressStreet)
                if (!currentUserData.entity_address_line_1 && israelOrg.fullAddress) {
                  autoPopulatedData.entity_address_line_1 = israelOrg.fullAddress;
                } else if (!currentUserData.entity_address_line_1 && israelOrg.addressStreet) {
                  // Fallback to addressStreet if fullAddress not available
                  autoPopulatedData.entity_address_line_1 = israelOrg.addressStreet;
                }
                if (!currentUserData.entity_city && israelOrg.addressCity) {
                  autoPopulatedData.entity_city = israelOrg.addressCity;
                }
                if (!currentUserData.entity_zip && israelOrg.addressZipCode) {
                  autoPopulatedData.entity_zip = israelOrg.addressZipCode;
                }
                // entity_state and entity_address_line_2 left blank for Israel
              } else if (orgInfo.region === OrganisationRegion.USA || orgInfo.region === 'US' || orgInfo.region === 'USA') {
                const usaOrg = orgData as USAOrganisation;
                if (!currentUserData.entity_address_line_1 && usaOrg.street) {
                  autoPopulatedData.entity_address_line_1 = usaOrg.street;
                }
                if (!currentUserData.entity_city && usaOrg.city) {
                  autoPopulatedData.entity_city = usaOrg.city;
                }
                if (!currentUserData.entity_zip && usaOrg.zip) {
                  autoPopulatedData.entity_zip = usaOrg.zip;
                }
                if (!currentUserData.entity_state && usaOrg.state) {
                  autoPopulatedData.entity_state = usaOrg.state;
                }
              }

              // Save auto-populated data directly to UserData table (avoid recursion that causes async issues)
              if (Object.keys(autoPopulatedData).length > 0) {
                // Save each auto-populated field directly to UserData table
                // This avoids recursive calls that can cause async timing issues
                // CRITICAL: Save these fields immediately so they're available for the next stage
                const savePromises = Object.entries(autoPopulatedData)
                  .filter(([_, fieldValue]) => fieldValue !== null && fieldValue !== undefined && fieldValue !== '')
                  .map(async ([fieldKey, fieldValue]) => {
                    const fieldType = typeof fieldValue;
                    const fieldStringValue = String(fieldValue);

                    return prisma.userData.upsert({
                      where: { key_userId_flowId: { userId, flowId, key: fieldKey } },
                      create: { userId, flowId, key: fieldKey, value: fieldStringValue, type: fieldType },
                      update: { value: fieldStringValue },
                    });
                  });

                // Wait for all auto-populated fields to be saved
                await Promise.all(savePromises);
              }
            }
          }
        } catch (autoPopulateError) {
          // If auto-population fails, log but don't break the flow
          try {
            const { logger } = await import('../../utils/logger');
            logger.error('Error auto-populating entity fields:', autoPopulateError);
          } catch {
            // Ignore logging errors
          }
        }
      }

      // Normalize goal_currency - infer from context if missing
      if (key === 'goal_currency' && (!rawValue || rawValue === '')) {
        // Check conversation language and organization data
        if (conversationId) {
          const conversation = await prisma.conversation.findUnique({
            where: { id: conversationId },
            include: {
              user: {
                include: {
                  UserOrganisation: {
                    include: {
                      organisation: true,
                    },
                  },
                },
              },
            },
          });

          // Check if conversation is in Hebrew
          const messages = await prisma.message.findMany({
            where: { conversationId, role: 'user' },
            orderBy: { createdAt: 'asc' },
            take: 5,
            select: { content: true },
          });
          const isHebrew = messages.some((msg) => /[\u0590-\u05FF]/.test(msg.content));

          // Check organization region
          const org = conversation?.user?.UserOrganisation?.[0]?.organisation;
          const isIsraeli = org?.region === OrganisationRegion.Israel || org?.region === 'IL' || org?.region === 'Israel';

          if (isHebrew || isIsraeli) {
            value = 'ILS';
          } else if (org?.region === OrganisationRegion.USA || org?.region === 'US' || org?.region === 'USA') {
            value = 'USD';
          }
          // If we can't determine, leave it empty - LLM will ask
        }
      }

      const type = typeof value;
      const stringValue = String(value);

      await prisma.userData.upsert({
        where: { key_userId_flowId: { userId, flowId, key } },
        create: { userId, flowId, key, value: stringValue, type },
        update: { value: stringValue },
      });

      switch (key) {
        case 'first_name': userUpdateData.firstName = stringValue; break;
        case 'last_name': userUpdateData.lastName = stringValue; break;
        case 'email': userUpdateData.email = stringValue; break;
        case 'role': userUpdateData.role = stringValue; break;
      }
    }

    if (Object.keys(userUpdateData).length > 0) {
      await prisma.user.update({ where: { id: userId }, data: userUpdateData });
    }
  }

  /**
   * Get user data from the database
   *
   * Retrieves ALL userData entries for a given user across ALL flows.
   * If flowId is provided, entries for that flow take precedence over entries from other flows
   * (Standard "overlay" behavior: Specific > Generic).
   *
   * @param userId - User ID (returns empty object if null/undefined)
   * @param flowId - Optional flow ID to prioritize specific flow data
   * @returns Object with user data key-value pairs (merged from all flows)
   */
  async getUserData(userId?: string | null, flowId?: string) {
    if (!userId) return {};

    // 1. Fetch ALL data for this user, regardless of flow
    const allUserData = await prisma.userData.findMany({
      where: { userId },
      // Note: UserData doesn't have createdAt, relying on default DB order (entry order)
    });

    const collectedData: Record<string, unknown> = {};

    // 2. Separate current flow data vs others to implement precedence
    const currentFlowData: Record<string, unknown> = {};
    const otherFlowsData: Record<string, unknown> = {};

    allUserData.forEach((row) => {
      let value: unknown;
      switch (row.type) {
        case 'string': value = row.value; break;
        case 'number': value = Number(row.value); break;
        case 'boolean': value = row.value === 'true'; break;
        default: value = row.value;
      }

      if (flowId && row.flowId === flowId) {
        currentFlowData[row.key] = value;
      } else {
        // checks if multiple flows have same key?
        // Since we ordered by createdAt asc, newer values overwrite older ones here
        otherFlowsData[row.key] = value;
      }
    });

    // 3. Merge: Other flows (Base) + Current Flow (Overlay)
    // This ensures that if I just answered "email" in *this* flow, it wins.
    // But if "email" was set in a previous flow and not here, I still see it.
    return { ...otherFlowsData, ...currentFlowData };
  }

  /**
   * Get reset_token from userData for use in subsequent API calls
   * Returns null if reset_token is not found
   */
  async getResetToken(userId: string, flowId: string): Promise<string | null> {
    const userData = await this.getUserData(userId, flowId);
    const resetToken = userData.reset_token as string | undefined;
    return resetToken || null;
  }

  /**
   * Get jwt_token from userData for use in authenticated API calls
   * Returns null if jwt_token is not found
   */
  async getJwtToken(userId: string, flowId: string): Promise<string | null> {
    const userData = await this.getUserData(userId, flowId);
    const jwtToken = userData.jwt_token as string | undefined;
    return jwtToken || null;
  }

  sanitizeData(data: Record<string, unknown>, fieldsDefinitions: Record<string, FieldDefinition>) {
    return Object.fromEntries(Object.entries(data).map(([key, value]) => {
      const isSensitive = fieldsDefinitions[key]?.sensitive;
      return [key, isSensitive && value ? '••••••••' : value];
    }));
  }
}

export const flowHelpers = new FlowHelpers();
