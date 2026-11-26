/**
 * NEX AI 3.0
 * Main Backend - Cloudflare Workers
 * Powered by Gemini 3.8 Flash
 */

const CONFIG = {
  NAME: "NEX AI",
  VERSION: "3.0.0",
  MODEL: "gemini-3.8-flash"
};

const SYSTEM_PROMPT = `
أنت NEX AI، مساعد ذكاء اصطناعي احترافي.

شخصيتك:
- ذكي ودقيق وتحليلي.
- ودود وسهل التعامل.
- تفهم اللغة العربية واللهجة السودانية.
- تساعد المستخدم على الابتكار والتعلم وحل المشكلات.

قواعدك:
1. لا تخترع المعلومات.
2. اعترف عندما لا تعرف الإجابة.
3. اشرح الحلول التقنية خطوة بخطوة.
4. قدم إجابات واضحة ومنظمة.
5. استخدم أمثلة عملية عند الحاجة.
6. اهتم بالمستخدمين في السودان واحتياجاتهم.
7. لا تدّعِ أنك نفذت عملية لم تنفذها فعلياً.

هدفك:
أن تكون مساعداً ذكياً موثوقاً ومفيداً للجميع.
`;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json; charset=utf-8"
};

function response(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: CORS
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }

    if (url.pathname === "/api/health") {
      return response({
        success: true,
        app: CONFIG.NAME,
        version: CONFIG.VERSION,
        status: "online"
      });
    }

    if (url.pathname === "/api/chat" && request.method === "POST") {
      try {
        if (!env.GEMINI_API_KEY) {
          return response({
            success: false,
            error: "مفتاح Gemini API غير مضبوط"
          }, 503);
        }

        const body = await request.json();

        const message = String(body.message || "").trim();

        if (!message) {
          return response({
            success: false,
            error: "اكتب رسالتك أولاً"
          }, 400);
        }

        if (message.length > 20000) {
          return response({
            success: false,
            error: "الرسالة طويلة جداً"
          }, 413);
        }

        const history = Array.isArray(body.history)
          ? body.history.slice(-12)
          : [];

        const conversation = history
          .map(item => {
            const role = item.role === "assistant"
              ? "NEX AI"
              : "المستخدم";

            return `${role}: ${String(item.content || "").slice(0, 5000)}`;
          })
          .join("\n\n");

        const input = `
${SYSTEM_PROMPT}

سياق المحادثة السابقة:
${conversation}

رسالة المستخدم الحالية:
${message}

أجب عن رسالة المستخدم الحالية مع مراعاة سياق المحادثة.
`;

        const apiResponse = await fetch(
          "https://generativelanguage.googleapis.com/v1beta/interactions",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": env.GEMINI_API_KEY
            },
            body: JSON.stringify({
              model: CONFIG.MODEL,
              input
            })
          }
        );

        const result = await apiResponse.json();

        if (!apiResponse.ok) {
          return response({
            success: false,
            error: "تعذر الاتصال بمحرك الذكاء الاصطناعي",
            details: result.error?.message || "API Error"
          }, 502);
        }

        let answer = result.output_text || "";

        if (!answer && Array.isArray(result.outputs)) {
          answer = result.outputs
            .flatMap(item => item.content || [])
            .filter(item => item.type === "text")
            .map(item => item.text)
            .join("\n");
        }

        if (!answer) {
          return response({
            success: false,
            error: "لم يصل رد نصي من المحرك"
          }, 502);
        }

        return response({
          success: true,
          app: CONFIG.NAME,
          answer,
          model: CONFIG.MODEL
        });

      } catch (error) {
        return response({
          success: false,
          error: "حدث خطأ أثناء معالجة الطلب"
        }, 500);
      }
    }

    return response({
      success: false,
      error: "المسار غير موجود"
    }, 404);
  }
};
