const $ = (id) => document.getElementById(id);
const form = $("chatForm"), input = $("messageInput"), messagesEl = $("messages");
let history = [];
let busy = false;

function toast(message) {
  const el = $("toast"); el.textContent = message; el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 4500);
}
function addMessage(role, text, citations = []) {
  $("welcome").hidden = true;
  const row = document.createElement("div"); row.className = "message " + role;
  const avatar = document.createElement("div"); avatar.className = "avatar"; avatar.textContent = role === "user" ? "أ" : "N";
  const bubble = document.createElement("div"); bubble.className = "bubble"; bubble.textContent = text;
  if (citations.length) {
    const box = document.createElement("div"); box.className = "citations";
    const title = document.createElement("div"); title.textContent = "المصادر"; box.appendChild(title);
    citations.forEach(item => {
      try {
        const url = new URL(item.url);
        if (!["http:", "https:"].includes(url.protocol)) return;
        const a = document.createElement("a"); a.href = url.href; a.target = "_blank"; a.rel = "noopener noreferrer";
        a.textContent = "↗ " + (item.title || url.hostname); box.appendChild(a);
      } catch {}
    });
    bubble.appendChild(box);
  }
  row.append(avatar, bubble); messagesEl.appendChild(row);
  $("chatArea").scrollTo({ top: $("chatArea").scrollHeight, behavior: "smooth" });
  return row;
}
function setBusy(value) {
  busy = value; $("sendButton").disabled = value;
  $("sendButton").querySelector("span").textContent = value ? "يرد..." : "إرسال";
}
async function sendMessage(text) {
  text = String(text || "").trim();
  if (!text || busy) return;
  addMessage("user", text); history.push({ role: "user", content: text });
  input.value = ""; input.style.height = "auto"; setBusy(true);
  const pending = addMessage("assistant", "NEX AI يتصل بالخادم...");
  pending.querySelector(".bubble").classList.add("typing");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 58000);
  try {
    const response = await fetch("/api/chat", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: text, history: history.slice(0, -1), webSearch: $("webSearch").checked }),
      signal: controller.signal,
      cache: "no-store"
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = data.providerStatus ? " (رمز الخدمة: " + data.providerStatus + ")" : "";
      throw new Error((data.error || "حدث خطأ أثناء إرسال الرسالة.") + detail);
    }
    if (typeof data.answer !== "string" || !data.answer.trim()) throw new Error("وصل رد فارغ من الخادم. أعد المحاولة.");
    pending.querySelector(".bubble").textContent = data.answer;
    pending.querySelector(".bubble").classList.remove("typing");
    if (data.citations?.length) {
      const box = document.createElement("div"); box.className = "citations";
      const title = document.createElement("div"); title.textContent = "المصادر"; box.appendChild(title);
      data.citations.forEach(item => {
        try { const u = new URL(item.url); if (!["http:","https:"].includes(u.protocol)) return;
          const a = document.createElement("a"); a.href = u.href; a.target = "_blank"; a.rel = "noopener noreferrer"; a.textContent = "↗ " + (item.title || u.hostname); box.appendChild(a);
        } catch {}
      });
      pending.querySelector(".bubble").appendChild(box);
    }
    history.push({ role: "assistant", content: data.answer });
  } catch (error) {
    const message = error.name === "AbortError" ? "انتهت مهلة الاتصال بعد 58 ثانية. تحقق من الخادم ثم أعد المحاولة." : (error.message || "تعذر الاتصال بالخادم.");
    const bubble = pending.querySelector(".bubble");
    bubble.textContent = "تعذر الحصول على الرد: " + message;
    bubble.classList.remove("typing");
    bubble.style.borderColor = "#a85b68";
    toast(message);
    history.pop();
  } finally { clearTimeout(timer); setBusy(false); input.focus(); }
}
form.addEventListener("submit", e => { e.preventDefault(); sendMessage(input.value); });
input.addEventListener("input", () => { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 170) + "px"; });
input.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
document.querySelectorAll(".suggestion").forEach(button => button.addEventListener("click", () => sendMessage(button.dataset.prompt)));
$("newChat").addEventListener("click", () => { history = []; messagesEl.replaceChildren(); $("welcome").hidden = false; $("sidebar").classList.remove("open"); input.focus(); });
$("menuButton").addEventListener("click", () => $("sidebar").classList.toggle("open"));

$("voiceButton").addEventListener("click", () => {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return toast("الإملاء الصوتي غير مدعوم في هذا المتصفح. جرّب ميكروفون لوحة المفاتيح.");
  const recognition = new SpeechRecognition(); recognition.lang = "ar"; recognition.interimResults = false;
  recognition.onresult = event => { input.value = (input.value + " " + event.results[0][0].transcript).trim(); input.dispatchEvent(new Event("input")); };
  recognition.onerror = () => toast("لم نتمكن من التقاط الصوت. تحقق من إذن الميكروفون.");
  recognition.start();
});

fetch("/api/health").then(r => r.json()).then(data => {
  if (!data.apiKeyConfigured) toast("واجهة NEX جاهزة، لكن مفتاح Gemini يحتاج إلى ضبط في الخادم.");
}).catch(() => toast("تعذر فحص اتصال الخادم."));
