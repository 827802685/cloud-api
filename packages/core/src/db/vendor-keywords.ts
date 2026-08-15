/**
 * 厂商名 → provider 名称匹配关键词。
 * RSS 同步按厂商匹配平台上已有的 provider（带 API key 且 active）。
 * 不同数据库实现（D1 / MySQL / Postgres）共用此映射，避免重复维护。
 */

/** 常见厂商的 provider 名称匹配关键词（小写）。 */
const VENDOR_KEYWORDS: Record<string, string[]> = {
	nvidia: ['nvidia', 'nim'],
	google: ['google', 'gemini', 'vertex', 'generativelanguage'],
	cloudflare: ['cloudflare', 'workers ai'],
	openai: ['openai'],
	anthropic: ['anthropic'],
	mistral: ['mistral'],
	cohere: ['cohere'],
	deepseek: ['deepseek'],
	zhipu: ['zhipu', 'bigmodel', '智谱'],
	modelscope: ['modelscope', '魔搭'],
	opencodezen: ['opencode', 'zen'],
	agnes: ['agnes'],
	openrouter: ['openrouter'],
	volcengine: ['volcengine', 'ark', '火山'],
	moonshot: ['moonshot', 'kimi', '月之暗面'],
	minimax: ['minimax'],
	baidu: ['baidu', 'qianfan', '千帆'],
	tencent: ['tencent', 'hunyuan', '混元'],
	aliyun: ['aliyun', 'bailian', 'dashscope', '百炼', 'qwen'],
	stepfun: ['stepfun', 'step'],
	xai: ['xai', 'grok'],
	meta: ['meta', 'llama'],
	huggingface: ['huggingface', 'hf'],
	stability: ['stability'],
	reka: ['reka'],
	sealion: ['sealion'],
	ovh: ['ovh'],
	xiaomi: ['xiaomi'],
	baichuan: ['baichuan', '百川'],
	github: ['github'],
	cerebras: ['cerebras'],
	perplexity: ['perplexity'],
	meituan: ['meituan', 'longcat', '美团'],
	bytedance: ['bytedance', 'doubao', '豆包'],
};

/**
 * 返回厂商对应的 provider 名称匹配关键词列表。
 * 未收录的厂商回退为厂商名本身。
 */
export function vendorSearchKeywords(vendor: string): string[] {
	const v = vendor.toLowerCase().trim();
	const keywords = VENDOR_KEYWORDS[v];
	if (keywords && keywords.length > 0) return keywords;
	return [v];
}
