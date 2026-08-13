/**
 * Vendor / Provider SVG assets from the same package used by octafuse-website.
 *
 * Explicit static imports let Next emit content-hashed files under `/_next/static/media`;
 * no duplicated files or manual cache version is needed in `public/vendors`.
 */
import agnesAiIcon from '@lobehub/icons-static-svg/icons/agnesai.svg';
import alibabaCloudIcon from '@lobehub/icons-static-svg/icons/alibabacloud.svg';
import anthropicIcon from '@lobehub/icons-static-svg/icons/anthropic.svg';
import awsIcon from '@lobehub/icons-static-svg/icons/aws.svg';
import azureAiIcon from '@lobehub/icons-static-svg/icons/azureai.svg';
import baichuanIcon from '@lobehub/icons-static-svg/icons/baichuan.svg';
import baiduCloudIcon from '@lobehub/icons-static-svg/icons/baiducloud.svg';
import bailianIcon from '@lobehub/icons-static-svg/icons/bailian.svg';
import bytedanceIcon from '@lobehub/icons-static-svg/icons/bytedance.svg';
import cerebrasIcon from '@lobehub/icons-static-svg/icons/cerebras.svg';
import cloudflareIcon from '@lobehub/icons-static-svg/icons/cloudflare.svg';
import cohereIcon from '@lobehub/icons-static-svg/icons/cohere.svg';
import deepseekIcon from '@lobehub/icons-static-svg/icons/deepseek.svg';
import fireworksIcon from '@lobehub/icons-static-svg/icons/fireworks.svg';
import geminiIcon from '@lobehub/icons-static-svg/icons/gemini.svg';
import githubIcon from '@lobehub/icons-static-svg/icons/github.svg';
import groqIcon from '@lobehub/icons-static-svg/icons/groq.svg';
import huaweiCloudIcon from '@lobehub/icons-static-svg/icons/huaweicloud.svg';
import huggingfaceIcon from '@lobehub/icons-static-svg/icons/huggingface.svg';
import hunyuanIcon from '@lobehub/icons-static-svg/icons/hunyuan.svg';
import ibmIcon from '@lobehub/icons-static-svg/icons/ibm.svg';
import kimiIcon from '@lobehub/icons-static-svg/icons/kimi.svg';
import longcatIcon from '@lobehub/icons-static-svg/icons/longcat.svg';
import metaIcon from '@lobehub/icons-static-svg/icons/meta.svg';
import minimaxIcon from '@lobehub/icons-static-svg/icons/minimax.svg';
import mistralIcon from '@lobehub/icons-static-svg/icons/mistral.svg';
import modelscopeIcon from '@lobehub/icons-static-svg/icons/modelscope.svg';
import moonshotIcon from '@lobehub/icons-static-svg/icons/moonshot.svg';
import nvidiaIcon from '@lobehub/icons-static-svg/icons/nvidia.svg';
import ollamaIcon from '@lobehub/icons-static-svg/icons/ollama.svg';
import openaiIcon from '@lobehub/icons-static-svg/icons/openai.svg';
import opencodeIcon from '@lobehub/icons-static-svg/icons/opencode.svg';
import openrouterIcon from '@lobehub/icons-static-svg/icons/openrouter.svg';
import perplexityIcon from '@lobehub/icons-static-svg/icons/perplexity.svg';
import pollinationsIcon from '@lobehub/icons-static-svg/icons/pollinations.svg';
import qiniuIcon from '@lobehub/icons-static-svg/icons/qiniu.svg';
import qwenIcon from '@lobehub/icons-static-svg/icons/qwen.svg';
import siliconCloudIcon from '@lobehub/icons-static-svg/icons/siliconcloud.svg';
import stabilityIcon from '@lobehub/icons-static-svg/icons/stability.svg';
import stepfunIcon from '@lobehub/icons-static-svg/icons/stepfun.svg';
import tencentCloudIcon from '@lobehub/icons-static-svg/icons/tencentcloud.svg';
import togetherIcon from '@lobehub/icons-static-svg/icons/together.svg';
import vertexAiIcon from '@lobehub/icons-static-svg/icons/vertexai.svg';
import volcengineIcon from '@lobehub/icons-static-svg/icons/volcengine.svg';
import xaiIcon from '@lobehub/icons-static-svg/icons/xai.svg';
import xiaomiMimoIcon from '@lobehub/icons-static-svg/icons/xiaomimimo.svg';
import zaiIcon from '@lobehub/icons-static-svg/icons/zai.svg';
import zenmuxIcon from '@lobehub/icons-static-svg/icons/zenmux.svg';
import zhipuIcon from '@lobehub/icons-static-svg/icons/zhipu.svg';

type StaticSvgAsset = string | { src: string };

function assetUrl(asset: StaticSvgAsset): string {
	return typeof asset === 'string' ? asset : asset.src;
}

export const vendorIconAssets: Readonly<Record<string, string>> = {
	agnes: assetUrl(agnesAiIcon),
	aliyun: assetUrl(alibabaCloudIcon),
	amazon: assetUrl(awsIcon),
	anthropic: assetUrl(anthropicIcon),
	azure: assetUrl(azureAiIcon),
	baichuan: assetUrl(baichuanIcon),
	baidu: assetUrl(baiduCloudIcon),
	bytedance: assetUrl(bytedanceIcon),
	cerebras: assetUrl(cerebrasIcon),
	cloudflare: assetUrl(cloudflareIcon),
	cohere: assetUrl(cohereIcon),
	deepseek: assetUrl(deepseekIcon),
	fireworks: assetUrl(fireworksIcon),
	google: assetUrl(geminiIcon),
	github: assetUrl(githubIcon),
	groq: assetUrl(groqIcon),
	huawei: assetUrl(huaweiCloudIcon),
	huggingface: assetUrl(huggingfaceIcon),
	ibm: assetUrl(ibmIcon),
	meituan: assetUrl(longcatIcon),
	meta: assetUrl(metaIcon),
	minimax: assetUrl(minimaxIcon),
	mistral: assetUrl(mistralIcon),
	modelscope: assetUrl(modelscopeIcon),
	moonshot: assetUrl(moonshotIcon),
	nvidia: assetUrl(nvidiaIcon),
	ollama: assetUrl(ollamaIcon),
	openai: assetUrl(openaiIcon),
	opencode: assetUrl(opencodeIcon),
	openrouter: assetUrl(openrouterIcon),
	perplexity: assetUrl(perplexityIcon),
	pollinations: assetUrl(pollinationsIcon),
	qiniu: assetUrl(qiniuIcon),
	siliconflow: assetUrl(siliconCloudIcon),
	stability: assetUrl(stabilityIcon),
	stepfun: assetUrl(stepfunIcon),
	tencent: assetUrl(tencentCloudIcon),
	together: assetUrl(togetherIcon),
	volcengine: assetUrl(volcengineIcon),
	xai: assetUrl(xaiIcon),
	xiaomi: assetUrl(xiaomiMimoIcon),
	zenmux: assetUrl(zenmuxIcon),
	zhipu: assetUrl(zhipuIcon),
};

export const productIconAssets: Readonly<Record<string, string>> = {
	bailian: assetUrl(bailianIcon),
	hunyuan: assetUrl(hunyuanIcon),
	kimi: assetUrl(kimiIcon),
	longcat: assetUrl(longcatIcon),
	qwen: assetUrl(qwenIcon),
	vertexai: assetUrl(vertexAiIcon),
	xiaomimimo: assetUrl(xiaomiMimoIcon),
	zai: assetUrl(zaiIcon),
};
