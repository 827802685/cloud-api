/**
 * OpenAI Responses API（`/v1/responses`）出站驱动。
 *
 * 供 codex++ / Codex CLI 等客户端接入：把请求转发到上游 `{base}/responses`，
 * 解析流式/非流式响应中的 `usage` 用于记账，并在转发前过滤内部元数据字段
 * （`extra_content` 等，见 `response-sanitizer`）。
 *
 * 流式响应是带 `event:` 行的 SSE（`response.created` / `response.output_text.delta` /
 * `response.completed` 等），`data:` 行是 JSON 对象；`response.completed` 事件携带完整 `usage`。
 */
import { resolveUpstreamEndpoint } from '@cloud-api/core';
import type { RouteResult } from '../model-router';
import type { UsageFromStream } from '../proxy';
import { buildRouteRequestBody } from '../route-default-params';
import { extractUpstreamRequestId, normalizeUpstreamId } from './upstream-request-id';
import { sanitizeJsonResponseText, sanitizeSseDataLine } from '../response-sanitizer';
import type { RequestTimingAttempt, RequestTimingCollector } from '../request-timing';

const EMPTY_USAGE_LOCAL: UsageFromStream = {
  input_tokens: 0,
  output_tokens: 0,
  cache_read_tokens: 0,
  cache_write_tokens: 0,
  reasoning_tokens: 0,
  total_tokens: 0,
  raw_usage: null,
};

/** Client disconnected后继续从上游读取以争取拿到末尾 usage 的最大时长。 */
const POST_DISCONNECT_DRAIN_MS = 90_000;

const decoder = new TextDecoder();
const encoder = new TextEncoder();

type ResponsesUsage = {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  input_tokens_details?: {
    cached_tokens?: number;
    text_tokens?: number;
    audio_tokens?: number;
  };
  output_tokens_details?: {
    reasoning_tokens?: number;
    text_tokens?: number;
    audio_tokens?: number;
  };
};

type SSEState = { lineBuffer: string };

function usageFromResponses(u: ResponsesUsage): UsageFromStream {
  const inputTokens = u.input_tokens ?? 0;
  const outputTokens = u.output_tokens ?? 0;
  const cacheRead = u.input_tokens_details?.cached_tokens ?? 0;
  const reasoning = u.output_tokens_details?.reasoning_tokens ?? 0;
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_read_tokens: cacheRead,
    cache_write_tokens: 0,
    reasoning_tokens: reasoning,
    total_tokens: u.total_tokens ?? inputTokens + outputTokens,
    raw_usage: JSON.stringify(u),
  };
}

function applyUsage(target: UsageFromStream, next: UsageFromStream): void {
  target.input_tokens = next.input_tokens;
  target.output_tokens = next.output_tokens;
  target.cache_read_tokens = next.cache_read_tokens;
  target.cache_write_tokens = next.cache_write_tokens;
  target.reasoning_tokens = next.reasoning_tokens;
  target.total_tokens = next.total_tokens;
  target.raw_usage = next.raw_usage;
}

/** 从单条 `data:` JSON 解析 usage / message id（`response.completed` 事件携带完整 usage）。 */
function processDataLine(data: string, usage: UsageFromStream, timing?: RequestTimingCollector | null): void {
  if (!data || data === '[DONE]') return;
  try {
    const parsed = JSON.parse(data) as {
      id?: string;
      type?: string;
      usage?: ResponsesUsage;
      delta?: string;
      output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
    };
    timing?.markFirstEvent();
    // Responses 流式：`response.output_text.delta` 事件带 `delta` 文本；非流式在 `output[].content[].text`
    if (typeof parsed.delta === 'string' && parsed.delta.length > 0) {
      usage.streamedContent = true;
    }
    if (Array.isArray(parsed.output)) {
      for (const item of parsed.output) {
        if (item?.type === 'message' && Array.isArray(item.content)) {
          for (const part of item.content) {
            if (part?.type === 'output_text' && typeof part.text === 'string' && part.text.length > 0) {
              usage.streamedContent = true;
            }
          }
        }
      }
    }
    if (!usage.upstreamMessageId) {
      const msgId = normalizeUpstreamId(parsed.id);
      if (msgId) usage.upstreamMessageId = msgId;
    }
    if (parsed.usage) {
      applyUsage(usage, usageFromResponses(parsed.usage));
    }
  } catch {
    // ignore parse failures
  }
}

