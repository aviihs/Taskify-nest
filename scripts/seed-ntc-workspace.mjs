// Seeds an "NTC" workspace (NTC Assistant Level 4 exam preparation) into an
// existing Taskify account through the public API, so every rule the app
// enforces applies. Safe to re-run: workspace, labels, projects and tasks that
// already exist (matched by name/title) are reused, never duplicated.
//
//   SEED_EMAIL=you@example.com SEED_PASSWORD='...' node scripts/seed-ntc-workspace.mjs
//   SEED_EMAIL=... SEED_TOKEN=<accessToken> node scripts/seed-ntc-workspace.mjs
//
// Optional: API_BASE_URL (default https://taskify-nest.onrender.com),
//           START_DATE (YYYY-MM-DD, day 1 of week 1; default today).

const API = (process.env.API_BASE_URL ?? "https://taskify-nest.onrender.com").replace(/\/$/, "");
const EMAIL = process.env.SEED_EMAIL;
const PASSWORD = process.env.SEED_PASSWORD;
let token = process.env.SEED_TOKEN;
const START = new Date((process.env.START_DATE ?? new Date().toISOString().slice(0, 10)) + "T00:00:00Z");
const PACE_MS = 600; // the API allows 120 requests/minute

if (!token && !(EMAIL && PASSWORD)) {
  console.error("Set SEED_EMAIL + SEED_PASSWORD (or SEED_TOKEN).");
  process.exit(1);
}
if (Number.isNaN(START.getTime())) {
  console.error("START_DATE must look like 2026-11-01");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, path, body, attempt = 1) {
  await sleep(PACE_MS);
  let res;
  try {
    res = await fetch(API + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    if (attempt < 4) return sleep(5000 * attempt).then(() => call(method, path, body, attempt + 1));
    throw err;
  }
  // Free hosting sleeps when idle and answers 502/503/504 while waking up.
  if ([429, 502, 503, 504].includes(res.status) && attempt < 6) {
    await sleep(5000 * attempt);
    return call(method, path, body, attempt + 1);
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  return data;
}

/** Date `day` (1-based) of `week` (1-based) at 17:45 Nepal time. */
const due = (week, day) => {
  const d = new Date(START.getTime() + ((week - 1) * 7 + (day - 1)) * 86_400_000);
  return d.toISOString().slice(0, 10) + "T12:00:00.000Z";
};

const LABELS = {
  "Paper I": "#2563eb",
  "Paper II": "#16a34a",
  GK: "#0ea5e9",
  Maths: "#f59e0b",
  Institutional: "#06b6d4",
  "Office & Accounts": "#8b5cf6",
  "Public Management": "#14b8a6",
  Marketing: "#ec4899",
  "Law & Policy": "#dc2626",
  Revision: "#64748b",
  "Mock Test": "#ea580c",
};

// [title, [week, day], description?]
const PROJECTS = [
  {
    name: "Paper I: Objective (100 marks)",
    description:
      "50 MCQs in 45 minutes. GK 60, Institutional Knowledge 20, Applied Mathematics 20. Pass mark 40. Each wrong answer cuts 20% of that question's marks, so do not guess blindly. Answer with capital A/B/C/D. No calculator. Target: 70-80.",
    start: [1, 1],
    end: [3, 7],
    sections: [
      {
        title: "Paper I: सामान्य ज्ञान (60 marks)",
        labels: ["Paper I", "GK"],
        priority: "HIGH",
        topics: [
          ["नेपालको भूगोल: धरातलीय स्वरूप, किसिम, विशेषता, जलवायु, हावापानी र जनजीवन", [1, 2]],
          ["नेपालका प्राकृतिक स्रोत र साधन", [1, 2]],
          ["आधुनिक नेपालको इतिहासका महत्वपूर्ण घटनाहरू", [1, 4]],
          ["नेपालको राजनीतिक विभाजन, संघ, प्रदेश र स्थानीय तह", [1, 4]],
          ["नेपाली समाज: परम्परा, मूल्य मान्यता, कला, संस्कृति, धर्म, जातजाति, भाषा र जनसंख्या", [1, 6]],
          ["नेपालको संविधान: भाग १, भाग ३ र अनुसूचीहरू", [2, 2]],
          ["आर्थिक विकासका आधार: कृषि, उद्योग, व्यापार, सूचना प्रविधि, मानव संसाधन र भौतिक पूर्वाधार", [2, 3]],
          ["दिगो विकास, वातावरण, जैविक विविधता, जलवायु परिवर्तन, प्रदूषण, शहरीकरण, स्वास्थ्य, रोग, खाद्य र पोषण", [2, 5]],
          ["मानव जीवनमा प्रत्यक्ष प्रभाव पार्ने विज्ञानका प्रमुख आविष्कार", [2, 6]],
          ["संयुक्त राष्ट्रसंघ तथा क्षेत्रीय संगठन: SAARC, ASEAN, European Union", [2, 6]],
          ["राष्ट्रिय तथा अन्तर्राष्ट्रिय महत्वका समसामयिक घटनाहरू", [2, 6]],
        ],
      },
      {
        title: "Paper I: संस्थागत ज्ञान (20 marks)",
        labels: ["Paper I", "Institutional"],
        priority: "HIGH",
        topics: [
          ["नेपालमा दूरसञ्चार सेवाको विकासक्रम र नेपाल टेलिकम", [3, 6]],
          ["दूरसञ्चार सेवा तथा IT सम्बन्धित नवीनतम प्रविधि, उपकरण, आविष्कार र शब्दावली", [3, 6]],
          ["CGS, MKS, FPS र SI Measurement System", [3, 7]],
          ["ITU तथा नेपालका अन्य दूरसञ्चार सेवा प्रदायक संस्था", [3, 7]],
        ],
      },
      {
        title: "Paper I: व्यवहारिक गणित (20 marks)",
        labels: ["Paper I", "Maths"],
        priority: "MEDIUM",
        topics: [
          ["ऐकिक नियम (Unitary Method)", [2, 7]],
          ["भिन्न (Fraction) र प्रतिशत (Percentage)", [2, 7]],
          ["नाफा र नोक्सान (Profit & Loss)", [3, 1]],
          ["साधारण ब्याज र मिश्रित/चक्रवृद्धि ब्याज (Simple & Compound Interest)", [3, 2]],
          ["अनुपात र समानुपात (Ratio & Proportion)", [3, 3]],
          ["औसत/मध्यक (Average/Mean & Median) र मिश्रित प्रश्न", [3, 4]],
        ],
      },
    ],
  },
  {
    name: "Paper II: Subjective (100 marks)",
    description:
      "2 hours 30 minutes. Section (क) 50 marks: Office Management & Accounts and Public Management. Section (ख) 50 marks: Institutional Knowledge and Marketing Management. Each section has two 10-mark and six 5-mark questions, written in separate answer books. Pass mark 40. Target: 65-75.",
    start: [4, 1],
    end: [6, 7],
    sections: [
      {
        title: "खण्ड (क): Office Management & Accounts",
        labels: ["Paper II", "Office & Accounts"],
        priority: "MEDIUM",
        topics: [
          ["कार्यालय: परिचय, महत्व, कार्य र प्रकार", [4, 2]],
          ["कार्यालय सहायकका कार्य र गुणहरू", [4, 2]],
          ["कार्यालय व्यवस्थापनको अवधारणा र महत्व", [4, 2]],
          ["कार्यालय स्रोत साधन: परिचय, प्रकार र उपयोग", [4, 2]],
          ["दर्ता, चलानी र पत्र व्यवहार", [4, 3]],
          ["टिप्पणी लेखन", [4, 3]],
          ["प्रतिवेदन लेखन: परिचय र प्रकार", [4, 3]],
          ["अभिलेख व्यवस्थापन: परिचय, अभिलेख चक्र, उद्देश्य र आवश्यकता", [4, 4]],
          ["फाइलिङ: परिचय, आवश्यकता, विधि एवं तरिकाहरू", [4, 4]],
          ["पञ्जिका/अनुक्रमणिका (Indexing): परिचय, महत्व र प्रकार", [4, 4]],
          ["कार्यालय व्यवस्थापनमा कम्प्युटर प्रणालीको आवश्यकता र महत्व", [4, 5]],
          ["कार्यालयमा सञ्चार: महत्व, प्रकार र माध्यम", [4, 5]],
          ["कार्यालयमा जनसम्पर्क व्यवस्थापन", [4, 5]],
          ["बैठक व्यवस्थापन र निर्णय (माइन्यूट) लेखन", [4, 6]],
          ["सेवाग्राही गुनासो व्यवस्थापनका विधिहरू", [4, 6]],
          ["जिन्सी स्रेस्ता र जिन्सी व्यवस्थापन", [4, 6]],
          ["आर्थिक कार्यप्रणाली र बजेटसम्बन्धी सामान्य जानकारी", [4, 7]],
          ["लेखा, लेखा प्रणाली र लेखापरीक्षण: परिचय, उद्देश्य र विशेषताहरू", [4, 7]],
          ["खाताका प्रकार तथा Debit/Credit का नियमहरू", [4, 7]],
          ["गोश्वारा भौचर, बैंक नगदी किताब र बजेट हिसाब", [4, 7]],
        ],
      },
      {
        title: "खण्ड (क): सार्वजनिक व्यवस्थापन",
        labels: ["Paper II", "Public Management"],
        priority: "MEDIUM",
        topics: [
          ["सार्वजनिक प्रशासन: परिचय, उद्देश्य र कार्यक्षेत्र", [5, 2]],
          ["संगठन: परिचय र गठनका आधारहरू", [5, 2]],
          ["नागरिक बडापत्र: अवधारणा, उद्देश्य र महत्व", [5, 2]],
          ["सार्वजनिक सेवा प्रवाह: अर्थ, महत्व, निकाय र तरिकाहरू", [5, 3]],
          ["सेवा प्रदायक/सेवाग्राहीका अधिकार, कर्तव्य र पालना गर्नुपर्ने आचरण", [5, 3]],
          ["सुशासन (व्यवस्थापन तथा सञ्चालन) ऐन, २०६४: परिच्छेद २, ४, ५", [5, 5], "Law & Policy"],
          ["सूचनाको हक सम्बन्धी ऐन, २०६४: परिच्छेद २, ४, ५", [5, 7], "Law & Policy"],
        ],
      },
      {
        title: "खण्ड (ख): Institutional Knowledge",
        labels: ["Paper II", "Institutional"],
        priority: "HIGH",
        topics: [
          ["नेपालमा दूरसञ्चार सेवाको विकासक्रम र नेपाल टेलिकम", [6, 2]],
          ["नेपाल दूरसञ्चार कम्पनी लिमिटेडको प्रबन्धपत्र र नियमावली", [6, 2]],
          ["कर्मचारी विनियमावली, २०७८: परिच्छेद ७ (बिदा), परिच्छेद ९ (आचरण तथा अनुशासन र विभागीय कारबाही)", [6, 3], "Law & Policy"],
          ["कम्पनी ऐन, २०६३: परिच्छेद २ (स्थापना), ३ (प्रबन्धपत्र/नियमावली/विवरणपत्र), ५ (कम्पनीको सभा)", [6, 4], "Law & Policy"],
          ["दूरसञ्चार ऐन, २०५३: परिच्छेद ७ र ८", [6, 4], "Law & Policy"],
          ["नेपालका अन्य दूरसञ्चार सेवा प्रदायक संस्थाहरू", [6, 5]],
          ["दूरसञ्चार नीति, २०६०", [6, 5], "Law & Policy"],
          ["Digital Nepal Framework: बुँदा १ देखि १९ सम्म", [6, 5]],
        ],
      },
      {
        title: "खण्ड (ख): बजार व्यवस्थापन (Marketing)",
        labels: ["Paper II", "Marketing"],
        priority: "MEDIUM",
        topics: [
          ["बजार र बजारिकरणको परिचय", [6, 6]],
          ["बजारका लागि आवश्यक तत्वहरू", [6, 6]],
          ["बजारका वर्गीकरण", [6, 6]],
          ["ग्राहक सेवा (Customer Service): उद्देश्य र महत्व", [6, 7]],
          ["ग्राहक सम्बन्ध सीप: उद्देश्य र महत्व", [6, 7]],
          ["बजार विश्लेषण: विधि, प्रक्रिया, महत्व र उद्देश्य", [6, 7]],
          ["बजार अनुसन्धान: क्षेत्र र प्रक्रिया", [6, 7]],
        ],
      },
    ],
  },
  {
    name: "Revision, Mocks and Exam Day",
    description:
      "Weeks 7 and 8: recall instead of rereading, timed mocks for both papers, error log review, and exam-day checks. Paper I target 70-80, Paper II target 65-75 (personal targets, not official cutoffs).",
    start: [7, 1],
    end: [8, 7],
    flat: true,
    tasks: [
      { title: "Week 7 Day 1: Paper I GK revision + 50 MCQ timed set", due: [7, 1], labels: ["Revision", "Paper I", "GK"], priority: "HIGH" },
      { title: "Week 7 Day 2: Paper I Maths + Institutional revision + 50 MCQ", due: [7, 2], labels: ["Revision", "Paper I"], priority: "HIGH" },
      { title: "Week 7 Day 3-4: Paper II Office + Accounts, write 10-mark and 5-mark answers", due: [7, 4], labels: ["Revision", "Paper II", "Office & Accounts"], priority: "HIGH" },
      { title: "Week 7 Day 5: Public Management + both Acts revision", due: [7, 5], labels: ["Revision", "Paper II", "Public Management", "Law & Policy"], priority: "MEDIUM" },
      { title: "Week 7 Day 6: NTC Institutional + Marketing answer writing", due: [7, 6], labels: ["Revision", "Paper II", "Institutional", "Marketing"], priority: "HIGH" },
      { title: "Week 7 Day 7: Full Paper I and Paper II mock, list weak areas", due: [7, 7], labels: ["Mock Test"], priority: "HIGH" },
      { title: "Week 8 Day 1: Paper I full mock (50 questions, 45 minutes)", due: [8, 1], labels: ["Mock Test", "Paper I"], priority: "URGENT", description: "Strict timing. First pass: answer sure questions only. Do not spend long on maths. Review in the last minutes." },
      { title: "Week 8 Day 2: Paper II full mock (2 hours 30 minutes)", due: [8, 2], labels: ["Mock Test", "Paper II"], priority: "URGENT", description: "Read the whole paper first. 10-mark answer: intro, key points, example, conclusion. 5-mark answer: short intro and 5-7 clear points. Use a separate answer book for each section." },
      { title: "Week 8 Day 3-4: Re-study only the topics you got wrong (formulas, dates, definitions, law sections)", due: [8, 4], labels: ["Revision"], priority: "HIGH" },
      { title: "Week 8 Day 5: Second full mock for both papers", due: [8, 5], labels: ["Mock Test"], priority: "URGENT" },
      { title: "Week 8 Day 6: Light revision, improve weak answers, check required documents", due: [8, 6], labels: ["Revision"], priority: "MEDIUM" },
      { title: "Week 8 Day 7: Light recap, sleep well, confirm exam centre and time", due: [8, 7], labels: ["Revision"], priority: "HIGH" },
      {
        title: "Verify latest amendments of every Act, rule and policy in the syllabus",
        due: [6, 5],
        labels: ["Law & Policy", "Paper II"],
        priority: "HIGH",
        description:
          "Changes in force up to 3 months before the exam date apply. Check Company Act 2063, Telecommunications Act 2053, Good Governance Act 2064, Right to Information Act 2064, Employee Regulation 2078 and Telecom Policy 2060 at lawcommission.gov.np and ntc.net.np. Do not rely only on an old PDF.",
      },
      {
        title: "Exam rules checklist",
        due: [8, 6],
        labels: ["Paper I", "Paper II"],
        priority: "HIGH",
        description:
          "Both papers need at least 40 each. MCQ answers in capital A/B/C/D only (small letters can cancel the answer sheet). No calculator in the MCQ paper. Answer Paper II in Nepali, English or both, each section in a separate answer book.",
      },
    ],
  },
];

/** Reminder time: `hourUtc:minUtc` on day `day` of `week`. 01:15 UTC = 07:00 Nepal, 13:15 UTC = 19:00 Nepal. */
const at = (week, day, hourUtc, minUtc = 15) => {
  const d = new Date(START.getTime() + ((week - 1) * 7 + (day - 1)) * 86_400_000);
  d.setUTCHours(hourUtc, minUtc, 0, 0);
  return d.toISOString();
};

// Private notes (Notes screen). Reference notes first, then reminders.
const NOTES = [
  {
    title: "Daily 3-hour routine",
    description: [
      "Same order every day. Move the clock time, never the order.",
      "1. 60 min: Paper II concept. Read one topic, write a 1-page note in your own words.",
      "2. 10 min break: walk, water, no phone scrolling.",
      "3. 45 min: Paper I. Rotate GK / Maths / Institutional.",
      "4. 10 min break: rest eyes and mind.",
      "5. 35 min: Active recall + writing. Close the book, write a 5-mark or 10-mark answer.",
      "6. 20 min: 10-20 MCQs + error log (write why each mistake happened).",
      "Focus timer idea: 25 min study + 5 min break.",
    ].join("\n"),
  },
  {
    title: "Weekly subject rotation",
    description: [
      "Day: Paper II main subject | Paper I alongside",
      "Sunday: Office Management | GK Nepal",
      "Monday: Accounting / Finance | Maths",
      "Tuesday: Public Management | GK / Constitution",
      "Wednesday: NTC Institutional | Maths / MCQ",
      "Thursday: Acts / Regulations | Current affairs",
      "Friday: Marketing Management | Telecom / IT terms",
      "Saturday: Revision + mock + error correction | Mixed MCQ",
    ].join("\n"),
  },
  {
    title: "Exam format and pass marks",
    description: [
      "Written: 200 marks, 2 papers. Interview: 30 marks after written selection.",
      "Paper I: 100 marks, 50 MCQs, 45 minutes. GK 60, Institutional Knowledge 20, Applied Maths 20.",
      "Paper II: 100 marks, subjective, 2h 30m. Section (ka) 50: Office Management & Accounts + Public Management. Section (kha) 50: Institutional Knowledge + Marketing Management. Each section: two 10-mark and six 5-mark questions.",
      "Pass mark: 40 in Paper I AND 40 in Paper II, separately.",
      "The syllabus does not split marks between the four Paper II subjects, so prepare all of them.",
    ].join("\n"),
  },
  {
    title: "Paper I strategy: the 45-minute game",
    description: [
      "50 questions in 45 minutes is about 54 seconds each.",
      "First pass: answer the questions you are sure about.",
      "Do not get stuck on maths. Come back later.",
      "Keep the last minutes for review.",
      "Wrong answer cuts 20% of that question's marks, so no blind guessing. Skipping costs nothing.",
      "Write answers as capital A / B / C / D in English.",
    ].join("\n"),
  },
  {
    title: "Paper II answer-writing framework",
    description: [
      "Read the whole paper first and understand what each question asks.",
      "5 marks: short intro (1-2 lines), 5-7 clear points, short conclusion. Add an example if asked.",
      "10 marks: heading, intro/concept, objectives/importance, types/process/features, practical example or challenge, conclusion. Do not force every sub-heading into every answer.",
      "Law answers: full Act name and year, then the chapter or topic named in the syllabus, key provisions in your own words, why it matters for the service or institution.",
      "Keep handwriting clean, use headings and numbering. A complete, clear, ordered answer beats a long one.",
    ].join("\n"),
  },
  {
    title: "Exam rules you must not break",
    description: [
      "Both papers need at least 40 each.",
      "MCQ answers in capital English A, B, C, D only. Small letters or other marks can cancel the answer sheet.",
      "No calculator in the MCQ paper.",
      "In the subjective paper, write each section in a separate answer book.",
      "Answers may be in Nepali, English or both.",
    ].join("\n"),
  },
  {
    title: "How to study any topic (6 steps)",
    description: [
      "1. Official text: read the source named in the syllabus first.",
      "2. Simple explanation: use a textbook or trusted class notes for what you did not understand.",
      "3. One-page notes: definition, objectives, features, types, process, importance.",
      "4. Active recall: close the book and write a 5-mark or 10-mark answer.",
      "5. MCQ: solve 10-20 and write why each mistake happened.",
      "6. Revision: review again after 1 day, 3 days and 7 days.",
      "Old question sets are for practice only. Never put them above the official syllabus. If a coaching note adds out-of-syllabus content, finish the core syllabus first.",
    ].join("\n"),
  },
  {
    title: "Official sources",
    description: [
      "Nepal Telecom (annual report, history, memorandum, regulations): https://www.ntc.net.np/",
      "Nepal Law Commission (Company Act, Telecommunications Act, Good Governance Act, RTI Act): https://lawcommission.gov.np/",
      "Ministry of Federal Affairs and General Administration: https://www.mofaga.gov.np/",
      "National Census: https://censusnepal.cbs.gov.np/",
      "ITU (telecom standards and terms): https://www.itu.int/",
    ].join("\n"),
  },
  {
    title: "Law and policy update rule",
    description:
      "Amendments, repeals and additions in force up to 3 months before the exam date apply. Do not memorise only an old PDF. Near the exam, check the current version of every Act, rule, regulation and policy in the syllabus from the official source. Confirm the vacancy notice and exam date from the official notice too.",
  },
  {
    title: "Score targets and mock log",
    description: [
      "Personal targets (not official cutoffs): Paper I 70-80 / 100, Paper II 65-75 / 100.",
      "After every mock write: date, paper, score, weak area.",
      "Example: 2026-12-20 | Paper I | 62/100 | compound interest, SAARC dates",
      "Then re-study only the weak topics and take the next mock.",
    ].join("\n"),
  },
  {
    title: "8-week roadmap, weeks 1 to 4",
    description: [
      "W1 Foundation + GK Nepal: geography, resources, modern history, politics, society. Day 7 revision + 50 GK MCQ + wrong-answer notebook.",
      "W2 Constitution + current affairs + maths: Constitution Part 1, 3, schedules; economy; environment; health; science; UN/SAARC/ASEAN/EU; Day 7 unitary, fraction, percentage.",
      "W3 Applied maths + Paper I institutional: profit/loss, interest, ratio, average; telecom history, new technology, CGS/MKS/FPS/SI, ITU; Day 7 Paper I mock.",
      "W4 Office management: office basics, registry and letters, notes and reports, records and filing, computer and communication, meetings, complaints, store records, budget and accounting.",
    ].join("\n"),
  },
  {
    title: "8-week roadmap, weeks 5 to 8",
    description: [
      "W5 Public management + laws: public administration, citizen charter, service delivery and conduct, Good Governance Act 2064 (ch. 2, 4, 5), RTI Act 2064 (ch. 2, 4, 5), answer practice.",
      "W6 NTC institutional + marketing: NTC history, memorandum and regulations; Employee Regulation 2078; Company Act 2063; Telecom Act 2053; Telecom Policy 2060; Digital Nepal Framework points 1-19; marketing.",
      "W7 Complete revision + answer writing: recall, not rereading. Day 7 full mock of both papers.",
      "W8 Final simulation: Paper I mock, Paper II mock, fix weak topics, second mock, light revision, sleep, confirm centre and time.",
    ].join("\n"),
  },
];

// Reminders (one notification each, at a future time; past ones are saved without a reminder).
const REMINDERS = [
  ...[1, 2, 3, 4, 5, 6].map((w) => ({
    title: `Week ${w} starts today`,
    description: [
      "Foundation + GK Nepal",
      "Constitution + current affairs + maths",
      "Applied maths + Paper I institutional",
      "Office management",
      "Public management + laws",
      "NTC institutional + marketing",
    ][w - 1] + ". Open the NTC workspace and check this week's tasks.",
    remindAt: at(w, 1, 1),
  })),
  { title: "Week 7 starts: complete revision", description: "Recall, not rereading. Full mock of both papers on Day 7.", remindAt: at(7, 1, 1) },
  { title: "Week 8 starts: final simulation", description: "Paper I mock today, Paper II mock tomorrow. Stay strict with timing.", remindAt: at(8, 1, 1) },
  ...[1, 2, 3].map((w) => ({
    title: `Week ${w} Day 7: revision + 50 GK MCQ`,
    description: "Revise the week, solve 50 MCQs, update the wrong-answer notebook.",
    remindAt: at(w, 7, 13),
  })),
  { title: "Paper I mock today (Week 3 Day 7)", description: "50 questions, 45 minutes. Log the score and weak areas.", remindAt: at(3, 7, 4) },
  { title: "Verify latest law amendments", description: "Check Company Act, Telecom Act, Good Governance Act, RTI Act, Employee Regulation and Telecom Policy on official sites.", remindAt: at(6, 5, 4) },
  { title: "Log mock score: Week 7 Day 7", description: "Both papers done? Write score and weak areas in the mock log note.", remindAt: at(7, 7, 14) },
  { title: "Log mock scores: Week 8", description: "Update the mock log and re-study only the wrong topics.", remindAt: at(8, 5, 14) },
  { title: "Tomorrow is exam day: final checks", description: "Documents, admit card, exam centre and time confirmed? Light recap and sleep early.", remindAt: at(8, 7, 13) },
];

async function seedNotes() {
  const listed = await call("GET", "/notes?scope=all");
  const have = new Set((Array.isArray(listed) ? listed : (listed.items ?? [])).map((n) => n.title));
  const now = Date.now();
  let created = 0;
  for (const n of [...NOTES, ...REMINDERS]) {
    if (have.has(n.title)) continue;
    if (n.description.length > 2000 || n.title.length > 120) throw new Error(`Note too long: ${n.title}`);
    const body = { title: n.title, description: n.description };
    if (n.remindAt && new Date(n.remindAt).getTime() > now) body.remindAt = n.remindAt;
    await call("POST", "/notes", body);
    created++;
  }
  return created;
}

async function main() {
  console.log(`API: ${API}`);
  if (!token) {
    const login = await call("POST", "/auth/login", { email: EMAIL, password: PASSWORD });
    token = login.accessToken;
    console.log(`Logged in as ${login.user?.email ?? EMAIL}`);
  }

  const workspaces = await call("GET", "/workspaces");
  let ws = (Array.isArray(workspaces) ? workspaces : workspaces.items).find((w) => w.name === "NTC");
  if (ws) console.log(`Workspace "NTC" exists (${ws._id}), reusing it`);
  else {
    ws = await call("POST", "/workspaces", {
      name: "NTC",
      description: "Nepal Telecom Assistant (Level 4) written exam preparation: 8-week plan, syllabus tracker, mocks.",
    });
    console.log(`Created workspace "NTC" (${ws._id})`);
  }

  const existingLabels = await call("GET", `/workspaces/${ws._id}/labels`);
  const labelId = {};
  for (const l of existingLabels) labelId[l.name.toLowerCase()] = l._id;
  for (const [name, color] of Object.entries(LABELS)) {
    if (labelId[name.toLowerCase()]) continue;
    labelId[name.toLowerCase()] = (await call("POST", `/workspaces/${ws._id}/labels`, { name, color }))._id;
  }
  const ids = (names) => names.map((n) => labelId[n.toLowerCase()]);

  const existingProjects = (await call("GET", `/workspaces/${ws._id}/projects?limit=100`)).items;
  const counts = { projects: 0, tasks: 0 };

  for (const def of PROJECTS) {
    let project = existingProjects.find((p) => p.name === def.name);
    if (!project) {
      project = await call("POST", `/workspaces/${ws._id}/projects`, {
        name: def.name,
        description: def.description,
        startDate: due(...def.start),
        dueDate: due(...def.end),
      });
      counts.projects++;
    }
    console.log(`Project: ${def.name}`);

    const have = new Map();
    for (let page = 1; ; page++) {
      const res = await call("GET", `/projects/${project._id}/tasks?limit=100&page=${page}`);
      for (const t of res.items) {
        have.set(`|${t.title}`, t._id);
        const subs = await call("GET", `/tasks/${t._id}/subtasks`);
        for (const s of Array.isArray(subs) ? subs : (subs.items ?? [])) have.set(`${t._id}|${s.title}`, s._id);
      }
      if (page >= res.meta.totalPages) break;
    }
    // The task list holds top-level tasks only; subtasks are read per parent.
    const key = (body) => `${body.parentTaskId ?? ""}|${body.title}`;
    const ensure = async (body) => {
      if (have.has(key(body))) return have.get(key(body));
      const created = await call("POST", `/projects/${project._id}/tasks`, body);
      have.set(key(body), created._id);
      counts.tasks++;
      return created._id;
    };

    if (def.flat) {
      let position = 1;
      for (const t of def.tasks) {
        await ensure({
          title: t.title,
          description: t.description ?? "",
          priority: t.priority,
          labelIds: ids(t.labels),
          dueDate: due(...t.due),
          position: position++,
        });
      }
      continue;
    }

    let position = 1;
    for (const section of def.sections) {
      const last = section.topics.reduce((a, t) => (t[1][0] * 10 + t[1][1] > a[0] * 10 + a[1] ? t[1] : a), [0, 0]);
      const parentId = await ensure({
        title: section.title,
        description: `${section.topics.length} syllabus topics. Tick each subtask after you can write or answer it from memory.`,
        priority: section.priority,
        labelIds: ids(section.labels),
        dueDate: due(...last),
        position: position++,
      });
      let sub = 1;
      for (const [title, when, extra] of section.topics) {
        await ensure({
          title,
          priority: section.priority,
          labelIds: ids(extra ? [...section.labels, extra] : section.labels),
          dueDate: due(...when),
          parentTaskId: parentId,
          position: sub++,
        });
      }
    }
  }

  const notes = await seedNotes();
  console.log(`Done. Created ${counts.projects} project(s), ${counts.tasks} task(s) and ${notes} note(s)/reminder(s). Workspace id: ${ws._id}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
