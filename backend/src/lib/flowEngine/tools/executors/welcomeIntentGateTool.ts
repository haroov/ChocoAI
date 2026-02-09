import { prisma } from '../../../../core/prisma';
import { flowHelpers } from '../../flowHelpers';
import { ToolExecutor, ToolResult } from '../types';

const toBool = (v: unknown): boolean => v === true || String(v).toLowerCase() === 'true';

function extractSegmentDescriptionHe(text: string): string | null {
  const t = String(text || '').toLowerCase();
  if (/(משרד\s*עורכי\s*דין|עורך\s*דין|עו\"ד|עו״ד)/i.test(t)) return 'משרד עורכי דין';
  if (/(רואה\s*חשבון|רו\"ח|רו״ח)/i.test(t)) return 'רואה חשבון';
  if (/(מסעדה|בית\s*קפה|בר)\b/i.test(t)) return 'מסעדה / בית קפה';
  if (/(חנות\s*פרחים|פרחים)\b/i.test(t)) return 'חנות פרחים';
  if (/(יוגה|מורה\s*ליוגה)/i.test(t)) return 'מורה ליוגה';
  return null;
}

function extractIdNumber(text: string, labels: RegExp): string | null {
  const s = String(text || '');
  const m = s.match(labels);
  if (!m) return null;
  const digits = String(m[1] || '').replace(/\D/g, '');
  if (!digits) return null;
  // Israeli IDs typically 8-9 digits; keep len 7-10 as a tolerant range.
  if (digits.length < 7 || digits.length > 10) return null;
  return digits;
}

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

    // Use a short window of recent USER messages so intent expressed before "basics" is not lost.
    // Example: user says "need COI" then provides phone/email → we still need to treat as service/support.
    const recentUserMsgs = await prisma.message.findMany({
      where: { conversationId, role: 'user' },
      orderBy: { createdAt: 'desc' },
      take: 6,
      select: { content: true },
    });
    const recentTexts = recentUserMsgs
      .map((m) => String(m.content || '').trim())
      .filter(Boolean);
    const joined = recentTexts.reverse().join(' | ');
    const text = String(recentTexts[recentTexts.length - 1] || '').trim(); // last user msg
    const t = joined.toLowerCase();

    // "Identified customer" heuristic:
    // - If user.registered=true, we consider them an existing/identified customer (eligible to request service/login flows).
    // - Otherwise, default to new quote unless there are explicit account-scoped signals.
    const isRecognizedCustomer = conversation.user?.registered === true;

    // Signals (computed on the joined recent text window)
    const mentionsLogin = /login|log in|sign in|התחבר|להתחבר|כניסה|להיכנס/.test(t);
    const mentionsQuote = /quote|pricing|price|policy|insurance|proposal|ביטוח|הצעה|פוליסה|מחיר|מבנה|תכולה|צד\s*ג|חבות\s*מעבידים|אחריות\s*מקצועית|פרא\s*רפואי|סייבר|cyber|product\s*liability/.test(t);
    const mentionsSupport = /renew|renewal|claim|certificate|endorsement|cancellation|חידוש|תביעה|אישור\s*ביטוח|תעודת\s*ביטוח|נספח|שינוי|ביטול/.test(t);

    // Explicit account-scoped phrasing (skip confirmation question)
    const explicitAccountScoped = /my\s+.*account|in\s+my\s+.*account|existing\s+account|my\s+policy|my\s+case|policy\s+number|case\s+id|בחשבון|בחשבון שלי|במערכת שלי|בפוליסה|מספר\s*פוליסה|מספר\s*תיק/.test(t);

    // User already answered the confirmation question in the LAST message
    const answeredHaveAccountYes = /\b(yes|yeah|yep|i do|already|have an account)\b|יש לי|כן.*(חשבון|משתמש)|כבר.*(חשבון|משתמש)/i.test(text);
    const answeredHaveAccountNo = /\b(no|nope|i don\'t|dont|do not)\b|אין לי|לא.*(חשבון|משתמש)/i.test(text);

    // Read current state
    const current = await flowHelpers.getUserData(conversation.userId, flowId);
    const alreadyAsked = toBool(current.confirmation_asked);
    const hasBasics = !!(current.first_name && current.last_name && current.phone);

    // Capture implicit high-value facts even if this stage isn't collecting them.
    // This prevents re-asking when the user provides info early (e.g., "ביטוח למשרד עורכי דין", ת"ז).
    const implicitUpdates: Record<string, unknown> = {};
    const seg = extractSegmentDescriptionHe(joined);
    if (seg && !current.segment_description) implicitUpdates.segment_description = seg;

    const proposerId = extractIdNumber(joined, /\b(?:ת["״']?ז|ת\.ז)\s*[:\-]?\s*(\d{7,10})\b/i);
    if (proposerId && !current.proposer_id_number) implicitUpdates.proposer_id_number = proposerId;

    const am = extractIdNumber(joined, /\b(?:ע["״']?מ|ע\.מ|עוסק\s*מורשה)\s*[:\-]?\s*(\d{7,10})\b/i);
    const hp = extractIdNumber(joined, /\b(?:ח["״']?פ|ח\.פ|מספר\s*חברה)\s*[:\-]?\s*(\d{7,10})\b/i);
    if (am && !current.legal_id) implicitUpdates.legal_id = am;
    if (am && !current.legal_id_type) implicitUpdates.legal_id_type = 'AM';
    if (hp && !current.legal_id) implicitUpdates.legal_id = hp;
    if (hp && !current.legal_id_type) implicitUpdates.legal_id_type = 'HP';

    // If the user provided a ת"ז number but business legal id is still missing, keep it as a fallback value.
    // (Common for sole proprietors where AM may equal TZ; we'll still ask for the type if missing.)
    if (proposerId && !current.legal_id && !implicitUpdates.legal_id) implicitUpdates.legal_id = proposerId;

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
      // Default behavior: assume "new quote" unless the customer is recognized (or explicitly account-scoped).
      // This matches product UX: most conversations start as a new quote.
      if (isRecognizedCustomer) {
        needsAccountConfirmation = false;
        intentConfidence = 0.75;
        inferredIntentType = 'login';
        inferredAlreadyRegistered = true;
        reason = 'support_recognized_login';
      } else {
        needsAccountConfirmation = false;
        intentConfidence = 0.65;
        inferredIntentType = 'quote';
        inferredAlreadyRegistered = false;
        reason = 'support_unrecognized_default_quote';
      }
    } else if (mentionsQuote) {
      needsAccountConfirmation = false;
      intentConfidence = 0.85;
      inferredIntentType = 'quote';
      inferredAlreadyRegistered = false;
      reason = 'explicit_quote';
    }

    // If we have basics and still no inferred intent, default to new quote.
    // We only ask a question in truly service/support ambiguous cases.
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
      ...implicitUpdates,
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
