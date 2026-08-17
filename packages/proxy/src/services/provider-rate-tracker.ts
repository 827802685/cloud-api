/**
 * Provider 速率限制追踪器：按 (providerId, modelId) 维度追踪 RPM/TPM，
 * 在路由决策时主动避开接近限额的 provider。
 *
 * 设计要点：
 * - 滑动窗口计数器（每分钟/每日），进程内存存储
 * - 当上游返回 429 时自动记录实际上限（从响应体或 Retry-After 推断）
 * - 路由规划时查询剩余预算，优先选择余量最大的 provider
 * - 与 circuit breaker 互补：circuit breaker 处理硬错误，rate tracker 做预防性调度
 */

/** 速率限制维度 */
export interface RateLimitCounters {
  /** 每分钟请求数 */
  rpm: number;
  /** 每分钟 token 数 */
  tpm: number;
  /** 每日请求数 */
  rpd: number;
  /** 每日 token 数 */
  tpd: number;
}

/** Provider 速率限制状态 */
interface ProviderRateState {
  /** 当前分钟的请求计数 */
  minuteRequests: number;
  /** 当前分钟的 token 计数 */
  minuteTokens: number;
  /** 当前分钟的起始时间 */
  minuteStart: number;
  /** 当日的请求计数 */
  dayRequests: number;
  /** 当日的 token 计数 */
  dayTokens: number;
  /** 当日的起始日期 */
  dayStart: string;
  /** 已知的 RPM 上限（从 429 响应学习） */
  knownRpmLimit: number | null;
  /** 已知的 TPM 上限 */
  knownTpmLimit: number | null;
  /** 已知的 RPD 上限 */
  knownRpdLimit: number | null;
  /** 最近一次 429 的时间 */
  lastRateLimitAt: number;
  /** 连续 429 次数 */
  consecutiveRateLimits: number;
}

const MAX_ENTRIES = 10_000;
const MINUTE_MS = 60_000;

/** 默认安全阈值：当使用率达到已知限额的此比例时开始避开 */
const SAFE_THRESHOLD_RATIO = 0.8;

const rateByProvider = new Map<string, ProviderRateState>();

function getOrCreateState(key: string, now = Date.now()): ProviderRateState {
  let state = rateByProvider.get(key);
  if (!state) {
    const dayStart = new Date(now).toISOString().slice(0, 10);
    state = {
      minuteRequests: 0,
      minuteTokens: 0,
      minuteStart: now - (now % MINUTE_MS),
      dayRequests: 0,
      dayTokens: 0,
      dayStart,
      knownRpmLimit: null,
      knownTpmLimit: null,
      knownRpdLimit: null,
      lastRateLimitAt: 0,
      consecutiveRateLimits: 0,
    };
    rateByProvider.set(key, state);
    if (rateByProvider.size > MAX_ENTRIES) {
      purgeStaleEntries(now);
    }
  }
  return state;
}

function purgeStaleEntries(now: number): void {
  const cutoff = now - 5 * MINUTE_MS;
  for (const [key, state] of rateByProvider) {
    if (
      state.minuteStart < cutoff &&
      state.lastRateLimitAt < cutoff &&
      state.knownRpmLimit === null
    ) {
      rateByProvider.delete(key);
    }
  }
}

function ensureMinuteWindow(state: ProviderRateState, now: number): void {
  const currentMinuteStart = now - (now % MINUTE_MS);
  if (state.minuteStart !== currentMinuteStart) {
    state.minuteRequests = 0;
    state.minuteTokens = 0;
    state.minuteStart = currentMinuteStart;
  }
}

function ensureDayWindow(state: ProviderRateState, now: number): void {
  const today = new Date(now).toISOString().slice(0, 10);
  if (state.dayStart !== today) {
    state.dayRequests = 0;
    state.dayTokens = 0;
    state.dayStart = today;
  }
}

/**
 * 记录一次请求。
 * @param providerId Provider ID
 * @param tokens 本次请求消耗的 token 数（可选，在响应后调用）
 */
export function recordProviderRequest(providerId: string, tokens: number = 0, now = Date.now()): void {
  const state = getOrCreateState(providerId, now);
  ensureMinuteWindow(state, now);
  ensureDayWindow(state, now);
  state.minuteRequests += 1;
  state.minuteTokens += tokens;
  state.dayRequests += 1;
  state.dayTokens += tokens;
}

