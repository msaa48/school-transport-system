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
const TEST_SCHOOL = 'مدرسة النور الابتدائية';
const TEST_STUDENT = 'أحمد محمود علي';
// كلمة السر: لازم تتحط كمتغير بيئة TEST_PASSWORD (GitHub Secret)
// مش مكتوبة هنا صريح عشان منسربهاش في الكود
const TEST_PASSWORD = process.env.TEST_PASSWORD || '';

test.describe('تسجيل دخول ولي الأمر', () => {
  test('ولي الأمر يقدر يسجل دخول ببياناته الحقيقية', async ({ page }) => {
    // يفتح صفحة الدخول
    await page.goto(`${BASE_URL}/login.html`);

    // يتأكد إن تاب "دخول" (مش "حساب جديد") هو المفتوح
    await page.click('text=دخول');

    // يكتب رقم التليفون
    await page.fill('#phone', TEST_PHONE);

    // يكتب كلمة السر
    await page.fill('#password', TEST_PASSWORD);

    // يضغط زرار الدخول
    await page.click('button[type="submit"]');

    // يتأكد إن الدخول نجح فعلاً — بيدور على اسم الطالب أو اسم المدرسة
    await expect(page.locator('body')).toContainText(TEST_STUDENT, { timeout: 10000 });
    await expect(page.locator('body')).toContainText(TEST_SCHOOL);
  });
});
