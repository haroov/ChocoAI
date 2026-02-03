import { prisma } from '../../../../core/prisma';
import { flowHelpers } from '../../flowHelpers';
import { ToolExecutor, ToolResult } from '../types';

const toBool = (v: unknown): boolean => v === true || String(v).toLowerCase() === 'true';

/**
 * Deterministic confidence-based intent gate for Welcome flow.
 *
 * Goals:
 * - Ask the policy/case confirmation question ONLY when intent is ambiguous (new quote vs existing policy/case).
 * - If user explicitly references an existing account/policy/case, skip the question and route to login.
 * - Store telemetry fields so QA can verify WHY it happened:
 *   - intent_confidence
 *   - needs_account_confirmation
 *   - confirmation_asked
 */
export const welcomeIntentGateTool: ToolExecutor = async (_payload, { conversationId }): Promise<ToolResult> => {
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { user: true },
    });

    if (!conversation?.userId) return { success: false, error: 'Conversation or user not found' };

    const userFlow = await prisma.userFlow.findUnique({
      where: { userId: conversation.userId },
      select: { flowId: true },
    });
    const flowId = userFlow?.flowId;
    if (!flowId) return { success: false, error: 'Flow ID not found' };

    const lastUserMsg = await prisma.message.findFirst({
      where: { conversationId, role: 'user' },
      orderBy: { createdAt: 'desc' },
      select: { content: true },
    });
    const text = String(lastUserMsg?.content || '').trim();
    const t = text.toLowerCase();

    // Signals
    const mentionsLogin = /login|log in|sign in|התחבר|להתחבר|כניסה|להיכנס/.test(t);
    const mentionsQuote = /quote|pricing|price|policy|insurance|proposal|ביטוח|הצעה|פוליסה|מחיר|מבנה|תכולה|צד\s*ג|חבות\s*מעבידים|אחריות\s*מקצועית|פרא\s*רפואי|סייבר|cyber|product\s*liability/.test(t);
    const mentionsSupport = /renew|renewal|claim|certificate|endorsement|cancellation|חידוש|תביעה|אישור\s*ביטוח|תעודת\s*ביטוח|נספח|שינוי|ביטול/.test(t);

    // Explicit account-scoped phrasing (skip confirmation question)
    const explicitAccountScoped = /my\s+.*account|in\s+my\s+.*account|existing\s+account|my\s+policy|my\s+case|policy\s+number|case\s+id|בחשבון|בחשבון שלי|במערכת שלי|בפוליסה|מספר\s*פוליסה|מספר\s*תיק/.test(t);

    // User already answered the confirmation question in this message
    const answeredHaveAccountYes = /\b(yes|yeah|yep|i do|already|have an account)\b|יש לי|כן.*(חשבון|משתמש)|כבר.*(חשבון|משתמש)/i.test(text);
    const answeredHaveAccountNo = /\b(no|nope|i don\'t|dont|do not)\b|אין לי|לא.*(חשבון|משתמש)/i.test(text);

    // Read current state
    const current = await flowHelpers.getUserData(conversation.userId, flowId);
    const alreadyAsked = toBool(current.confirmation_asked);
    const hasBasics = !!(current.first_name && current.last_name && current.phone);

    // Deterministic decision
    let needsAccountConfirmation = false;
    let intentConfidence = 0.5;
    let inferredIntentType: 'login' | 'quote' | '' = '';
    let inferredAlreadyRegistered: boolean | '' = '';
    let reason = 'default';

    // If user explicitly mentions sign-in/account, it is account-scoped.
    if (mentionsLogin || explicitAccountScoped) {
      needsAccountConfirmation = false;
      intentConfidence = 0.9;
      inferredIntentType = 'login';
      inferredAlreadyRegistered = true;
      reason = 'explicit_account_scoped';
    } else if (mentionsSupport) {
      // Support-like request (renewal/certificate/claim) can be ambiguous: existing policy/case vs new quote.
      // Ask once to disambiguate.
      needsAccountConfirmation = true;
      intentConfidence = 0.45;
      reason = 'support_ambiguous';
    } else if (mentionsQuote) {
      needsAccountConfirmation = false;
      intentConfidence = 0.85;
      inferredIntentType = 'quote';
      inferredAlreadyRegistered = false;
      reason = 'explicit_quote';
    }

    // If the user just provided basic details (name + phone) but didn't state intent,
    // default to starting a new quote unless there are explicit existing-account signals.
    // This prevents getting stuck in an "intent" loop and aligns with insurance onboarding UX.
    if (!inferredIntentType && hasBasics && !mentionsSupport) {
      needsAccountConfirmation = false;
      intentConfidence = 0.7;
      inferredIntentType = 'quote';
      inferredAlreadyRegistered = false;
      reason = 'default_quote_after_basics';
    }

    // If user already answered yes/no, we don't need the confirmation question anymore.
    if (answeredHaveAccountYes) {
      needsAccountConfirmation = false;
      intentConfidence = Math.max(intentConfidence, 0.85);
      inferredIntentType = 'login';
      inferredAlreadyRegistered = true;
      reason = 'answered_have_account_yes';
    } else if (answeredHaveAccountNo) {
      needsAccountConfirmation = false;
      intentConfidence = Math.max(intentConfidence, 0.85);
      inferredIntentType = 'quote';
      inferredAlreadyRegistered = false;
      reason = 'answered_have_account_no';
    }

    // Telemetry: confirmation_asked means "we decided to ask it (now or earlier)".
    // If we still need to ask and we haven't asked yet, mark it now so QA can see why.
    const shouldMarkAsked = needsAccountConfirmation && !alreadyAsked;
    const updates: Record<string, unknown> = {
      intent_confidence: intentConfidence,
      needs_account_confirmation: needsAccountConfirmation,
      ...(shouldMarkAsked ? { confirmation_asked: true } : {}),
      welcome_intent_gate_reason: reason,
    };

    // If we confidently inferred login/register, store it so routing is deterministic
    if (inferredIntentType) {
      updates.intent_type = inferredIntentType;
      // Mark intent as confirmed when we deterministically set it
      updates.intent_confirmed = true;
    }
    if (inferredAlreadyRegistered !== '') updates.already_registered = inferredAlreadyRegistered;

    await flowHelpers.setUserData(conversation.userId, flowId, updates, conversationId);

    return {
      success: true,
      data: {
        intentConfidence,
        needsAccountConfirmation,
        confirmationAsked: shouldMarkAsked || alreadyAsked,
        reason,
      },
    };
  } catch (e: any) {
    return { success: false, error: e?.message || 'Failed to run welcome intent gate' };
  }
};
