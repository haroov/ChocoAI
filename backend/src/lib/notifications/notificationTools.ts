import { ToolExecutor } from '../flowEngine/tools/types';
import { memoryService } from '../memory/memoryService';
import { flowHelpers } from '../flowEngine/flowHelpers';
import { prisma } from '../../core/prisma';
import { logger } from '../../utils/logger';
import { notificationService } from './notificationService';

/**
 * Generate a 6-digit OTP
 */
function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Tool: notifications.sendVerificationCode
 * Generates OTP, persists it, and sends via email and SMS
 */
export const sendVerificationCodeTool: ToolExecutor = async (payload, context) => {
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: context.conversationId },
      include: { user: true },
    });

    if (!conversation?.userId) {
      return {
        success: false,
        error: 'User not found',
      };
    }

    const user = conversation.user!;

    // Get flowId from userFlow
    const userFlow = await prisma.userFlow.findUnique({
      where: { userId: user.id },
      select: { flowId: true },
    });
    const flowId = userFlow?.flowId || '';

    // Get userData to find email and phone
    const userData = await flowHelpers.getUserData(user.id, flowId);
    const email = (payload.email as string) || (userData.email as string);
    const phone = (payload.phone as string) || (userData.phone as string);

    if (!email && !phone) {
      return {
        success: false,
        error: 'Email or phone is required for verification code',
      };
    }

    // Generate OTP
    const code = generateOTP();

    // Get flow slug for memory service
    const flow = await prisma.flow.findUnique({ where: { id: flowId } });
    const flowSlug = flow?.slug || '';

    // Persist OTP with TTL (10 minutes) - save to userData
    await flowHelpers.setUserData(user.id, flowId, {
      verification_code: code,
      last_otp_sent_at: new Date().toISOString(),
    }, context.conversationId);

    // Add conversation fact
    await memoryService.addConversationFact(context.conversationId, {
      key: 'otp_sent_at',
      value: new Date(),
      source: 'system',
      timestamp: new Date(),
    });

    // Detect language from conversation
    const messages = await prisma.message.findMany({
      where: { conversationId: context.conversationId, role: 'user' },
      orderBy: { createdAt: 'asc' },
      take: 5,
      select: { content: true },
    });
    const hasHebrew = messages.some((msg) => /[\u0590-\u05FF]/.test(msg.content));
    const language = hasHebrew ? 'hebrew' : 'english';

    // Prepare template data
    const templateData = {
      firstName: user.firstName || userData.first_name || 'User',
      code,
      language,
    };

    // Generate idempotency key
    const idempotencyKey = `${context.conversationId}-otp-${Date.now()}`;

    // Send via email and SMS
    const emailResult = email
      ? await notificationService.sendEmail(
        email,
        'verification-code-email',
        templateData,
        {
          requestId: context.conversationId,
          idempotencyKey: `${idempotencyKey}-email`,
        },
      )
      : { success: false, error: 'Email not available' };

    const smsResult = phone
      ? await notificationService.sendSms(
        phone,
        'verification-code-sms',
        { code, language },
        {
          requestId: context.conversationId,
          idempotencyKey: `${idempotencyKey}-sms`,
        },
      )
      : { success: false, error: 'Phone not available' };

    const success = emailResult.success || smsResult.success;

    return {
      success,
      data: {
        code,
        emailSent: emailResult.success,
        smsSent: smsResult.success,
      },
      saveResults: {
        last_otp_sent_at: new Date().toISOString(),
        otp_delivery_channels: [
          emailResult.success && 'email',
          smsResult.success && 'sms',
        ].filter(Boolean),
      },
    };
  } catch (error: any) {
    logger.error('Error sending verification code:', error);
    return {
      success: false,
      error: error?.message || 'Failed to send verification code',
    };
  }
};

/**
 * Tool: notifications.sendGatewayIntroEmail
 * Sends email to payment gateway provider with user CC'd
 */
