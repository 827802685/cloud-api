import { workerApp } from './runtime/workers';

export type { Env } from './app';

export default workerApp;

// 供 Admin（Playground）复用的稳定性跟踪接口
export {
	recordRouteStabilitySuccess,
	recordRouteStabilityFailure,
	getRouteStabilityScore,
	effectiveRouteWeight,
	resetRouteStabilityStateForTests,
} from './services/route-stability-tracker';
export type { RouteFailureKind } from './services/route-stability-tracker';

// 四维模型质量评分（稳定性×参数量×上下文×免费额度）+ Workers AI 归类
export {
	scoreModelQuality,
	scoreParams,
	scoreContext,
	scoreFreeQuota,
	classifyWithWorkersAI,
} from './services/model-quality-scorer';
export type {
	ModelQualityInput,
	ModelQualityScore,
	WorkersAiClassification,
	WorkersAiBinding,
} from './services/model-quality-scorer';
