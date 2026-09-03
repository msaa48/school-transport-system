// scripts/ai-loop/run.js
//
// الحلقة الفعلية: بتقرأ test-plan.md، تاخد لحد MAX_ITEMS_PER_RUN بنود مش متعلّمة،
// لكل بند: الكاتب (DeepSeek) يكتب كود+تست، بيتشغّل التست فعليًا بـ Playwright،
// الناقد (Gemini) يراجع (منطق + screenshot)، لو التست عدّى فعليًا وGemini وافق
// يتعلّم ✅ في test-plan.md مع commit. لو فشل 3 مرات يتفتح GitHub Issue وينتقل للتالي.
//
// مبني على القواعد في master-prompt.md — أي تغيير في المنطق ده لازم يتراجع مع
// نفس القواعد قبل ما يترفع.

const { createClient } = require('@supabase/supabase-js');
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const MAX_ATTEMPTS_PER_ITEM = parseInt(process.env.MAX_ATTEMPTS_PER_ITEM || '3', 10);
const MAX_ITEMS_PER_RUN = parseInt(process.env.MAX_ITEMS_PER_RUN || '3', 10);
const REPO = process.env.GITHUB_REPOSITORY; // "msaa48/school-transport-system"
const RUN_ID = process.env.GITHUB_RUN_ID || 'local';
const RUN_URL = REPO ? `https://github.com/${REPO}/actions/runs/${RUN_ID}` : '(local run)';

const TEST_PLAN_PATH = path.join(process.cwd(), 'test-plan.md');
const INDEX_PATH = path.join(process.cwd(), 'index.html');
const MASTER_PROMPT_PATH = path.join(process.cwd(), 'master-prompt.md');

const runLog = [];
function log(msg) {
  console.log(msg);
  runLog.push(msg);
}

// ---------- أدوات أساسية ----------

async function callDeepSeek(systemPrompt, userPrompt) {
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.2,
    }),
  });
  const data = await res.json();
  if (!data.choices || !data.choices[0]) {
    throw new Error(`DeepSeek رد بشكل غير متوقع: ${JSON.stringify(data).slice(0, 500)}`);
  }
  return data.choices[0].message.content;
}

async function callGeminiReview(itemText, proposedFiles, testOutput, testPassed, screenshotBase64) {
  const parts = [
    {
      text:
        `أنت الناقد في حلقة تطوير. البند المطلوب تنفيذه من test-plan.md:\n"${itemText}"\n\n` +
        `الملفات اللي اتعدّلت:\n${proposedFiles.map(f => `--- ${f.file} ---\n${f.content.slice(0, 3000)}`).join('\n\n')}\n\n` +
        `نتيجة تشغيل Playwright الفعلية:\n${testOutput.slice(0, 2000)}\n\n` +
        `التست ${testPassed ? 'عدّى (exit code 0)' : 'فشل (exit code != 0)'}.\n\n` +
        `راجع الكود منطقيًا، وتأكد إن قيد عزل بيانات المدارس محفوظ (لو فيه أي شك، ارفض). ` +
        `لو التست فشل فعليًا ارفض تلقائيًا مهما كان الكود شكله صح. ` +
        `في النهاية لازم ترد بسطر واحد بالظبط يبدأ بـ "القرار:" وبعده كلمة "موافقة" أو "رفض"، ` +
        `وبعده سطر "السبب:" بجملة واحدة محددة.`,
    },
  ];
  if (screenshotBase64) {
    parts.push({ inline_data: { mime_type: 'image/png', data: screenshotBase64 } });
    parts.push({ text: 'وده screenshot للصفحة بعد التعديل — احكم بصريًا كمان لو له علاقة بالبند.' });
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
  if (!data.candidates || !data.candidates[0]) {
    throw new Error(`Gemini رد بشكل غير متوقع: ${JSON.stringify(data).slice(0, 500)}`);
  }
  return data.candidates[0].content.parts[0].text;
}

function isApproved(geminiReview) {
  const match = geminiReview.match(/القرار:\s*(موافقة|رفض)/);
  return !!match && match[1] === 'موافقة';
}

async function takeScreenshot(url) {
  try {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(url, { timeout: 15000 });
    const buffer = await page.screenshot();
    await browser.close();
    return buffer.toString('base64');
  } catch (err) {
    log(`⚠️ فشل أخذ screenshot: ${err.message}`);
    return null;
  }
}

// ---------- قراءة/كتابة test-plan.md ----------

function readTestPlan() {
  return fs.readFileSync(TEST_PLAN_PATH, 'utf8');
}

function writeTestPlan(content) {
  fs.writeFileSync(TEST_PLAN_PATH, content, 'utf8');
}

// بيرجع array من {section, text, lineIndex} للبنود الغير متعلّمة، بعيدًا عن قسم 8
function getUncheckedItems(planContent) {
  const lines = planContent.split('\n');
  const items = [];
  let currentSection = '';
  let skipSection = false;

  lines.forEach((line, idx) => {
    const sectionMatch = line.match(/^##\s+(\d+)\.\s*(.+)/);
    if (sectionMatch) {
      currentSection = sectionMatch[2].trim();
      // قسم 8 (جاهزية الإنتاج) ممنوع تلمسه بالكامل — قرارات بشرية بس
      skipSection = sectionMatch[1] === '8';
      return;
    }
    if (skipSection) return;

    const itemMatch = line.match(/^- \[ \] (.+)/);
    if (itemMatch) {
      items.push({ section: currentSection, text: itemMatch[1].trim(), lineIndex: idx });
    }
  });

  // أولوية قصوى لقسم عزل البيانات
  items.sort((a, b) => {
    const aPriority = a.section.includes('عزل البيانات') ? 0 : 1;
    const bPriority = b.section.includes('عزل البيانات') ? 0 : 1;
    return aPriority - bPriority;
  });

  return items;
}

function markItemDone(planContent, lineIndex, itemText) {
  const lines = planContent.split('\n');
  lines[lineIndex] = `- [x] ${itemText} — ✅ تم التأكد فعليًا (AI Development Loop, run #${RUN_ID}, Success) — ${RUN_URL}`;
  return lines.join('\n');
}

// ---------- تشغيل Playwright فعليًا ----------

function runPlaywrightTests() {
  try {
    const output = execSync('npx playwright test --reporter=list', {
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 5 * 60 * 1000,
    });
    return { passed: true, output };
  } catch (err) {
    const output = (err.stdout || '') + '\n' + (err.stderr || '');
    return { passed: false, output };
  }
}

// ---------- استخراج تعديلات الملفات من رد DeepSeek ----------
// متوقع من DeepSeek يرجع بلوكات بالشكل:
// ### FILE: path/to/file
// ```
// المحتوى الكامل للملف
// ```
function parseFileEdits(deepSeekResponse) {
  const files = [];
  const regex = /###\s*FILE:\s*(\S+)\s*\n```[a-zA-Z]*\n([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(deepSeekResponse)) !== null) {
    files.push({ file: match[1].trim(), content: match[2] });
  }
  return files;
}

function applyFileEdits(files) {
  for (const f of files) {
    const fullPath = path.join(process.cwd(), f.file);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, f.content, 'utf8');
    log(`✏️ اتكتب: ${f.file}`);
  }
}