/**
 * 记录一次速率限制事件，并尝试从响应中学习实际上限。
 * @param providerId Provider ID
 * @param limits 从上游响应中解析出的限制值
 */
export function recordRateLimitEvent(
  providerId: string,
  limits?: { rpm?: number; tpm?: number; rpd?: number },
  now = Date.now()
): void {
  const state = getOrCreateState(providerId, now);
  state.lastRateLimitAt = now;
  state.consecutiveRateLimits += 1;

  // 学习实际上限
  if (limits?.rpm != null && limits.rpm > 0) {
    state.knownRpmLimit = limits.rpm;
  }
  if (limits?.tpm != null && limits.tpm > 0) {
    state.knownTpmLimit = limits.tpm;
  }
  if (limits?.rpd != null && limits.rpd > 0) {
    state.knownRpdLimit = limits.rpd;
  }
}

/**
 * 请求成功后重置连续限流计数。
 */
export function recordProviderSuccess(providerId: string, now = Date.now()): void {
  const state = rateByProvider.get(providerId);
  if (!state) return;
  state.consecutiveRateLimits = 0;
}

/**
 * 获取 provider 的健康评分（0-1，1 为最健康）。
 * 用于路由决策时排序：评分越高越优先。
 * @param providerId Provider ID
 * @returns 健康评分，无数据时返回 1（默认健康）
 */
export function getProviderHealthScore(providerId: string, now = Date.now()): number {
  const state = rateByProvider.get(providerId);
  if (!state) return 1;

  ensureMinuteWindow(state, now);
  ensureDayWindow(state, now);

  let score = 1;

  // 检查 RPM 是否接近限额
  if (state.knownRpmLimit != null && state.knownRpmLimit > 0) {
    const ratio = state.minuteRequests / state.knownRpmLimit;
    if (ratio >= 1) {
      return 0; // 已超限
    }
    if (ratio >= SAFE_THRESHOLD_RATIO) {
      // 线性衰减：从 SAFE_THRESHOLD_RATIO 到 1.0 之间，评分从 0.5 降到 0
      score = Math.min(score, Math.max(0, 1 - (ratio - SAFE_THRESHOLD_RATIO) / (1 - SAFE_THRESHOLD_RATIO)));
    }
  }

  // 检查 TPM 是否接近限额
  if (state.knownTpmLimit != null && state.knownTpmLimit > 0) {
    const ratio = state.minuteTokens / state.knownTpmLimit;
    if (ratio >= 1) {
      return 0;
    }
    if (ratio >= SAFE_THRESHOLD_RATIO) {
      score = Math.min(score, Math.max(0, 1 - (ratio - SAFE_THRESHOLD_RATIO) / (1 - SAFE_THRESHOLD_RATIO)));
    }
  }

  // 检查 RPD 是否接近限额
  if (state.knownRpdLimit != null && state.knownRpdLimit > 0) {
    const ratio = state.dayRequests / state.knownRpdLimit;
    if (ratio >= 1) {
      return 0;
    }
    if (ratio >= SAFE_THRESHOLD_RATIO) {
      score = Math.min(score, Math.max(0, 1 - (ratio - SAFE_THRESHOLD_RATIO) / (1 - SAFE_THRESHOLD_RATIO)));
    }
  }

  // 最近有过 429 但还不知道限额：轻微降分
  if (state.knownRpmLimit === null && state.consecutiveRateLimits > 0) {
    const timeSinceLastLimit = now - state.lastRateLimitAt;
    if (timeSinceLastLimit < MINUTE_MS) {
      score = Math.min(score, 0.3); // 最近限流过，大幅降分
    } else if (timeSinceLastLimit < 5 * MINUTE_MS) {
      score = Math.min(score, 0.6);
    }
  }

  // ─── 空配额启发式（null-limit heuristic）─────────────────────────────
  // 参考 freellmapi：对未公布日限额的 provider，用「近 1h 内 2+ 次 429」作为有效耗尽信号。
  // 常见于 Ollama、Cloudflare Workers AI 等无明确 RPD 发布限额的平台。
  const HOUR_MS = 60 * MINUTE_MS;
  if (
    state.knownRpmLimit == null &&
    state.knownRpdLimit == null &&
    state.consecutiveRateLimits >= 2 &&
    (now - state.lastRateLimitAt) < HOUR_MS
  ) {
    // 该 provider 无已知日限额但频繁 429 → 视为日配额已耗尽
    score = Math.min(score, 0.1);
  }

  // ─── 429 次数递增降分 ──────────────────────────────────────────────
  // 同一 key 短时间内多次 429，额外惩罚
  if (state.consecutiveRateLimits >= 3) {
    score = Math.min(score, 0.2);
  } else if (state.consecutiveRateLimits >= 2) {
    score = Math.min(score, 0.4);
  }

  return score;
}

