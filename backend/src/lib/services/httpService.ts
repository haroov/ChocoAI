import { logApiCall } from '../../utils/trackApiCall';
import { logger } from '../../utils/logger';

interface RequestOptions extends RequestInit {
    conversationId: string;
    operationName?: string;
    providerName?: string; // Defaults to 'ExternalAPI'
}

class HttpService {
  /**
     * GET request with automatic logging to Conversation Timeline
     */
  async get(url: string, options: RequestOptions): Promise<Response> {
    return this.request(url, { ...options, method: 'GET' });
  }

  /**
     * POST request with automatic logging to Conversation Timeline
     */
  async post(url: string, body: any, options: RequestOptions): Promise<Response> {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };
    return this.request(url, {
      ...options,
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  }

  /**
     * PUT request with automatic logging to Conversation Timeline
     */
  async put(url: string, body: any, options: RequestOptions): Promise<Response> {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };
    return this.request(url, {
      ...options,
      method: 'PUT',
      headers,
      body: JSON.stringify(body),
    });
  }

  /**
     * DELETE request with automatic logging to Conversation Timeline
     */
  async delete(url: string, options: RequestOptions): Promise<Response> {
    return this.request(url, { ...options, method: 'DELETE' });
  }

  /**
     * Internal request handler with manual logging to separate Logged Data from Returned Response
     */
  private async request(url: string, options: RequestOptions): Promise<Response> {
    const { conversationId, operationName, providerName, ...fetchOptions } = options;
    const provider = providerName || 'ExternalAPI';
    const operation = operationName || `HTTP ${options.method || 'GET'} ${this.sanitizeUrl(url)}`;

    // 1. Prepare Request Log Payload
    const requestLogPayload = {
      url: this.sanitizeUrl(url),
      method: options.method,
      headers: this.sanitizeHeaders(options.headers),
      body: options.body ? this.tryParseJson(String(options.body)) : undefined,
    };

    const t0 = Date.now();

    try {
      // 2. Execute Fetch
      const response = await fetch(url, fetchOptions);
      const latencyMs = Date.now() - t0;

      // 3. Clone and Read Body for Logging (without consuming the returned response)
      // Since response.clone() works, we can just use that.
      const clonedResponse = response.clone();

      const responseLogPayload: any = {
        status: response.status,
        statusText: response.statusText,
        headers: this.sanitizeHeaders(Object.fromEntries(response.headers.entries())),
      };

      // Try to read body for logging
      try {
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          const bodyText = await clonedResponse.text();
          responseLogPayload.body = this.tryParseJson(bodyText);
        } else if (contentType && contentType.includes('text/')) {
          const bodyText = await clonedResponse.text();
          responseLogPayload.body = bodyText.substring(0, 1000); // Truncate long text
        }
      } catch (e) {
        responseLogPayload.bodyParseError = 'Failed to read response body for logging';
      }

      // 4. Log Success
      await logApiCall({
        conversationId,
        provider,
        operation,
        request: requestLogPayload,
        response: responseLogPayload,
        status: response.ok ? 'ok' : 'error', // Log 4xx/5xx as 'error' status for visibility
        latencyMs,
      });

      return response;

    } catch (error: any) {
      const latencyMs = Date.now() - t0;

      // 5. Log Network Error
      await logApiCall({
        conversationId,
        provider,
        operation,
        request: requestLogPayload,
        response: { error: error?.message || 'Network Error' },
        status: 'error',
        latencyMs,
      });

      throw error;
    }
  }

  private sanitizeUrl(url: string): string {
    // Could implement query param redaction here
    return url;
  }

  private sanitizeHeaders(headers: any): any {
    if (!headers) return {};
    // Handle Headers object or plain object
    const sanitized: any = {};

    // If headers is a Headers object, simpler to just treat as opaque or basic check
    // Only redact common sensitive headers
    if (typeof headers.forEach === 'function') {
      // It's a Headers object, skip iteration for now or convert
      return { ...headers, Authorization: '[REDACTED]' }; // Loose approximation
    }

    for (const key in headers) {
      if (key.toLowerCase() === 'authorization') {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = headers[key];
      }
    }
    return sanitized;
  }

  private tryParseJson(text: string) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
}

export const httpService = new HttpService();