// ---------- فتح GitHub Issue عند التعليق ----------

async function openGitHubIssue(title, body) {
  if (!REPO || !process.env.GITHUB_TOKEN) {
    log('⚠️ مفيش GITHUB_TOKEN أو GITHUB_REPOSITORY — مش هيتفتح Issue تلقائيًا.');
    return;
  }
  const res = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title, body, labels: ['ai-loop', 'needs-human'] }),
  });
  if (!res.ok) {
    log(`⚠️ فشل فتح Issue: ${res.status} ${await res.text()}`);
  } else {
    const data = await res.json();
    log(`🔲 اتفتح Issue: ${data.html_url}`);
  }
}

// ---------- معالجة بند واحد ----------

async function processItem(item, masterPrompt) {
  log(`\n\n# 🔧 البند: ${item.text}\n(قسم: ${item.section})`);

  let lastFailureReason = '';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_ITEM; attempt++) {
    log(`\n## محاولة ${attempt}/${MAX_ATTEMPTS_PER_ITEM}`);

    const currentIndex = fs.existsSync(INDEX_PATH) ? fs.readFileSync(INDEX_PATH, 'utf8') : '';

    const userPrompt =
      `البند المطلوب تنفيذه من test-plan.md:\n"${item.text}"\n(قسم: ${item.section})\n\n` +
      `محتوى index.html الحالي:\n\`\`\`html\n${currentIndex.slice(0, 6000)}\n\`\`\`\n\n` +
      (lastFailureReason ? `المحاولة اللي فاتت فشلت للسبب ده — عالجه:\n${lastFailureReason}\n\n` : '') +
      `اكتب التعديل المطلوب على index.html (وأضف/عدّل تست Playwright مناسب في tests/) ` +
      `عن طريق الرد بالشكل ده بالظبط لكل ملف:\n\n### FILE: index.html\n\`\`\`html\n(المحتوى الكامل للملف بعد التعديل)\n\`\`\`\n\n` +
      `### FILE: tests/اسم-التست.spec.js\n\`\`\`js\n(محتوى التست الكامل)\n\`\`\`\n\n` +
      `مهم: رجّع المحتوى الكامل لكل ملف بتعدّله، مش diff. لو الملف مش محتاج تعديل متبعتوش.`;

    let deepSeekResponse;
    try {
      deepSeekResponse = await callDeepSeek(masterPrompt, userPrompt);
    } catch (err) {
      log(`❌ فشل استدعاء DeepSeek: ${err.message}`);
      lastFailureReason = `فشل الاتصال بـ DeepSeek: ${err.message}`;
      continue;
    }

    const files = parseFileEdits(deepSeekResponse);
    if (files.length === 0) {
      log('❌ مفيش تعديلات ملفات واضحة في رد DeepSeek — هيتعاد المحاولة.');
      lastFailureReason = 'رد DeepSeek متكانش فيه بلوكات ### FILE: بالشكل المطلوب.';
      continue;
    }

    applyFileEdits(files);

    const { passed, output } = runPlaywrightTests();
    log(`\n### نتيجة Playwright\n${passed ? '✅ عدّى' : '❌ فشل'}\n\`\`\`\n${output.slice(0, 1500)}\n\`\`\``);

    let screenshot = null;
    if (process.env.BASE_URL) {
      screenshot = await takeScreenshot(process.env.BASE_URL);
    }

    let geminiReview;
    try {
      geminiReview = await callGeminiReview(item.text, files, output, passed, screenshot);
    } catch (err) {
      log(`❌ فشل استدعاء Gemini: ${err.message}`);
      lastFailureReason = `فشل الاتصال بـ Gemini: ${err.message}`;
      continue;
    }
    log(`\n### مراجعة Gemini\n${geminiReview}`);

    if (passed && isApproved(geminiReview)) {
      log(`\n✅ البند اتعمله فعليًا: "${item.text}"`);
      return { success: true };
    }

    lastFailureReason = passed
      ? `Gemini رفض رغم إن التست عدّى — راجع رأيه:\n${geminiReview}`
      : `التست فشل فعليًا:\n${output.slice(0, 1000)}`;
    log(`❌ محاولة ${attempt} فشلت.`);
  }

  // خلّصت المحاولات من غير نجاح
  await openGitHubIssue(
    `🤖 AI Loop: محتاج مراجعة بشرية — ${item.text}`,
    `## إيه اللي جربته\nحاولت ${MAX_ATTEMPTS_PER_ITEM} مرات أنفّذ البند ده من test-plan.md (قسم: ${item.section}).\n\n` +
      `## ليه اتوقفت\nآخر سبب فشل:\n\n${lastFailureReason}\n\n` +
      `## المحتاج قرار بشري\nمراجعة الكود المقترح والفشل المتكرر، وتحديد إذا كان البند محتاج توضيح إضافي في test-plan.md.\n\n` +
      `Run: ${RUN_URL}`
  );

  return { success: false };
}