/**
 * 获取 provider 当前速率统计（供管理面板或调试使用）。
 */
export function getProviderRateStats(providerId: string, now = Date.now()): RateLimitCounters & {
  knownLimits: { rpm: number | null; tpm: number | null; rpd: number | null };
  healthScore: number;
} {
  const state = rateByProvider.get(providerId);
  if (!state) {
    return {
      rpm: 0,
      tpm: 0,
      rpd: 0,
      tpd: 0,
      knownLimits: { rpm: null, tpm: null, rpd: null },
      healthScore: 1,
    };
  }

  ensureMinuteWindow(state, now);
  ensureDayWindow(state, now);

  return {
    rpm: state.minuteRequests,
    tpm: state.minuteTokens,
    rpd: state.dayRequests,
    tpd: state.dayTokens,
    knownLimits: {
      rpm: state.knownRpmLimit,
      tpm: state.knownTpmLimit,
      rpd: state.knownRpdLimit,
    },
    healthScore: getProviderHealthScore(providerId, now),
  };
}

/**
 * 从上游 429 响应体中尝试解析速率限制信息。
 * 支持常见格式：OpenAI、Groq、Gemini 等。
 */
export function parseRateLimitFromResponseBody(
  body: unknown,
  status: number
): { rpm?: number; tpm?: number; rpd?: number } | null {
  if (status !== 429 || !body || typeof body !== 'object') return null;

  const obj = body as Record<string, unknown>;

  // OpenAI 格式: { error: { message, type, param, code }, rpm, tpm }
  // 或者在 headers 中: x-ratelimit-limit-requests, x-ratelimit-remaining-requests
  const rpm = typeof obj.rpm === 'number' ? obj.rpm : undefined;
  const tpm = typeof obj.tpm === 'number' ? obj.tpm : undefined;

  // Groq 格式: { error: { message: "...rate limit...", code: "rate_limit_exceeded" } }
  // 通常没有具体数值，但可以从错误消息中提取
  const error = obj.error as Record<string, unknown> | undefined;
  if (error && typeof error.message === 'string') {
    const msg = error.message.toLowerCase();
    // 尝试从消息中提取数字
    const rpmMatch = msg.match(/(\d+)\s*(?:requests?|calls?)\s*per\s*minute/);
    const tpmMatch = msg.match(/(\d+)\s*tokens?\s*per\s*minute/);
    return {
      rpm: rpm ?? (rpmMatch ? Number(rpmMatch[1]) : undefined),
      tpm: tpm ?? (tpmMatch ? Number(tpmMatch[1]) : undefined),
    };
  }

  if (rpm != null || tpm != null) {
    return { rpm, tpm };
  }

  return null;
}

/**
 * 从上游响应头中解析速率限制信息。
 */
export function parseRateLimitFromHeaders(headers: Headers): { rpm?: number; tpm?: number; rpd?: number } | null {
  const result: { rpm?: number; tpm?: number; rpd?: number } = {};

  // OpenAI 风格: x-ratelimit-limit-requests
  const limitRequests = headers.get('x-ratelimit-limit-requests');
  if (limitRequests) {
    const val = Number(limitRequests);
    if (Number.isFinite(val) && val > 0) result.rpm = val;
  }

  const limitTokens = headers.get('x-ratelimit-limit-tokens');
  if (limitTokens) {
    const val = Number(limitTokens);
    if (Number.isFinite(val) && val > 0) result.tpm = val;
  }

  // 某些 provider 使用不同的头名称
  const limitRpm = headers.get('x-rate-limit-rpm');
  if (limitRpm && !result.rpm) {
    const val = Number(limitRpm);
    if (Number.isFinite(val) && val > 0) result.rpm = val;
  }

  const limitTpm = headers.get('x-rate-limit-tpm');
  if (limitTpm && !result.tpm) {
    const val = Number(limitTpm);
    if (Number.isFinite(val) && val > 0) result.tpm = val;
  }

  return Object.keys(result).length > 0 ? result : null;
}

/** 测试用：清空所有速率限制状态 */
export function resetRateTrackerStateForTests(): void {
  rateByProvider.clear();
}
