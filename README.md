# NEX AI — فكّر بلا حدود

مساعد ذكي بواجهة عربية واتجاه RTL، يعمل على Cloudflare Workers مع Gemini Interactions API.

## البنية
- `src/index.js`: واجهة API آمنة تتصل بـ Gemini من جهة الخادم.
- `public/`: واجهة التطبيق وملفات CSS وJavaScript وبيان التثبيت.
- `wrangler.toml`: إعداد Cloudflare Workers Static Assets.

## المتغير السري المطلوب
أضف مفتاح Gemini في Cloudflare Worker باسم:
`GEMINI_API_KEY`

لا تضع المفتاح داخل ملفات الواجهة أو GitHub.

## المسارات
- `GET /api/health`: فحص حالة الخادم.
- `POST /api/chat`: إرسال رسالة. يمكن تمرير `webSearch: true` لتفعيل بحث Google.

## النشر
اربط المستودع بمشروع Cloudflare Workers، واجعل إعداد البناء والنشر متوافقاً مع Wrangler. راجع إعدادات الأسرار في Cloudflare قبل النشر.

## ملاحظة
هذا هو الإصدار التأسيسي: المحادثة والبحث الاختياري والإملاء الصوتي عبر المتصفح وواجهة قابلة للتثبيت. تسجيل الدخول، حفظ المحادثات سحابياً، تحليل الصور، إنشاء الصور والفيديو، والمدفوعات مراحل لاحقة وليست مفعلة بعد.