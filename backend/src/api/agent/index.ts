import { flowEngine } from '../../lib/flowEngine/flowEngine';
import { registerRoute } from '../../utils/routesRegistry';
import { logger } from '../../utils/logger';
import { prisma } from '../../core';
import { flowHelpers } from '../../lib/flowEngine/flowHelpers';

function parseUserAgent(uaRaw: string) {
  const ua = uaRaw || '';
  const isMobile = /(Mobi|Android|iPhone|iPad|iPod)/i.test(ua);
  const device = isMobile ? 'mobile' : 'desktop';

  let browser = 'unknown';
  let browserVersion = '';
  const edge = /Edg\/([\d.]+)/.exec(ua);
  const chrome = /Chrome\/([\d.]+)/.exec(ua);
  const firefox = /Firefox\/([\d.]+)/.exec(ua);
  const safari = /Version\/([\d.]+).*Safari\//.exec(ua);
  const opr = /OPR\/([\d.]+)/.exec(ua);

  if (edge) {
    browser = 'edge';
    browserVersion = edge[1];
  } else if (opr) {
    browser = 'opera';
    browserVersion = opr[1];
  } else if (firefox) {
    browser = 'firefox';
    browserVersion = firefox[1];
  } else if (chrome && !/Chromium/i.test(ua) && !/Edg\//.test(ua) && !/OPR\//.test(ua)) {
    browser = 'chrome';
    browserVersion = chrome[1];
  } else if (safari && !/Chrome\//.test(ua) && !/Chromium/i.test(ua)) {
    browser = 'safari';
    browserVersion = safari[1];
  }

  let os = 'unknown';
  let osVersion = '';
  const win = /Windows NT ([\d.]+)/.exec(ua);
  const mac = /Mac OS X ([\d_]+)/.exec(ua);
  const ios = /OS ([\d_]+) like Mac OS X/.exec(ua);
  const android = /Android ([\d.]+)/.exec(ua);

  if (ios) {
    os = 'ios';
    osVersion = ios[1].replace(/_/g, '.');
  } else if (android) {
    os = 'android';
    osVersion = android[1];
  } else if (mac) {
    os = 'macos';
    osVersion = mac[1].replace(/_/g, '.');
  } else if (win) {
    os = 'windows';
    osVersion = win[1];
  }

  return { device, browser, browserVersion, os, osVersion };
}

async function persistClientTelemetry(conversationId: string, userAgentHeader: string | undefined) {
  try {
    const ua = String(userAgentHeader || '').trim();
    if (!ua) return;

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { userId: true },
    });
    if (!conversation?.userId) return;

    const userFlow = await prisma.userFlow.findUnique({ where: { userId: conversation.userId } });
    const flowId = userFlow?.flowId;
    if (!flowId) return;

    const parsed = parseUserAgent(ua);
    await flowHelpers.setUserData(conversation.userId, flowId, {
      client_user_agent: ua,
      client_device: parsed.device,
      client_browser: parsed.browser,
      client_browser_version: parsed.browserVersion,
      client_os: parsed.os,
      client_os_version: parsed.osVersion,
    }, conversationId);
  } catch (e) {
    // Best-effort; should never break chat UX
    logger.warn('Failed to persist client telemetry', { error: (e as any)?.message });
  }
}

