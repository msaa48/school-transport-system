// tests/login.spec.js
// الهدف من الملف ده: يفتح صفحة login.html ويجرب يسجل دخول بنفس بيانات
// التجربة اللي جربتها إنت بنفسك يدويًا ونجحت، عشان نتأكد إنها لسه شغالة.

const { test, expect } = require('@playwright/test');

// رابط الموقع اللي هيتفتح. بيتحدد من متغير بيئة BASE_URL
// (يعني قيمة بتتحط من بره الكود، في إعدادات الاستضافة أو GitHub Secrets)
// لحد ما يبقى عندنا استضافة دائمة، سيبها كده هتتحدد وقت التشغيل.
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

// بيانات التجربة الحقيقية اللي جربتها إنت ونجحت
const TEST_PHONE = '01001234567';
// محتفظ بيهم هنا عشان نستخدمهم لما نوسّع التست بعد بناء صفحة الداشبورد
const TEST_SCHOOL = 'مدرسة النور الابتدائية';
const TEST_STUDENT = 'أحمد محمود علي';
// كلمة السر: لازم تتحط كمتغير بيئة TEST_PASSWORD (GitHub Secret)
// مش مكتوبة هنا صريح عشان منسربهاش في الكود
const TEST_PASSWORD = process.env.TEST_PASSWORD || '';

test.describe('تسجيل دخول ولي الأمر', () => {
  test('ولي الأمر يقدر يسجل دخول ببياناته الحقيقية', async ({ page }) => {
    // يفتح صفحة الدخول
    await page.goto(`${BASE_URL}/`);

    // يتأكد إن تاب "تسجيل الدخول" (مش "حساب جديد") هو المفتوح
    // بنستخدم data-mode بدل النص، عشان "دخول" نص متكرر
    // في التاب وفي زرار الإرسال في نفس الصفحة
    await page.click('.tab[data-mode="login"]');

    // يكتب رقم التليفون
    await page.fill('#phone', TEST_PHONE);

    // يكتب كلمة السر
    await page.fill('#password', TEST_PASSWORD);

    // يضغط زرار الدخول (id="submitBtn" — الزرار الأصلي بدون type="submit")
    await page.click('#submitBtn');

    // يتأكد إن الدخول نجح فعلاً — دلوقتي الصفحة بتوقف عند رسالة نجاح
    // بس (مفيش redirect لصفحة داشبورد لسه — ده لسه TODO في login-v2.html).
    // لما تتبني صفحة الداشبورد، وسّع التست ده يتأكد كمان من ظهور
    // TEST_STUDENT و TEST_SCHOOL في الصفحة الجديدة.
    await expect(page.locator('#msg')).toContainText('تم تسجيل الدخول بنجاح', { timeout: 10000 });
  });
});
