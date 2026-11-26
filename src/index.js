const MODEL = "gemini-3.8-flash";
const SYSTEM_INSTRUCTION = `أنت NEX AI، مساعد ذكي عربي موثوق. أجب بلغة المستخدم، وافهم اللهجة السودانية واستخدمها بلطف عندما تناسب السياق.
كن دقيقاً وواضحاً ومنظماً. لا تخترع معلومات أو مصادر أو روابط. إذا لم تكن متأكداً فقل ذلك بوضوح.
عند الأسئلة التي تتطلب معلومات حديثة، استخدم أداة بحث Google إذا كانت متاحة، وميّز بين الحقائق والاستنتاجات.
لا تدّعِ أنك نفذت إجراءً خارج المحادثة. احترم الخصوصية ولا تطلب كلمات المرور أو مفاتيح API.`;

const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra }
});

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "*";
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "Content-Type",
    "vary": "Origin"
  };
}

function extractText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) return payload.output_text.trim();
  const pieces = [];
  for (const step of payload?.steps || []) {
    if (step?.type !== "model_output") continue;
    for (const part of step?.content || []) if (part?.type === "text" && part.text) pieces.push(part.text);
  }
  return pieces.join("\n").trim();
}

function extractCitations(payload) {
  const found = [];
  for (const step of payload?.steps || []) {
    if (step?.type !== "model_output") continue;
    for (const part of step?.content || []) {
      for (const annotation of part?.annotations || []) {
        if (annotation?.type === "url_citation" && annotation.url) {
          found.push({ title: annotation.title || annotation.url, url: annotation.url });
        }
      }
    }
  }
  return [...new Map(found.map(item => [item.url, item])).values()].slice(0, 8);
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({ ok: true, app: "NEX AI", model: MODEL, apiKeyConfigured: Boolean(env.GEMINI_API_KEY) }, 200, cors);
    }

    if (url.pathname === "/api/chat" && request.method === "POST") {
      if (!env.GEMINI_API_KEY) return json({ error: "مفتاح Gemini غير مضبوط في إعدادات الخادم." }, 503, cors);
      let body;
      try { body = await request.json(); } catch { return json({ error: "صيغة الطلب غير صحيحة." }, 400, cors); }

      const message = String(body?.message || "").trim();
      if (!message) return json({ error: "اكتب رسالتك أولاً." }, 400, cors);
      if (message.length > 12000) return json({ error: "الرسالة طويلة جداً. اختصرها قليلاً." }, 413, cors);

      const history = Array.isArray(body?.history) ? body.history.slice(-12) : [];
      const transcript = history
        .filter(item => item && ["user", "assistant"].includes(item.role) && typeof item.content === "string")
        .map(item => (item.role === "user" ? "المستخدم" : "NEX AI") + ": " + item.content.slice(0, 5000))
        .join("\n\n");
      const input = (transcript ? "سياق المحادثة السابقة:\n" + transcript + "\n\n" : "") + "رسالة المستخدم الحالية:\n" + message;

      const requestBody = { model: MODEL, system_instruction: SYSTEM_INSTRUCTION, input };
      if (body?.webSearch === true) requestBody.tools = [{ type: "google_search" }];

      try {
        const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
          body: JSON.stringify(requestBody)
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          const providerMessage = payload?.error?.message || "تعذر الاتصال بخدمة Gemini.";
          return json({ error: providerMessage, providerStatus: response.status }, response.status === 429 ? 429 : 502, cors);
        }
        const answer = extractText(payload);
        if (!answer) return json({ error: "وصل رد غير مكتمل من نموذج الذكاء الاصطناعي. حاول مرة أخرى." }, 502, cors);
        return json({ answer, citations: extractCitations(payload), model: MODEL, interactionId: payload?.id || null }, 200, cors);
      } catch {
        return json({ error: "تعذر الوصول إلى خدمة الذكاء الاصطناعي. تحقق من اتصال الإنترنت ثم أعد المحاولة." }, 502, cors);
      }
    }

    if (url.pathname.startsWith("/api/")) return json({ error: "المسار غير موجود." }, 404, cors);
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("NEX AI assets are not configured.", { status: 503 });
  }
};