registerRoute('get', '/api/v1/agent/chat-stream', async (req, res) => {
  const message = req.query.message as string | undefined;
  const conversationId = req.query.conversationId as string | undefined;
  const channel = (req.query.channel as string) || 'web';

  if (!message) {
    res
      .status(400)
      .json({ ok: false, error: 'Message query parameter is required' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  if ((res as any).flushHeaders) {
    (res as any).flushHeaders();
  }

  const sendEvent = (event: string, data: any) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  let closed = false;
  req.on('close', () => {
    closed = true;
  });

  let conversationIdResult: string | null = null;
  let finalTextResult: string | null = null;

  try {
    const processingRes = flowEngine.processMessage({
      conversationId,
      message,
      channel: 'web',
      stream: true,
      debugCallback: (level, message, data) => {
        if (!closed) {
          sendEvent('debug', { level, message, data, timestamp: new Date().toISOString() });
        }
      },
    });

    try {
      for await (const chunk of processingRes) {
        if (closed) {
          // Client disconnected, stop processing
          return;
        }

        try {
          if (typeof chunk === 'string') {
            // Stream token
            sendEvent('token', { textChunk: chunk });
          } else {
            // Final result
            conversationIdResult = chunk.conversationId;
            finalTextResult = chunk.finalText;
            await persistClientTelemetry(chunk.conversationId, req.headers['user-agent'] as string | undefined);
            sendEvent('done', {
              conversationId: chunk.conversationId,
              finalText: chunk.finalText,
            });
            // Final result received, stream is complete
            break;
          }
        } catch (chunkError: any) {
          // Error processing a chunk - log but continue
          logger.error('Error processing chunk:', chunkError);
          if (!closed) {
            sendEvent('error', {
              message: 'Error processing response chunk',
            });
            break;
          }
        }
      }
    } catch (iterError: any) {
      // Error during iteration
      logger.error('Error during stream iteration:', iterError);
      throw iterError;
    }

    // Ensure response is closed after stream completes
    if (!closed && !res.writableEnded) {
      // If we didn't get a final result, send done with what we have
      if (!conversationIdResult) {
        logger.warn('Stream completed without final result');
        sendEvent('done', {
          conversationId: conversationId || '',
          finalText: finalTextResult || '',
        });
      }
      res.end();
    }
  } catch (error: any) {
    logger.error('Streaming chat error:', error);
    if (!closed && !res.writableEnded) {
      // DEBUG: Send error as text to UI
      try {
        sendEvent('token', { textChunk: `\n\nDEBUG ERROR: ${error?.message}\nSTACK: ${error?.stack}` });
        sendEvent('done', { conversationId: conversationId || '', finalText: error?.message });
      } catch (e) { /* ignore */ }

      try {
        sendEvent('error', {
          message: error?.message || 'Streaming failed',
        });
      } catch (sendError) {
        // Ignore if we can't send error event
        logger.error('Error sending error event:', sendError);
      }
      res.end();
    }
  } finally {
    // Ensure response is always closed
    if (!closed && !res.writableEnded) {
      try {
        res.end();
      } catch (e) {
        // Ignore errors when closing - response might already be closed
      }
    }
  }
});

// POST endpoint for non-streaming messages (for testing)
registerRoute('post', '/api/v1/agent/message', async (req, res) => {
  try {
    const { message, conversationId, channel = 'web' } = req.body;

    if (!message) {
      res.status(400).json({ ok: false, error: 'Message is required' });
      return;
    }

    let conversationIdResult: string | null = conversationId || null;
    let finalTextResult: string = '';

    const processingRes = flowEngine.processMessage({
      conversationId,
      message,
      channel: channel as 'web' | 'whatsapp',
      stream: false,
    });

    try {
      for await (const chunk of processingRes) {
        if (typeof chunk === 'string') {
          finalTextResult += chunk;
        } else {
          conversationIdResult = chunk.conversationId;
          finalTextResult = chunk.finalText;
          await persistClientTelemetry(chunk.conversationId, req.headers['user-agent'] as string | undefined);
          break;
        }
      }
    } catch (iterError: any) {
      logger.error('Error during message processing:', iterError);
      throw iterError;
    }

    res.json({
      ok: true,
      conversationId: conversationIdResult,
      finalText: finalTextResult,
      message: finalTextResult, // For compatibility
    });
  } catch (error: any) {
    logger.error('Message processing error:', error);
    res.status(500).json({
      ok: false,
      error: error?.message || 'Failed to process message',
    });
  }
});
