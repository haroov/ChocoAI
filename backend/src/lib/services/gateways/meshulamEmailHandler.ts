import { prisma } from '../../../core/prisma';
import { logger } from '../../../utils/logger';
import { httpService } from '../../services/httpService';
import { flowHelpers } from '../../flowEngine/flowHelpers';
import { getProjectConfig } from '../../../utils/getProjectConfig';
import { getChocoAuthToken } from '../../flowEngine/tools/helpers/getChocoAuthToken';
import { notificationService } from '../../notifications/notificationService';

interface MeshulamCredentials {
  businessCode: string;
  apiKey?: string;
  merchantId?: string;
  userId?: string; // Meshulam sometimes calls this 'user_id' or similar
  entityId?: string; // From our side, if we match it
  organizationId?: string; // From our side
  regNum?: string; // Legal registration number (ח.פ / ע.מ / EIN)
  email?: string; // User email mentioned in the provider email
  phone?: string; // Phone mentioned in the provider email
}

export class MeshulamEmailHandler {
  /**
     * Parse email content to extract Meshulam credentials
     */
  async parseEmail(subject: string, bodyText: string): Promise<MeshulamCredentials | null> {
    logger.info('[MeshulamEmailHandler] Parsing email', { subject });

    // Check if it's a Meshulam/Grow email
    // Subject often contains "רישום למערכת" or "Grow" or "Meshulam"
    if (!/meshulam|grow|משולם|גרו/i.test(subject) && !/meshulam|grow|משולם|גרו/i.test(bodyText)) {
      logger.info('[MeshulamEmailHandler] Not a recognized Meshulam email');
      return null;
    }

    const credentials: MeshulamCredentials = {
      businessCode: '',
    };

    // Extract Business Code / Simuh Esek / קוד בית עסק
    // IMPORTANT: Some providers send longer codes (e.g. 16+ chars hex/base64) and sometimes the value is on the next line.
    // Accept a wider token length and allow common token characters.
    const businessCodeMatch = bodyText.match(
      /(?:קוד בית עסק|Business Code|Code|קוד עסק|קוד)\s*[:|-]?\s*([\w+/=-]{3,128})/i,
    );
    if (businessCodeMatch) {
      credentials.businessCode = businessCodeMatch[1];
    }

    // Extract API Key
    // Pattern: "API Key: xxx..."
    const apiKeyMatch = bodyText.match(/(?:API Key|מפתח API)\s*[:|-]?\s*([a-zA-Z0-9]{10,})/i);
    if (apiKeyMatch) {
      credentials.apiKey = apiKeyMatch[1];
    }

    // Extract Registration Number (H.P.) to match Organization
    // Pattern: "ח.פ: 512345678" or "H.P.: 512345678" or "Reg Num: ..."
    const regNumMatch = bodyText.match(/(?:ח\.?פ\.?|H\.?P\.?|Reg\.? No\.?|מספר עוסק|ע\.?מ\.?)\s*[:|-]?\s*(\d{7,10})/i);

    if (regNumMatch) {
      const regNum = regNumMatch[1];
      credentials.regNum = regNum;
      logger.info('[MeshulamEmailHandler] Found Registration Number', { regNum });

      // Find matching Organization
      const orgInfo = await prisma.organisationInfo.findFirst({
        where: { einOrRegNum: regNum },
      });

      if (orgInfo) {
        credentials.organizationId = orgInfo.id;
        // Optionally find entity associated? Actually we assume 1:1 for simplicity or resolve via UserData
      } else {
        // Fallback: Try to find legal entity in UserData (less reliable without explicit link)
        logger.warn('[MeshulamEmailHandler] Could not match RegNum to OrganisationInfo', { regNum });
      }
    }

    // Extract email (Hebrew/English)
    const emailMatch = bodyText.match(/(?:מייל|דוא"ל|Email)\s*[:|-]?\s*([^\s<>]+@[^\s<>]+)/i);
    if (emailMatch) {
      credentials.email = emailMatch[1].trim();
    }

    // Extract phone (Hebrew/English)
    const phoneMatch = bodyText.match(/(?:טלפון|טל׳|Phone)\s*[:|-]?\s*([+()\d\-\s]{7,20})/i);
    if (phoneMatch) {
      credentials.phone = phoneMatch[1].trim();
    }

    if (!credentials.businessCode) {
      logger.warn('[MeshulamEmailHandler] Failed to extract Business Code');
      return null;
    }

    return credentials;
  }

  /**
     * Process the ingested credentials to update the gateway
     */
  async processCredentials(credentials: MeshulamCredentials): Promise<boolean> {
    // We must link this email to a concrete user+flow context so we can store "pending" creds.
    // Preferred: OrganisationInfo match (enrichment).
    // Fallback (more reliable for our KYC flows): match by entity_tax_id in user_data.

    let userId: string | null = null;
    let flowId: string | null = null;
    let conversationId: string | null = null;

    if (credentials.organizationId) {
      logger.info('[MeshulamEmailHandler] Processing credentials for Org', { orgId: credentials.organizationId });

      const userOrg = await prisma.userOrganisation.findFirst({
        where: { organisationId: credentials.organizationId },
        include: { user: true },
      });

      if (!userOrg) {
        logger.warn('[MeshulamEmailHandler] No User found for Org.');
        return false;
      }

      userId = userOrg.userId;
      const userFlow = await prisma.userFlow.findUnique({ where: { userId } });
      flowId = userFlow?.flowId || null;

      if (!flowId) {
        const lastRelevantFlow = await prisma.flowHistory.findFirst({
          where: {
            userId,
            flow: {
              slug: {
                in: ['kyc', 'gateway-update'],
              },
            },
          },
          orderBy: { completedAt: 'desc' },
          select: {
            flowId: true,
            stage: true,
            completedAt: true,
            flow: { select: { slug: true } },
          },
        });

        if (lastRelevantFlow) {
          flowId = lastRelevantFlow.flowId;
          logger.info('[MeshulamEmailHandler] Using FlowHistory flowId for UserData lookup', {
            userId,
            flowSlug: lastRelevantFlow.flow.slug,
            stage: lastRelevantFlow.stage,
            completedAt: lastRelevantFlow.completedAt,
          });
        } else {
          logger.warn('[MeshulamEmailHandler] No active UserFlow and no relevant FlowHistory for User.', { userId });
          return false;
        }
      }
    } else if (credentials.regNum) {
      // Fallback: match by legal registration number currently used in KYC as entity_tax_id
      const match = await prisma.userData.findFirst({
        where: {
          key: 'entity_tax_id',
          value: credentials.regNum,
        },
        select: {
          userId: true,
          flowId: true,
        },
      });

      if (!match) {
        logger.warn('[MeshulamEmailHandler] No UserData match for entity_tax_id', { regNum: credentials.regNum });
        return false;
      }

      userId = match.userId;
      flowId = match.flowId;
      logger.info('[MeshulamEmailHandler] Matched user by entity_tax_id', {
        regNum: credentials.regNum,
        userId,
        flowId,
      });
    } else {
      logger.warn('[MeshulamEmailHandler] No linkable identifiers (no org match and no regNum).');
      return false;
    }

    // Best-effort: attach to the most recently active conversation for that user (for observability + UI visibility)
    if (userId) {
      const recentConversation = await prisma.conversation.findFirst({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        select: { id: true },
      });
      conversationId = recentConversation?.id || null;
    }

    if (!userId || !flowId) {
      logger.warn('[MeshulamEmailHandler] Missing userId/flowId after linking');
      return false;
    }

    const userData = await flowHelpers.getUserData(userId, flowId);

    // Check if we have entity_id in userData
    const entityId = userData.entity_id as string;
    if (!entityId) {
      logger.warn('[MeshulamEmailHandler] No entity_id in UserData.', { userId });
      return false;
    }

    const orgCustomerId = (userData.org_customer_id as string) || (userData.org_id as string);
    if (!orgCustomerId) {
      logger.warn('[MeshulamEmailHandler] No org_customer_id/org_id in UserData.', { userId });
      return false;
    }

    // Get Project Config for API URL
    const projectConfig = await getProjectConfig();
    const baseUrl = projectConfig.chocoDashboardBaseUrl;
    // e.g. https://api.chocoinsurance.com

    // Auth: for these endpoints we need user JWT (post-login). If the user isn't logged in anymore,
    // this will fail, which matches reality (the webhook can't impersonate a user).
    const authToken = await getChocoAuthToken(userId, flowId, true);

    // 1. Save pending credentials to UserData
    await flowHelpers.setUserData(userId, flowId, {
      // NOTE: flowHelpers.setUserData stores values via String(value),
      // so we must JSON-stringify objects ourselves.
      pending_meshulam_creds: JSON.stringify({
        businessCode: credentials.businessCode,
        apiKey: credentials.apiKey,
        merchantId: credentials.merchantId,
        userId: credentials.userId,
      }),
      pending_gateway_action: 'meshulam_update',
      gateway_meshulam_status: 'pending',
      pending_gateway_email_meta: JSON.stringify({
        regNum: credentials.regNum,
        email: credentials.email,
        phone: credentials.phone,
        receivedAt: new Date().toISOString(),
      }),
      // We don't change status to verified yet, waiting for OTP
    }, conversationId || undefined);

    logger.info('[MeshulamEmailHandler] Saved pending credentials. Sending notification email.');

    // 2. Send Notification Email
    // We need email address. userData has it?
    const userEmail = (userData.email as string) || (userData.user_email as string);
    const userFirstName = (userData.first_name as string) || 'Choco User';

    // We can assume dashboard URL or get from config
    // Actually method signature: sendGatewayApprovedEmail(to, data, options)

    if (userEmail) {
      const dashboardUrl = `${baseUrl}/dashboard/gateways`; // best guess
      const workspaceName = (userData.organization_name as string) || 'Your Workspace';

      await notificationService.sendGatewayApprovedEmail(userEmail, {
        firstName: userFirstName,
        workspaceName: workspaceName,
        dashboardUrl: 'https://dashboardapi.chocoinsurance.com/gateways',
      });
      logger.info('[MeshulamEmailHandler] Notification email sent.', { to: userEmail });
    } else {
      logger.warn('[MeshulamEmailHandler] No user email found to send notification.');
    }

    return true;
  }

  private async fetchOrgGateways(baseUrl: string, orgId: string, authToken: string): Promise<any[]> {
    // Docs: GET /orgarea/api/v1/organization/{orgId}/gateways
    const endpoint = `${baseUrl}/orgarea/api/v1/organization/${orgId}/gateways`;
    const res = await this.makeApiRequest('GET', endpoint, authToken);
    // Expected: { data: [...] }
    return Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
  }

  private async deleteGateway(
    baseUrl: string,
    orgId: string,
    gatewayId: string | number,
    entityId: string,
    authToken: string,
  ): Promise<void> {
    // Preferred (org-scoped) — aligns with org gateway listing.
    // If this turns out not to exist in the deployed API, we fall back to the older entities endpoint.
    const orgEndpoint = `${baseUrl}/orgarea/api/v1/organization/${orgId}/gateways/${gatewayId}`;
    try {
      await this.makeApiRequest('DELETE', orgEndpoint, authToken);
      return;
    } catch (e) {
      logger.warn('[MeshulamEmailHandler] Failed org-scoped gateway delete, falling back', {
        orgEndpoint,
        gatewayId,
      });
    }

    const entityEndpoint = `${baseUrl}/orgarea/api/v1/entities/${entityId}/payment-gateways/${gatewayId}`;
    await this.makeApiRequest('DELETE', entityEndpoint, authToken);
  }

  private async createGateway(baseUrl: string, payload: any, authToken: string): Promise<boolean> {
    const endpoint = `${baseUrl}/orgarea/api/v1/payment-gateways`;
    try {
      const res: any = await this.makeApiRequest('POST', endpoint, authToken, payload);
      return !!res?.id;
    } catch (e) {
      logger.error('[MeshulamEmailHandler] Create gateway failed', e);
      return false;
    }
  }

  private async makeApiRequest(method: string, endpoint: string, authToken: string, body?: any): Promise<any> {
    const token = authToken.startsWith('Bearer ') ? authToken : `Bearer ${authToken}`;

    const res = await fetch(endpoint, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: token,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      throw new Error(`API ${method} ${endpoint} failed: ${res.statusText}`);
    }

    // DELETE might return empty
    if (method === 'DELETE') return true;

    const json = await res.json();
    return json.data || json;
  }
}

export const meshulamEmailHandler = new MeshulamEmailHandler();
