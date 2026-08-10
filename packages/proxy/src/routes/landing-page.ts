/**
 * Landing page HTML for the API gateway root path.
 */

export const LANDING_PAGE_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OctaFuse Gateway - 统一大模型 API 路由</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 2rem 1rem;
    }
    .container { max-width: 720px; width: 100%; }
    .header { text-align: center; margin-bottom: 2rem; }
    .header h1 {
      font-size: 2.2rem;
      font-weight: 700;
      color: #fff;
      margin-bottom: 0.5rem;
    }
    .header h1 span { color: #38bdf8; }
    .header p { color: #94a3b8; font-size: 1rem; }
    .card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 1.5rem;
      margin-bottom: 1.5rem;
    }
    .card h2 {
      font-size: 1.1rem;
      font-weight: 600;
      color: #38bdf8;
      margin-bottom: 1rem;
    }
    .endpoint-list { list-style: none; }
    .endpoint-list li {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.5rem 0;
      border-bottom: 1px solid #334155;
    }
    .endpoint-list li:last-child { border-bottom: none; }
    .method {
      display: inline-block;
      padding: 0.15rem 0.5rem;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 600;
      font-family: monospace;
      min-width: 52px;
      text-align: center;
    }
    .method-post { background: #1e3a5f; color: #60a5fa; }
    .method-get { background: #14532d; color: #4ade80; }
    .path { font-family: monospace; color: #cbd5e1; font-size: 0.9rem; flex: 1; }
    .desc { color: #94a3b8; font-size: 0.85rem; }
    .info-row {
      display: flex;
      justify-content: space-between;
      padding: 0.5rem 0;
      border-bottom: 1px solid #334155;
    }
    .info-row:last-child { border-bottom: none; }
    .info-label { color: #94a3b8; font-size: 0.9rem; }
    .info-value { color: #e2e8f0; font-family: monospace; font-size: 0.9rem; }
    .btn {
      display: block;
      width: 100%;
      max-width: 280px;
      margin: 1.5rem auto 0;
      padding: 0.85rem 1.5rem;
      background: #38bdf8;
      color: #0f172a;
      text-align: center;
      text-decoration: none;
      border-radius: 8px;
      font-weight: 600;
      font-size: 1rem;
      transition: background 0.2s;
    }
    .btn:hover { background: #7dd3fc; }
    .models-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.5rem;
    }
    .model-item {
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 6px;
      padding: 0.6rem 0.75rem;
      font-size: 0.8rem;
    }
    .model-name { color: #e2e8f0; font-weight: 500; margin-bottom: 0.2rem; }
    .model-price { color: #4ade80; font-size: 0.75rem; }
    .model-ctx { color: #64748b; font-size: 0.7rem; }
    .free-badge {
      display: inline-block;
      background: #14532d;
      color: #4ade80;
      padding: 0.1rem 0.4rem;
      border-radius: 3px;
      font-size: 0.7rem;
      font-weight: 600;
    }
    .api-key-display {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 6px;
      padding: 0.75rem 1rem;
      gap: 0.75rem;
    }
    .api-key-value {
      font-family: monospace;
      font-size: 0.9rem;
      color: #e2e8f0;
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .api-key-actions {
      display: flex;
      gap: 0.5rem;
    }
    .btn-small {
      background: #334155;
      color: #e2e8f0;
      border: none;
      padding: 0.4rem 0.75rem;
      border-radius: 4px;
      font-size: 0.8rem;
      cursor: pointer;
      transition: background 0.2s;
    }
    .btn-small:hover { background: #475569; }
    @media (max-width: 600px) {
      .models-grid { grid-template-columns: 1fr; }
      .header h1 { font-size: 1.6rem; }
      .api-key-display { flex-direction: column; align-items: stretch; }
      .api-key-actions { justify-content: flex-end; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Octa<span>Fuse</span> Gateway</h1>
      <p>Unified LLM Router · 统一大模型 API 路由</p>
    </div>

    <div class="card">
      <h2>API 端点</h2>
      <ul class="endpoint-list">
        <li>
          <span class="method method-post">POST</span>
          <span class="path">/v1/chat/completions</span>
          <span class="desc">OpenAI 兼容</span>
        </li>
        <li>
          <span class="method method-get">GET</span>
          <span class="path">/v1/models</span>
          <span class="desc">模型列表</span>
        </li>
        <li>
          <span class="method method-post">POST</span>
          <span class="path">/v1/messages</span>
          <span class="desc">Anthropic 兼容</span>
        </li>
        <li>
          <span class="method method-post">POST</span>
          <span class="path">/v1/images/generations</span>
          <span class="desc">图像生成</span>
        </li>
        <li>
          <span class="method method-post">POST</span>
          <span class="path">/v1/audio/transcriptions</span>
          <span class="desc">语音转文字</span>
        </li>
        <li>
          <span class="method method-get">GET</span>
          <span class="path">/v1/me</span>
          <span class="desc">密钥信息</span>
        </li>
      </ul>
    </div>

    <div class="card">
      <h2>快速接入</h2>
      <div class="info-row">
        <span class="info-label">Base URL</span>
        <span class="info-value">https://api.zjkl.dpdns.org/v1</span>
      </div>
      <div class="info-row">
        <span class="info-label">API Key</span>
        <span class="info-value">sk-xxx</span>
      </div>
      <div class="info-row">
        <span class="info-label">OpenAI 兼容</span>
        <span class="info-value">是</span>
      </div>
      <div class="info-row">
        <span class="info-label">智能路由</span>
        <span class="info-value">model: "auto"</span>
      </div>
    </div>

    <div class="card">
      <h2>您的统一 API 密钥</h2>
      <p style="color: #94a3b8; font-size: 0.9rem; margin-bottom: 1rem;">
        将其用作您的 OpenAI api_key，它用于对发往本代理的请求进行身份验证。
      </p>
      <div class="api-key-display">
        <code class="api-key-value">octafuse-01-••••••••••••••••••••</code>
        <div class="api-key-actions">
          <button class="btn-small" onclick="toggleKeyVisibility(this)">显示</button>
          <button class="btn-small" onclick="copyApiKey()">复制</button>
        </div>
      </div>
      <div class="endpoint-info" style="margin-top: 1rem;">
        <div class="info-row">
          <span class="info-label">Base URL</span>
          <span class="info-value">https://api.zjkl.dpdns.org/v1</span>
        </div>
        <div class="info-row">
          <span class="info-label">对话</span>
          <span class="info-value">/v1/chat/completions</span>
        </div>
        <div class="info-row">
          <span class="info-label">响应</span>
          <span class="info-value">/v1/responses</span>
        </div>
        <div class="info-row">
          <span class="info-label">Messages</span>
          <span class="info-value">/v1/messages (兼容 Anthropic)</span>
        </div>
        <div class="info-row">
          <span class="info-label">嵌入</span>
          <span class="info-value">/v1/embeddings (model: "auto" 或「嵌入模型」标签中的系列)</span>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>可用模型 <span class="free-badge">NVIDIA NIM 免费</span></h2>
      <div class="models-grid">
        <div class="model-item">
          <div class="model-name">DeepSeek V4 Flash</div>
          <div class="model-price">免费 · 市场价 $0.14/$0.28 per 1M</div>
          <div class="model-ctx">128K context</div>
        </div>
        <div class="model-item">
          <div class="model-name">Gemma 4 31B IT</div>
          <div class="model-price">免费 · 市场价 $0.10/$0.34 per 1M</div>
          <div class="model-ctx">128K context · Vision</div>
        </div>
        <div class="model-item">
          <div class="model-name">Llama 3.3 70B Instruct</div>
          <div class="model-price">免费 · 市场价 $0.10/$0.30 per 1M</div>
          <div class="model-ctx">128K context</div>
        </div>
        <div class="model-item">
          <div class="model-name">Llama 3.1 70B Instruct</div>
          <div class="model-price">免费 · 市场价 $0.10/$0.30 per 1M</div>
          <div class="model-ctx">128K context</div>
        </div>
        <div class="model-item">
          <div class="model-name">Llama 3.1 8B Instruct</div>
          <div class="model-price">免费 · 市场价 $0.03/$0.06 per 1M</div>
          <div class="model-ctx">128K context</div>
        </div>
        <div class="model-item">
          <div class="model-name">Llama 3.2 90B Vision</div>
          <div class="model-price">免费 · 市场价 $0.10/$0.30 per 1M</div>
          <div class="model-ctx">128K context · Vision</div>
        </div>
        <div class="model-item">
          <div class="model-name">Llama 3.2 11B Vision</div>
          <div class="model-price">免费 · 市场价 $0.18/$0.18 per 1M</div>
          <div class="model-ctx">128K context · Vision</div>
        </div>
        <div class="model-item">
          <div class="model-name">MiniMax M3</div>
          <div class="model-price">免费 · 市场价 $0.10/$1.20 per 1M</div>
          <div class="model-ctx">128K context</div>
        </div>
        <div class="model-item">
          <div class="model-name">Mistral Nemotron</div>
          <div class="model-price">免费 · 市场价 $0.08/$0.08 per 1M</div>
          <div class="model-ctx">128K context</div>
        </div>
        <div class="model-item">
          <div class="model-name">GPT-OSS 120B</div>
          <div class="model-price">免费 · 市场价 $0.15/$0.60 per 1M</div>
          <div class="model-ctx">128K context</div>
        </div>
        <div class="model-item">
          <div class="model-name">GPT-OSS 20B</div>
          <div class="model-price">免费 · 市场价 $0.075/$0.30 per 1M</div>
          <div class="model-ctx">128K context</div>
        </div>
        <div class="model-item">
          <div class="model-name">Nemotron 3 Ultra 550B</div>
          <div class="model-price">免费 · 市场价 $0.50/$2.20 per 1M</div>
          <div class="model-ctx">128K context</div>
        </div>
        <div class="model-item">
          <div class="model-name">Nemotron 3 Super 120B</div>
          <div class="model-price">免费 · 市场价 $0.085/$0.40 per 1M</div>
          <div class="model-ctx">128K context</div>
        </div>
        <div class="model-item">
          <div class="model-name">Nemotron 3 Nano 30B</div>
          <div class="model-price">免费 · 市场价 $0.05/$0.20 per 1M</div>
          <div class="model-ctx">128K context</div>
        </div>
        <div class="model-item">
          <div class="model-name">Nemotron Nano 9B v2</div>
          <div class="model-price">免费 · 市场价 $0.03/$0.06 per 1M</div>
          <div class="model-ctx">128K context</div>
        </div>
        <div class="model-item">
          <div class="model-name">Nemotron Mini 4B</div>
          <div class="model-price">免费 · 市场价 $0.01/$0.02 per 1M</div>
          <div class="model-ctx">128K context</div>
        </div>
        <div class="model-item">
          <div class="model-name">Llama 3.3 Nemotron Super 49B</div>
          <div class="model-price">免费 · 市场价 $1.00/$1.00 per 1M</div>
          <div class="model-ctx">128K context</div>
        </div>
      </div>
    </div>

    <a href="https://admin.api.zjkl.dpdns.org" class="btn">前往管理面板 →</a>
  </div>

  <script>
    let keyVisible = false;
    const actualKey = 'octafuse-01-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
    const maskedKey = 'octafuse-01-••••••••••••••••••••';

    function toggleKeyVisibility(btn) {
      keyVisible = !keyVisible;
      const keyElement = document.querySelector('.api-key-value');
      keyElement.textContent = keyVisible ? actualKey : maskedKey;
      btn.textContent = keyVisible ? '隐藏' : '显示';
    }

    function copyApiKey() {
      navigator.clipboard.writeText(actualKey).then(() => {
        const btn = event.target;
        const originalText = btn.textContent;
        btn.textContent = '已复制!';
        setTimeout(() => { btn.textContent = originalText; }, 2000);
      }).catch(() => {
        alert('复制失败，请手动复制');
      });
    }
  </script>
</body>
</html>`;
