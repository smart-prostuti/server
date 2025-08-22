// Server/index.js (এই ফাইলটি আপনার Server GitHub রিপোজিটরির রুটে থাকবে)

require('dotenv').config(); // লোকাল ডেভেলপমেন্টের জন্য
const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3001; // লোকাল ডেভেলপমেন্টের জন্য

// CORS মিডলওয়্যার সেটআপ
// এখানে আপনার Netlify ফ্রন্টএন্ডের URL টি যোগ করতে হবে
// এবং Render থেকে deploy হওয়া ব্যাকএন্ডের URL (যদি আপনি নিজে deploy করেন)
app.use(cors({
  origin: [
    'http://localhost:5173', // লোকাল ডেভেলপমেন্টের জন্য
    'https://toolsgovt.netlify.app', // <-- আপনার Netlify ফ্রন্টএন্ড URL
  ]
}));
app.use(express.json());

// API Key এনভায়রনমেন্ট ভেরিয়েবল থেকে পাবে (লোকালে .env থেকে, Render-এ Render এর কনফিগারেশন থেকে)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error("Error: GEMINI_API_KEY is not set in environment variables.");
  // প্রোডাকশন এনভায়রনমেন্টে API Key না থাকলে সার্ভার ত্রুটি দেবে বা বন্ধ হবে
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// একমাত্র এন্ডপয়েন্ট: পরীক্ষার ডেটা বিশ্লেষণ এবং ফিডব্যাক তৈরির জন্য
app.post('/api/analyze-answers', async (req, res) => {
  const { subject, chapter, totalQuestions, answeredQuestions, wrongAnswers } = req.body;

  // ইনপুট ভ্যালিডেশন
  if (!subject || !chapter || totalQuestions === undefined || answeredQuestions === undefined) {
    return res.status(400).json({ error: 'Subject, chapter, total questions, and answered questions are required.' });
  }

  // প্রম্পট তৈরি করা হচ্ছে
  const wrongAnswersText = wrongAnswers.map((item, index) => {
    return `
      ${index + 1}. প্রশ্ন: ${item.questionText}
      আপনার উত্তর: ${item.selectedIndex !== null ? item.options[item.selectedIndex].text : 'উত্তর দেননি'}
      সঠিক উত্তর: ${item.options[item.correctIndex].text}
      সঠিক উত্তরের ব্যাখ্যা: ${item.explanation || 'কোন ব্যাখ্যা নেই।'}`;
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
      "weaknesses": [
        "দুর্বলতার ক্ষেত্র ১ (যেমন: এই অধ্যায়ের কোন বিষয়গুলো বোঝা প্রয়োজন)",
        "দুর্বলতার ক্ষেত্র ২",
        "..."
      ],
      "suggestions": [
        "পরামর্শ ১ (যেমন: ভুলগুলো থেকে শিখতে কী করা উচিত)",
        "পরামর্শ ২",
        "..."
      ],
      "encouragement": "শিক্ষার্থীকে উৎসাহিত করার জন্য একটি ছোট বার্তা"
    }
    
    যদি কোনো ভুল উত্তর না থাকে, তবে weaknesses, suggestions অ্যারে গুলোকে খালি রাখবেন।
  `;

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    const analysis = JSON.parse(text.trim());
    res.json({ analysis });

  } catch (error) {
    console.error('Error calling Gemini API for analysis:', error.message);
    res.status(500).json({ error: `বিশ্লেষণ তৈরি করতে সমস্যা হয়েছে: ${error.message}` });
  }
});

// লোকাল ডেভেলপমেন্টের জন্য সার্ভার চালু করে
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
