// Server/index.js
// ---------------------------------------------
// Express server for MCQ analysis via Gemini
// - Robust JSON parsing (handles ```json fences, smart quotes, trailing commas)
// - Asks Gemini for application/json to avoid Markdown
// - CORS configured for local + your Netlify frontend
// ---------------------------------------------

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const port = process.env.PORT || 3001;

// --------- CORS ---------
// Add your frontend origins here (local + production)
app.use(cors({
  origin: [
    'http://localhost:5173',
    'https://toolsgovt.netlify.app',
  ],
}));

app.use(express.json({ limit: '1mb' }));

// --------- Gemini Init ---------
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error('Error: GEMINI_API_KEY is not set.');
  process.exit(1);
}
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// --------- Helpers ---------

/**
 * Attempt to parse model output into JSON.
 * Handles:
 *  - Markdown fences ```json ... ```
 *  - Extra text before/after JSON
 *  - Smart quotes
 *  - Trailing commas
 */
function parseModelJson(text) {
  if (!text || typeof text !== 'string') {
    throw new Error('Empty model response');
  }

  // Prefer fenced block if present
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let candidate = fenced ? fenced[1] : text;

  // Normalize smart quotes to straight quotes
  candidate = candidate
    .replace(/[\u201C\u201D]/g, '"') // double smart quotes
    .replace(/[\u2018\u2019]/g, "'"); // single smart quotes

  // Extract the first {...} block
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No JSON object found in model output');
  }
  let jsonSlice = candidate.slice(start, end + 1);

  // Remove trailing commas: ,}
  jsonSlice = jsonSlice.replace(/,\s*([}\]])/g, '$1');

  // Final parse
  return JSON.parse(jsonSlice);
}

/**
 * Coerce object into the expected shape.
 */
function coerceAnalysisShape(analysis) {
  if (typeof analysis !== 'object' || analysis === null) analysis = {};
  analysis.summary = typeof analysis.summary === 'string' ? analysis.summary : '';
  analysis.weaknesses = Array.isArray(analysis.weaknesses) ? analysis.weaknesses : [];
  analysis.suggestions = Array.isArray(analysis.suggestions) ? analysis.suggestions : [];
  analysis.encouragement = typeof analysis.encouragement === 'string' ? analysis.encouragement : '';
  return analysis;
}

// --------- Routes ---------

// POST /api/analyze-answers
app.post('/api/analyze-answers', async (req, res) => {
  const {
    subject,
    chapter,
    totalQuestions,
    answeredQuestions,
    wrongAnswers = [],
  } = req.body || {};

  // Basic validation
  if (!subject || !chapter || totalQuestions === undefined || answeredQuestions === undefined) {
    return res.status(400).json({
      error: 'Subject, chapter, total questions, and answered questions are required.',
    });
  }

  const wrongAnswersText = wrongAnswers.map((item, index) => {
    const userAns = (item && item.selectedIndex !== null && item.selectedIndex !== undefined)
      ? (item.options?.[item.selectedIndex]?.text ?? 'অজানা অপশন')
      : 'উত্তর দেননি';

    const correctAns = item?.options?.[item.correctIndex]?.text ?? 'অজানা সঠিক উত্তর';
    const exp = item?.explanation || 'কোন ব্যাখ্যা নেই।';

    return `
${index + 1}. প্রশ্ন: ${item?.questionText ?? '—'}
আপনার উত্তর: ${userAns}
সঠিক উত্তর: ${correctAns}
সঠিক উত্তরের ব্যাখ্যা: ${exp}`;
  }).join('\n\n');

  const prompt = `
আপনি একজন অভিজ্ঞ শিক্ষক। আপনার কাজ হলো একজন শিক্ষার্থীর পরীক্ষার ফলাফলের উপর ভিত্তি করে একটি বিস্তারিত বিশ্লেষণ ও পরামর্শ তৈরি করা।

পরীক্ষার বিষয়: ${subject}
অধ্যায়: ${chapter}
মোট প্রশ্ন: ${totalQuestions}
উত্তর দেওয়া প্রশ্ন: ${answeredQuestions}
ভুল উত্তর বা উত্তর না দেওয়া প্রশ্ন: ${wrongAnswers.length}

এখানে সেই প্রশ্নগুলো এবং তাদের সঠিক উত্তরের সাথে শিক্ষার্থীর উত্তর দেওয়া হলো, যেগুলোতে সে ভুল করেছে অথবা উত্তর দেয়নি:

${wrongAnswers.length > 0 ? wrongAnswersText : 'শিক্ষার্থী সব প্রশ্নের সঠিক উত্তর দিয়েছে।'}

আপনার বিশ্লেষণটি নিম্নলিখিত কাঠামোতে বাংলায় প্রদান করুন। কোনো অতিরিক্ত কথা লিখবেন না, শুধুমাত্র JSON ফরম্যাটে আউটপুট দিন।

{
  "summary": "এই পরীক্ষার সংক্ষিপ্ত সারসংক্ষেপ",
  "weaknesses": [],
  "suggestions": [],
  "encouragement": "শিক্ষার্থীকে উৎসাহিত করার জন্য একটি ছোট বার্তা"
}

যদি কোনো ভুল উত্তর না থাকে, তবে weaknesses, suggestions অ্যারে গুলোকে খালি রাখবেন।
`;

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    // Ask for pure JSON. If SDK/version doesn’t support this, model may still wrap in fences,
    // which we’ll handle in parseModelJson().
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }]}],
      generationConfig: { responseMimeType: 'application/json' },
    });

    const rawText = result?.response?.text?.() ?? '';

    let analysis;
    try {
      analysis = parseModelJson(rawText.trim());
    } catch (parseErr) {
      console.error('JSON parse failed. Raw model output:\n', rawText);
      throw parseErr;
    }

    analysis = coerceAnalysisShape(analysis);
    return res.json({ analysis });

  } catch (error) {
    console.error('Error calling Gemini API for analysis:', error);
    return res.status(500).json({
      error: `বিশ্লেষণ তৈরি করতে সমস্যা হয়েছে: ${error.message}`,
    });
  }
});

// --------- Start ---------
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
