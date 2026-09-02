// tests/login.spec.js
// الهدف من الملف ده: يفتح صفحة index.html ويجرب يسجل دخول بنفس بيانات
// التجربة اللي جربتها إنت بنفسك يدويًا ونجحت، عشان نتأكد إنها لسه شغالة.
// الملف ده بيغطي دلوقتي دورين: ولي الأمر والسائق.

const { test, expect } = require('@playwright/test');

// رابط الموقع اللي هيتفتح. بيتحدد من متغير بيئة BASE_URL
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

// بيانات تجربة ولي الأمر (نفس اللي جربتها ونجحت)
const PARENT_PHONE = '01001234567';
// محتفظ بيهم هنا عشان نستخدمهم لما نوسّع التست بعد بناء صفحة الداشبورد
const TEST_SCHOOL = 'مدرسة النور الابتدائية';
const TEST_STUDENT = 'أحمد محمود علي';
const PARENT_PASSWORD = process.env.TEST_PASSWORD || '';

// بيانات تجربة السائق (الحساب اللي اتعمل واترَبط فعليًا في القاعدة)
const DRIVER_PHONE = '01009876543';
const DRIVER_NAME = 'محمد أحمد';
const DRIVER_PASSWORD = process.env.TEST_DRIVER_PASSWORD || '';

test.describe('تسجيل دخول ولي الأمر', () => {
  test('ولي الأمر يقدر يسجل دخول ببياناته الحقيقية', async ({ page }) => {
    await page.goto(`${BASE_URL}/`);

    // يتأكد إن تاب "تسجيل الدخول" هو المفتوح
    await page.click('.tab[data-mode="login"]');

    // يتأكد إن دور "ولي أمر" هو المختار (الافتراضي، بس نأكد صراحة)
    await page.click('.role-btn[data-role="parent"]');

    await page.fill('#phone', PARENT_PHONE);
    await page.fill('#password', PARENT_PASSWORD);
    await page.click('#submitBtn');

    // لسه مفيش redirect لداشبورد — التوقع بيقف عند رسالة النجاح
    // لما تتبني الداشبورد، وسّع التست ده يتأكد من TEST_STUDENT و TEST_SCHOOL
    await expect(page.locator('#msg')).toContainText('تم تسجيل الدخول بنجاح', { timeout: 10000 });
  });
});

test.describe('تسجيل دخول السائق', () => {
  test('السائق يقدر يسجل دخول ببياناته الحقيقية', async ({ page }) => {
    await page.goto(`${BASE_URL}/`);

    await page.click('.tab[data-mode="login"]');

    // هنا الفرق الأساسي: لازم نختار دور "سائق" صراحة
    // لأن الافتراضي في الصفحة هو "ولي أمر"
    await page.click('.role-btn[data-role="driver"]');

    await page.fill('#phone', DRIVER_PHONE);
    await page.fill('#password', DRIVER_PASSWORD);
    await page.click('#submitBtn');

    await expect(page.locator('#msg')).toContainText('تم تسجيل الدخول بنجاح', { timeout: 10000 });
  });
});