export const sendGatewayIntroEmailTool: ToolExecutor = async (payload, context) => {
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: context.conversationId },
      include: { user: true },
    });

    if (!conversation?.userId) {
      return {
        success: false,
        error: 'User not found',
      };
    }

    const user = conversation.user!;
    const { providerName, orgName, providerEmail } = payload as {
      providerName: string;
      orgName: string;
      providerEmail?: string;
    };

    if (!providerName || !orgName) {
      return {
        success: false,
        error: 'providerName and orgName are required',
      };
    }

    // Detect language
    const messages = await prisma.message.findMany({
      where: { conversationId: context.conversationId, role: 'user' },
      orderBy: { createdAt: 'asc' },
      take: 5,
      select: { content: true },
    });
    const hasHebrew = messages.some((msg) => /[\u0590-\u05FF]/.test(msg.content));
    const language = hasHebrew ? 'hebrew' : 'english';

    const templateData = {
      firstName: user.firstName || 'User',
      providerName,
      orgName,
      language,
    };

    // For now, this is a placeholder - actual email sending to provider would be implemented
    // based on specific provider requirements
    logger.info('Gateway intro email would be sent', {
      providerName,
      orgName,
      providerEmail,
      userEmail: user.email,
    });

    return {
      success: true,
      data: {
        message: 'Gateway intro email prepared (implementation pending)',
        providerName,
        orgName,
      },
    };
  } catch (error: any) {
    logger.error('Error sending gateway intro email:', error);
    return {
      success: false,
      error: error?.message || 'Failed to send gateway intro email',
    };
  }
};

/**
 * Tool: notifications.sendDonorSupportEmail
 * Sends a donor request email to customer service.
 */
export const sendDonorSupportEmailTool: ToolExecutor = async (payload, context) => {
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: context.conversationId },
      include: { user: true },
    });

    if (!conversation?.userId) {
      return { success: false, error: 'User not found' };
    }

    // Get flowId from userFlow
    const userFlow = await prisma.userFlow.findUnique({
      where: { userId: conversation.userId },
      select: { flowId: true },
    });
    const flowId = userFlow?.flowId || '';

    const userData = await flowHelpers.getUserData(conversation.userId, flowId);
    const req = String((payload as any).donor_request || userData.donor_request || '').trim();

    if (!req) {
      return { success: false, error: 'Missing donor_request' };
    }

    const hasHebrew = /[\u0590-\u05FF]/.test(req);
    const language = hasHebrew ? 'hebrew' : 'english';

    const env = (process.env.APP_ENV || process.env.NODE_ENV || 'local').toString();
    const to = (process.env.TECH_SUPPORT_EMAIL || 'uriel@facio.io').toString();

    const name = [
      (conversation.user?.firstName as string) || (userData.first_name as string) || '',
      (conversation.user?.lastName as string) || (userData.last_name as string) || '',
    ].filter(Boolean).join(' ').trim() || 'Unknown';

    const templateData = {
      env,
      timestamp: new Date().toISOString(),
      conversationId: context.conversationId,
      name,
      email: (conversation.user?.email as string) || (userData.email as string) || '',
      phone: (userData.phone as string) || (userData.user_phone as string) || '',
      request: req,
      language,
    };

    const idempotencyKey = `${context.conversationId}-donor-support-${Date.now()}`;
    const result = await notificationService.sendEmail(
      to,
      'donor-support-email',
      templateData,
      { requestId: context.conversationId, idempotencyKey },
    );

    if (!result.success) {
      return { success: false, error: result.error || 'Failed to send support email', errorCode: 'EMAIL_FAILED' };
    }

    return {
      success: true,
      data: { to, messageId: result.messageId },
      saveResults: {
        donor_support_notified: true,
        donor_support_email_to: to,
        donor_support_notified_at: new Date().toISOString(),
      },
    };
  } catch (error: any) {
    logger.error('Error sending donor support email:', error);
    return { success: false, error: error?.message || 'Failed to send donor support email', errorCode: 'EMAIL_FAILED' };
  }
};
