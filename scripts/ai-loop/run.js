const { createClient } = require('@supabase/supabase-js');
const { chromium } = require('playwright');
const fs = require('fs');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function callDeepSeek(prompt) {
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await res.json();
  return data.choices[0].message.content;
}

async function callGeminiReview(codeDiff, screenshotBase64, dbContext) {
  const parts = [
    {
      text:
        `راجع الكود ده وقولي فيه مشاكل منطقية:\n${codeDiff}\n\n` +
        `بيانات القاعدة الحالية ذات الصلة:\n${dbContext}\n\n` +
        `في النهاية لازم ترد بسطر واحد بالظبط يبدأ بـ "القرار:" وبعده كلمة "موافقة" أو "رفض".`,
    },
  ];
  if (screenshotBase64) {
    parts.push({ inline_data: { mime_type: 'image/png', data: screenshotBase64 } });
    parts.push({ text: 'وده screenshot للصفحة بعد التعديل — احكم بصريًا كمان.' });
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts }] }),
    }
  );
  const data = await res.json();
  return data.candidates[0].content.parts[0].text;
}

async function takeScreenshot(url) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(url);
  const buffer = await page.screenshot();
  await browser.close();
  return buffer.toString('base64');
}

async function readContext(table, filters = {}) {
  const { data, error } = await supabase.from(table).select('*').match(filters);
  if (error) throw new Error(`Supabase read failed: ${error.message}`);
  return data;
}

function isApproved(geminiReview) {
  const match = geminiReview.match(/القرار:\s*(موافقة|رفض)/);
  return match && match[1] === 'موافقة';
}

async function applyChange(table, values, filters) {
  const { data, error } = await supabase.from(table).update(values).match(filters);
  if (error) throw new Error(`Supabase write failed: ${error.message}`);
  return data;
}

(async () => {
  const task = process.env.TASK_DESCRIPTION || 'حدد المهمة';
  const report = [];

  try {
    const proposedCode = await callDeepSeek(task);
    report.push(`## اقتراح DeepSeek\n${proposedCode}`);

    const dbRows = await readContext('buses');
    const dbContext = JSON.stringify(dbRows, null, 2);

    const screenshot = await takeScreenshot(process.env.BASE_URL);
    const review = await callGeminiReview(proposedCode, screenshot, dbContext);
    report.push(`## مراجعة Gemini\n${review}`);

    if (isApproved(review)) {
      report.push('## القرار النهائي\n✅ Gemini وافق — لم يُنفَّذ تعديل تلقائي على القاعدة في هذه النسخة.');
      // await applyChange('buses', { ... }, { id: '...' });
    } else {
      report.push('## القرار النهائي\n❌ Gemini رفض — لم يتم أي تعديل، يحتاج مراجعة يدوية.');
    }
  } catch (err) {
    report.push(`## خطأ\n${err.message}`);
  }

  fs.writeFileSync('ai-loop-report.md', report.join('\n\n'));
  console.log(report.join('\n\n'));
})();