function parseSSEChunk(
  chunk: Uint8Array,
  state: SSEState,
  usage: UsageFromStream,
  timing?: RequestTimingCollector | null
): string {
  state.lineBuffer += decoder.decode(chunk, { stream: true });
  const lines = state.lineBuffer.split('\n');
  state.lineBuffer = lines.pop() ?? '';
  let forward = '';
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const data = line.slice(6).trim();
      if (data && data !== '[DONE]') {
        processDataLine(data, usage, timing);
      }
    }
    // 过滤内部元数据字段（extra_content 等）；非 data 行原样保留
    forward += sanitizeSseDataLine(line) + '\n';
  }
  return forward;
}

function processRemainingLineBuffer(
  state: SSEState,
  usage: UsageFromStream,
  timing?: RequestTimingCollector | null
): string {
  const line = state.lineBuffer.trim();
  if (!line) return '';
  if (line.startsWith('data: ')) {
    const data = line.slice(6).trim();
    if (data && data !== '[DONE]') {
      processDataLine(data, usage, timing);
    }
  }
  return sanitizeSseDataLine(line) + '\n';
}

async function pumpWithUsageTracking(
  upstream: ReadableStream<Uint8Array>,
  downstream: WritableStream<Uint8Array>,
  usage: UsageFromStream,
  resolveUsage: (u: UsageFromStream) => void,
  requestSignal?: AbortSignal,
  timing?: RequestTimingCollector | null
): Promise<void> {
  const reader = upstream.getReader();
  const writer = downstream.getWriter();
  const state: SSEState = { lineBuffer: '' };
  let clientDisconnected = false;
  let disconnectTime = 0;

  const onAbort = (): void => {
    usage.cancelled = true;
    clientDisconnected = true;
  };
  requestSignal?.addEventListener('abort', onAbort);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        const forward = processRemainingLineBuffer(state, usage, timing);
        if (forward && !clientDisconnected) {
          try {
            await writer.write(encoder.encode(forward));
          } catch {
            clientDisconnected = true;
            disconnectTime = Date.now();
            usage.cancelled = true;
          }
        }
        break;
      }

      if (value.byteLength > 0) timing?.markFirstByte();
      const forward = parseSSEChunk(value, state, usage, timing);

      if (forward && !clientDisconnected) {
        try {
          await writer.write(encoder.encode(forward));
        } catch {
          clientDisconnected = true;
          disconnectTime = Date.now();
          usage.cancelled = true;
        }
      }

      if (
        clientDisconnected &&
        disconnectTime > 0 &&
        Date.now() - disconnectTime > POST_DISCONNECT_DRAIN_MS
      ) {
        await reader.cancel();
        break;
      }
    }
  } catch (err) {
    console.warn('[Gateway Responses] pump error', err instanceof Error ? err.message : String(err));
  } finally {
    requestSignal?.removeEventListener('abort', onAbort);
    timing?.markStreamComplete();
    resolveUsage(usage);
    try {
      await writer.close();
    } catch (err) {
      console.warn(
        '[Gateway Responses] pump writer.close (non-fatal)',
        err instanceof Error ? err.message : String(err),
        { clientDisconnected, usageCancelled: usage.cancelled }
      );
    }
  }
}

