const MODEL = "gemini-3.8-flash";
const FAST_MODEL = "gemini-3.1-flash-lite";
const FALLBACK_MODEL = "gemini-3.5-flash-lite";
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

function extractOutput(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) return payload.output_text.trim();
  const texts = [];
  for (const step of payload?.steps || []) {
    if (step?.type !== "model_output") continue;
    for (const part of step?.content || []) {
      if (typeof part?.text === "string" && part.text.trim()) texts.push(part.text);
    }
  }
  return texts.join("\n").trim();
}

function extractCitations(payload) {
  const refs = [];
  for (const step of payload?.steps || []) {
    for (const part of step?.content || []) {
      for (const annotation of part?.annotations || []) {
        const citation = annotation?.url_citation || annotation;
        if (citation?.url) refs.push({ title: citation.title || citation.url, url: citation.url });
      }
    }
  }
  return [...new Map(refs.map(ref => [ref.url, ref])).values()].slice(0, 8);
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({
        ok: true, app: "NEX AI", model: MODEL, api: "interactions",
        apiKeyConfigured: Boolean(env.GEMINI_API_KEY),
        chatRoute: "ready", version: "diagnostic-2026-11-28"
      }, 200, cors);
    }

    if (url.pathname === "/api/chat" && request.method === "POST") {
      if (!env.GEMINI_API_KEY) return json({ error: "مفتاح Gemini غير مضبوط في إعدادات الخادم.", stage: "configuration" }, 503, cors);
      let body;
      try { body = await request.json(); } catch {
        return json({ error: "صيغة الطلب غير صحيحة.", stage: "request-json" }, 400, cors);
      }

      const message = String(body?.message || "").trim();
      if (!message) return json({ error: "اكتب رسالتك أولاً." }, 400, cors);
      if (message.length > 12000) return json({ error: "الرسالة طويلة جداً. اختصرها قليلاً." }, 413, cors);

      const history = Array.isArray(body?.history) ? body.history.slice(-10) : [];
      const transcript = history
        .filter(item => item && ["user", "assistant"].includes(item.role) && typeof item.content === "string")
        .map(item => (item.role === "assistant" ? "NEX AI" : "المستخدم") + ": " + item.content.slice(0, 3000))
        .join("\n\n");
      const input = (transcript ? "سياق المحادثة السابقة:\n" + transcript + "\n\n" : "") +
        "رسالة المستخدم الحالية:\n" + message;

      const requestBody = {
        model: MODEL,
        input,
        system_instruction: SYSTEM_INSTRUCTION,
        store: false
      };
      if (body?.webSearch === true) requestBody.tools = [{ type: "google_search" }];

      try {
        const callGemini = async (model) => {
          const requestBody = {
            model,
            input,
            system_instruction: SYSTEM_INSTRUCTION,
            store: false
          };
          if (body?.webSearch === true) requestBody.tools = [{ type: "google_search" }];
          const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
            method: "POST",
            headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
            body: JSON.stringify(requestBody),
            signal: AbortSignal.timeout(45000)
          });
          const payload = await response.json().catch(() => ({}));
          return { response, payload };
        };

        // Use the low-latency Flash-Lite model for ordinary chat.
        // Keep the larger model for requests that explicitly ask for web search.
        let usedModel = body?.webSearch === true ? MODEL : FAST_MODEL;
        let result = await callGemini(usedModel);

        // If the primary model is temporarily overloaded, automatically try the
        // lower-latency Flash-Lite model so the user can still receive an answer.
        if (result.response.status === 503 || result.response.status === 429) {
          console.warn("NEX selected model busy; trying fallback", result.response.status);
          const fallback = usedModel === FALLBACK_MODEL ? MODEL : FALLBACK_MODEL;
          usedModel = fallback;
          result = await callGemini(fallback);
        }

        const { response, payload } = result;
        if (!response.ok) {
          const providerMessage = payload?.error?.message || payload?.message || "تعذر الاتصال بخدمة Gemini.";
          console.error("NEX Gemini API error", response.status, payload?.error?.status || "unknown");
          return json({
            error: providerMessage,
            stage: "gemini-provider",
            providerStatus: response.status,
            providerCode: payload?.error?.status || payload?.error?.code || null,
            attemptedModels: [body?.webSearch === true ? MODEL : FAST_MODEL, ...(usedModel !== (body?.webSearch === true ? MODEL : FAST_MODEL) ? [usedModel] : [])],
            hint: response.status === 503
              ? "خدمة Gemini مشغولة مؤقتاً؛ حاول بعد قليل."
              : response.status === 429
                ? "تجاوزت حصة الاستخدام مؤقتاً؛ انتظر قليلاً ثم أعد المحاولة."
                : undefined
          }, response.status === 429 ? 429 : 502, cors);
        }
        const answer = extractOutput(payload);
        if (!answer) {
          console.error("NEX empty Gemini output", payload?.status, Object.keys(payload || {}));
          return json({
            error: "وصل رد من Gemini دون نص إجابة واضح.",
            stage: "empty-model-output",
            interactionStatus: payload?.status || null,
            responseShape: Object.keys(payload || {})
          }, 502, cors);
        }
        return json({
          answer,
          citations: extractCitations(payload),
          model: payload?.model || usedModel,
          responseId: payload?.id || null,
          fallbackUsed: usedModel === FALLBACK_MODEL
        }, 200, cors);
      } catch (error) {
        const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
        console.error("NEX Gemini request failed", error?.name || "FetchError");
        return json({
          error: timedOut
            ? "تأخر رد Gemini أكثر من 50 ثانية. أعد المحاولة."
            : "تعذر الوصول إلى خدمة Gemini. تحقق من اتصال الخادم.",
          stage: timedOut ? "provider-timeout" : "provider-network",
          diagnostic: error?.name || "FetchError"
        }, 502, cors);
      }
    }

    if (url.pathname.startsWith("/api/")) return json({ error: "المسار غير موجود." }, 404, cors);
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("NEX AI assets are not configured.", { status: 503 });
  }
};