// ... keep everything above unchanged

app.post('/api/analyze-answers', async (req, res) => {
  const { subject, chapter, totalQuestions, answeredQuestions, wrongAnswers = [] } = req.body;

  if (!subject || !chapter || totalQuestions === undefined || answeredQuestions === undefined) {
    return res.status(400).json({ error: 'Subject, chapter, total questions, and answered questions are required.' });
  }

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
      "weaknesses": [],
      "suggestions": [],
      "encouragement": "শিক্ষার্থীকে উৎসাহিত করার জন্য একটি ছোট বার্তা"
    }

    যদি কোনো ভুল উত্তর না থাকে, তবে weaknesses, suggestions অ্যারে গুলোকে খালি রাখবেন।
  `;

  // --- helper to robustly parse JSON, even if fenced ---
  function parseModelJson(text) {
    // Try direct parse first
    try { return JSON.parse(text); } catch {}

    // Strip ```json ... ``` or ``` ... ```
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const raw = fenced ? fenced[1] : text;

    // Take substring between first { and last }
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      const sliced = raw.slice(start, end + 1);
      return JSON.parse(sliced);
    }
    throw new Error("Model output was not valid JSON");
  }

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    // Ask for pure JSON
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }]}],
      generationConfig: { responseMimeType: "application/json" }
    });

    const text = result.response.text();

    let analysis;
    try {
      analysis = parseModelJson(text.trim());
    } catch (parseErr) {
      console.error("Parse failed. Raw model output:", text);
      throw parseErr;
    }

    // Optional: minimal schema hardening
    analysis.summary ??= "";
    analysis.weaknesses = Array.isArray(analysis.weaknesses) ? analysis.weaknesses : [];
    analysis.suggestions = Array.isArray(analysis.suggestions) ? analysis.suggestions : [];
    analysis.encouragement ??= "";

    return res.json({ analysis });
  } catch (error) {
    console.error('Error calling Gemini API for analysis:', error);
    return res.status(500).json({ error: `বিশ্লেষণ তৈরি করতে সমস্যা হয়েছে: ${error.message}` });
  }
});