function streamResponseWithUsage(
  response: Response,
  requestSignal?: AbortSignal,
  timing?: RequestTimingCollector | null
): { response: Response; usagePromise: Promise<UsageFromStream> } {
  let resolveUsage!: (u: UsageFromStream) => void;
  const usagePromise = new Promise<UsageFromStream>((resolve) => {
    resolveUsage = resolve;
  });

  const usage: UsageFromStream = { ...EMPTY_USAGE_LOCAL };
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();

  pumpWithUsageTracking(response.body!, writable, usage, resolveUsage, requestSignal, timing).catch(() => {
    // resolveUsage already called in finally
  });

  return {
    response: new Response(readable, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('Content-Type') ?? 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    }),
    usagePromise,
  };
}

async function nonStreamResponseWithUsage(
  response: Response,
  timing?: RequestTimingCollector | null
): Promise<{ response: Response; usagePromise: Promise<UsageFromStream> }> {
  const contentType = response.headers.get('Content-Type') ?? '';
  if (!contentType.includes('application/json')) {
    return {
      response,
      usagePromise: Promise.resolve(EMPTY_USAGE_LOCAL),
    };
  }
  let usage: UsageFromStream = EMPTY_USAGE_LOCAL;
  try {
    const text = await response.text();
    timing?.markStreamComplete();
    const parsed = JSON.parse(text) as {
      id?: string;
      usage?: ResponsesUsage;
      output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
    };
    if (parsed.usage) {
      usage = usageFromResponses(parsed.usage);
    }
    // 上游未返回 usage 但确实有回答内容时，标记 streamedContent，避免误判 incomplete
    if (Array.isArray(parsed.output)) {
      for (const item of parsed.output) {
        if (item?.type === 'message' && Array.isArray(item.content)) {
          for (const part of item.content) {
            if (part?.type === 'output_text' && typeof part.text === 'string' && part.text.length > 0) {
              usage.streamedContent = true;
            }
          }
        }
      }
    }
    const msgId = normalizeUpstreamId(parsed.id);
    if (msgId) usage = { ...usage, upstreamMessageId: msgId };
    // 过滤内部元数据字段（extra_content 等），只返回干净内容
    const sanitizedText = sanitizeJsonResponseText(text);
    return {
      response: new Response(sanitizedText, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      }),
      usagePromise: Promise.resolve(usage),
    };
  } catch {
    timing?.markStreamComplete();
    return {
      response,
      usagePromise: Promise.resolve(EMPTY_USAGE_LOCAL),
    };
  }
}

/**
 * 向供应商发起 OpenAI 兼容 `POST …/responses`：合并路由默认参数、`model` 换为上游名。
 * 流式响应解析 SSE 中的 usage；非 JSON 200 走流处理分支。
 */
export async function dispatchOpenAiResponsesRoute(
  route: RouteResult,
  body: Record<string, unknown>,
  requestSignal?: AbortSignal,
  timing?: RequestTimingCollector | null,
  attempt?: RequestTimingAttempt
): Promise<{ response: Response; usagePromise: Promise<UsageFromStream>; upstreamRequestId: string | null }> {
  const url = resolveUpstreamEndpoint('openai', 'responses', route.providerEndpoints, {
    providerId: route.providerId,
  });
  const requestBody = {
    ...buildRouteRequestBody(route, body),
    model: route.providerModelName,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${route.providerApiKey}`,
    },
    body: JSON.stringify(requestBody),
    // 透传 hedge/客户端取消 signal，避免上游挂起时 failover 卡死
    signal: requestSignal,
  });
  timing?.markAttemptHeaders(attempt, response.status);
  const upstreamRequestId = extractUpstreamRequestId(response.headers);

  if (response.ok && response.body) {
    const contentType = response.headers.get('Content-Type') ?? '';
    if (contentType.includes('application/json')) {
      const result = await nonStreamResponseWithUsage(response, timing);
      return { ...result, upstreamRequestId };
    }
    const result = streamResponseWithUsage(response, requestSignal, timing);
    return { ...result, upstreamRequestId };
  }

  return {
    response,
    usagePromise: Promise.resolve(EMPTY_USAGE_LOCAL),
    upstreamRequestId,
  };
}