// ---------- Git commit ----------

function commitAndPush() {
  try {
    execSync('git config user.name "ai-loop-bot"');
    execSync('git config user.email "ai-loop-bot@users.noreply.github.com"');
    execSync('git add -A');
    const status = execSync('git status --porcelain', { encoding: 'utf8' });
    if (!status.trim()) {
      log('مفيش تغييرات لعمل commit ليها.');
      return;
    }
    execSync(`git commit -m "🤖 AI loop: تحديثات تلقائية (run #${RUN_ID})"`);
    execSync('git push');
    log('✅ اتعمل commit وpush.');
  } catch (err) {
    log(`⚠️ فشل الـ commit/push: ${err.message}`);
  }
}

// ---------- التشغيل الرئيسي ----------

(async () => {
  try {
    if (!fs.existsSync(TEST_PLAN_PATH)) {
      throw new Error('test-plan.md مش موجود في جذر الريبو.');
    }
    const masterPrompt = fs.existsSync(MASTER_PROMPT_PATH)
      ? fs.readFileSync(MASTER_PROMPT_PATH, 'utf8')
      : 'اكتب كود Vanilla HTML/JS نظيف ومتوافق مع باقي المشروع.';

    let planContent = readTestPlan();
    const items = getUncheckedItems(planContent).slice(0, MAX_ITEMS_PER_RUN);

    if (items.length === 0) {
      log('مفيش بنود غير متعلّمة (بعيدًا عن قسم 8) — مفيش حاجة تتعمل في التشغيلة دي.');
    }

    for (const item of items) {
      // لازم نعيد قراءة الملف عشان نعرف السطر الصح بعد أي تعديل سابق في نفس التشغيلة
      planContent = readTestPlan();
      const freshItems = getUncheckedItems(planContent);
      const freshItem = freshItems.find(i => i.text === item.text);
      if (!freshItem) continue; // اتعلّم فعلاً من قبل أو اتشال

      const result = await processItem(freshItem, masterPrompt);
      if (result.success) {
        planContent = readTestPlan();
        const reFound = getUncheckedItems(planContent).find(i => i.text === item.text);
        if (reFound) {
          planContent = markItemDone(planContent, reFound.lineIndex, reFound.text);
          writeTestPlan(planContent);
        }
      }
    }

    commitAndPush();
  } catch (err) {
    log(`\n## خطأ عام في التشغيلة\n${err.message}`);
  }

  fs.writeFileSync('scripts/ai-loop/run-log.md', runLog.join('\n'));
  console.log('\n--- انتهت التشغيلة ---');
})();
