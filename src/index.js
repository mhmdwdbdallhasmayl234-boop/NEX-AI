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

function getAnswer(payload) {
  return (payload?.candidates?.[0]?.content?.parts || [])
    .filter(part => typeof part.text === "string")
    .map(part => part.text)
    .join("\n").trim();
}

function getCitations(payload) {
  const chunks = payload?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  const refs = chunks.map(chunk => chunk.web).filter(web => web?.uri)
    .map(web => ({ title: web.title || web.uri, url: web.uri }));
  return [...new Map(refs.map(ref => [ref.url, ref])).values()].slice(0, 8);
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
      const contents = history
        .filter(item => item && ["user", "assistant"].includes(item.role) && typeof item.content === "string")
        .map(item => ({
          role: item.role === "assistant" ? "model" : "user",
          parts: [{ text: item.content.slice(0, 5000) }]
        }));
      contents.push({ role: "user", parts: [{ text: message }] });

      const requestBody = {
        systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        contents,
        generationConfig: { maxOutputTokens: 2048 }
      };
      if (body?.webSearch === true) requestBody.tools = [{ google_search: {} }];

      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
          {
            method: "POST",
            headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
            body: JSON.stringify(requestBody),
            signal: AbortSignal.timeout(45000)
          }
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          const providerMessage = payload?.error?.message || "تعذر الاتصال بخدمة Gemini.";
          return json({
            error: providerMessage,
            providerStatus: response.status,
            hint: response.status === 429 ? "تجاوزت حصة الاستخدام مؤقتاً؛ انتظر قليلاً ثم أعد المحاولة." : undefined
          }, response.status === 429 ? 429 : 502, cors);
        }
        const answer = getAnswer(payload);
        if (!answer) return json({ error: "لم يُرجع النموذج نصاً. حاول برسالة أقصر." }, 502, cors);
        return json({
          answer,
          citations: getCitations(payload),
          model: payload?.modelVersion || MODEL,
          responseId: payload?.responseId || null
        }, 200, cors);
      } catch (error) {
        const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
        return json({
          error: timedOut
            ? "استغرق رد Gemini وقتاً أطول من المعتاد. أعد المحاولة بعد قليل."
            : "تعذر الوصول إلى خدمة Gemini. تحقق من الإنترنت ثم أعد المحاولة."
        }, 502, cors);
      }
    }

    if (url.pathname.startsWith("/api/")) return json({ error: "المسار غير موجود." }, 404, cors);
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("NEX AI assets are not configured.", { status: 503 });
  }
};