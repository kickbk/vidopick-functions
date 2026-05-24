// One-time import script — run with:
//   cd firebase/functions
//   node scripts/importLeads.mjs

import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SA_PATH = path.resolve(__dirname, '../integrations/firebase/service-account.json');

if (!fs.existsSync(SA_PATH)) {
  console.error(`Service account not found at: ${SA_PATH}`);
  process.exit(1);
}

initializeApp({ credential: cert(JSON.parse(fs.readFileSync(SA_PATH, 'utf8'))) });
const db = getFirestore();

// Build a lead document (no id field — Firestore doc ID is the id)
function makeLead({ firstName, lastName, title, email, phone, linkedin = '', extraContacts = [],
  organization, type, city, status, priority, source, contactAccount,
  date, note, nextAction = '', meetings = [] }) {
  const primary = { firstName, lastName, title, email, phone, linkedin, isPrimary: true };
  const contacts = [primary, ...extraContacts];
  const logs = note ? [{ date, note, author: contactAccount }] : [];
  return {
    organization, type, city, status, priority, source, contactAccount,
    nextFollowUpDate: '', nextAction, contacts, meetings, logs,
  };
}

const LEADS = [
  {
    firstName: 'Lena', lastName: 'Haiek', title: 'Owner & Director',
    email: 'grandviewhousepreschool@yahoo.com', phone: '(818) 395-5082',
    organization: 'Grandview House Preschool', type: 'School',
    city: 'Glendale', status: 'Active', priority: 'High', source: 'Direct Meeting', contactAccount: 'Ben',
    date: '2026-03-01',
    note: 'Met at school - pitched Vidopick - two locations interested (North Pacific Ave & Kenneth Village campuses) - pending onboarding. Follow-up email sent 4/2/26.',
  },
  {
    firstName: 'Rebecca', lastName: 'Lesser Allen', title: 'Child Psychologist',
    email: 'rebecca@drrebeccalesserallen.com', phone: '',
    organization: 'Dr. Rebecca Lesser Allen', type: 'Advisor Prospect',
    city: 'Los Angeles', status: 'Warm', priority: 'High', source: 'Conference', contactAccount: 'Ben',
    date: '2026-03-01',
    note: 'Met at Mark Keppel Elementary - liked Vidopick - potential advisory board member. Google Meet scheduled for 4/21/26 at 3pm.',
    meetings: [{ dateTime: '2026-04-21T15:00:00', status: 'scheduled', location: 'online' }],
  },
  {
    firstName: 'Nancy', lastName: 'Darwich', title: 'Site Supervisor',
    email: 'nancy@grandviewhousepreschool.com', phone: '(310) 499-8286',
    organization: 'Grandview House at the Village', type: 'School',
    city: 'Glendale', status: 'Active', priority: 'High', source: 'Referral (Lena Haiek)', contactAccount: 'Ben',
    date: '2026-04-02',
    note: "Site supervisor at Grandview's Village location (1435 W Kenneth Rd, Glendale CA 91201). Follow-up email sent 4/2/26.",
  },
  {
    firstName: 'Aracelie', lastName: 'Gonzalez', title: 'Education Specialist (LCSW PPS)',
    email: 'Gonzalez_Araceli@lacoe.edu', phone: '(562) 922-6147',
    organization: 'LA County Office of Education - Student Support Services FYSCP Unit', type: 'School/Government',
    city: 'Pasadena', status: 'Active', priority: 'Medium', source: 'Business Card', contactAccount: 'Ben',
    date: '2026-04-07',
    note: 'New lead from business card. Located at Pasadena DCFS Office - Education Specialist Program, 532 E Colorado Blvd Pasadena CA 91101. Texted 4/7/26 asking to connect when she has a free moment. Awaiting response.',
  },
  {
    firstName: 'Harpreet', lastName: 'Grewal', title: 'Founder',
    email: 'hgrewal05@gmail.com', phone: '(510) 239-3391', linkedin: 'linkedin.com/in/hgrewal05',
    organization: 'Learn And Play Montessori Schools', type: 'School',
    city: '', status: 'New', priority: 'High', source: 'LinkedIn', contactAccount: 'Ben',
    date: '2026-04-08',
    note: 'Founder of multi-location Learn and Play Montessori Schools. Website: learnandplaymontessori.com.',
  },
  {
    firstName: 'Daniel', lastName: 'Chorny', title: 'Rabbi / Hebrew Teacher',
    email: 'dec197@gmail.com', phone: '', linkedin: 'linkedin.com/in/rabbi-daniel-chorny-87701a86',
    organization: 'Lashon Academy Charter School', type: 'School',
    city: '', status: 'New', priority: 'Medium', source: 'LinkedIn', contactAccount: 'Ben',
    date: '2026-04-08',
    note: 'Hebrew Teacher at Lashon Academy Charter School. Also associated with congregationsonsofisrael.com.',
  },
  {
    firstName: 'Shaney', lastName: 'Valencia', title: 'Director of Learning Design & AI Integration',
    email: 'shaneyberzansky@gmail.com', phone: '', linkedin: 'linkedin.com/in/shaney-valencia',
    organization: 'Irvine Unified School District', type: 'School District',
    city: 'Irvine', status: 'New', priority: 'High', source: 'LinkedIn', contactAccount: 'Ben',
    date: '2026-04-08',
    note: 'Director of Learning Design, Differentiation & AI Integration at IUSD (Nov 2025-present). Previously Coordinator of Ed Tech for 8+ years.',
  },
  {
    firstName: 'Han', lastName: 'Yu', title: 'Founder',
    email: 'hanyu42233445@gmail.com', phone: '', linkedin: 'linkedin.com/in/han-yu-511a15171',
    organization: 'Starting Point Mandarin Immersion Montessori Preschool', type: 'School',
    city: '', status: 'New', priority: 'Medium', source: 'LinkedIn', contactAccount: 'Ben',
    date: '2026-04-08',
    note: 'Founder of Starting Point Mandarin Immersion Montessori Preschool (Jan 2025). Self-employed.',
  },
  {
    firstName: 'Jordana', lastName: 'Horn', title: 'Journalist & Podcast Host',
    email: 'jordhorn@gmail.com', phone: '', linkedin: 'linkedin.com/in/jordana-horn-a04a906',
    organization: 'The Times of Israel / Kveller', type: 'Media/PR',
    city: 'Jerusalem', status: 'New', priority: 'Medium', source: 'LinkedIn', contactAccount: 'Ben',
    date: '2026-04-08',
    note: "Correspondent at Times of Israel. Co-host of 'Call Your Mother' podcast on Kveller (Jewish parenting). Potential for press coverage.",
  },
  {
    firstName: 'Jessica', lastName: 'Emde', title: 'Clinical Psychologist',
    email: 'jessica.emde2@gmail.com', phone: '(323) 404-9533', linkedin: 'linkedin.com/in/jessica-emde',
    organization: 'Private Practice', type: 'Advisor Prospect',
    city: 'Los Angeles', status: 'New', priority: 'Medium', source: 'LinkedIn', contactAccount: 'Ben',
    date: '2026-04-08',
    note: 'Dr. Jessica Emde - specializes in children & teens: anxiety, OCD, Autism, ADHD. Previously contacted in 2022 re: other projects. Referral source angle.',
  },
  {
    firstName: 'Amanda', lastName: 'Tran', title: 'School Leader',
    email: 'amandajtran@gmail.com', phone: '', linkedin: 'linkedin.com/in/amandajtran',
    organization: 'KIPP SoCal Public Schools (KIPP Vida Prep)', type: 'School',
    city: 'Los Angeles', status: 'Active', priority: 'High', source: 'LinkedIn', contactAccount: 'Ben',
    date: '2026-04-08',
    note: 'School Leader at KIPP Vida Prep - 570 students K-4. LinkedIn message sent 4/8/26. No response yet.',
  },
  {
    firstName: 'Rina', lastName: 'Etkes', title: 'Teacher & School Twinning Coordinator',
    email: 'rina.etkes@gmail.com', phone: '', linkedin: 'linkedin.com/in/rina-etkes-23563832',
    organization: 'Temple Israel of Hollywood', type: 'School',
    city: 'Los Angeles', status: 'Cold', priority: 'Low', source: 'LinkedIn', contactAccount: 'Ben',
    date: '2025-10-01',
    note: 'Hebrew LinkedIn message sent ~Sukkot 2024. No response after 1 year. Consider finding alternative contact at TIOH.',
  },
  {
    firstName: 'Diandra', lastName: 'Morales', title: 'School Counselor',
    email: 'diandrasrz@yahoo.com', phone: '', linkedin: 'linkedin.com/in/diandra-morales-m-ed-ppsc-71aa7371',
    organization: 'Lancaster School District', type: 'School',
    city: 'Lancaster', status: 'Active', priority: 'Low', source: 'LinkedIn', contactAccount: 'Ben',
    date: '2026-04-08',
    note: 'M.Ed., PPSC. May no longer be at Lancaster SD (role listed Aug 2020 - Jun 2025). LinkedIn message sent 4/8/26.',
  },
  {
    firstName: 'Andrea', lastName: 'Pastorok Reader', title: 'Educational Consultant / Tutor / Coach',
    email: 'drpastorok@optonline.net', phone: '(310) 850-9795', linkedin: 'linkedin.com/in/andrea-pastorok-reader-a1683216',
    organization: 'Self-Employed', type: 'Educator',
    city: 'Wyckoff, NJ', status: 'New', priority: 'Medium', source: 'LinkedIn', contactAccount: 'Ben',
    date: '2026-04-08',
    note: 'Educational Consultant since 2007. NJ area. Pitch vidopick.com/teachers specifically.',
  },
  {
    firstName: 'David', lastName: 'Ullendorff', title: 'Co-Founder',
    email: 'davidullendorff@gmail.com', phone: '', linkedin: 'linkedin.com/in/davidullendorff',
    organization: 'Mathnasium - The Math Learning Center', type: 'Partner/Franchise',
    city: 'Los Angeles', status: 'New', priority: 'Medium', source: 'LinkedIn', contactAccount: 'Ben',
    date: '2026-04-08',
    note: 'Co-Founder of Mathnasium franchise. Two angles: sharing instructional videos with parents + banner announcements.',
  },
  {
    firstName: 'David', lastName: 'Kapuler', title: 'Ed Tech Blogger',
    email: 'dkapuler@gmail.com', phone: '(414) 416-3641', linkedin: 'linkedin.com/in/dkapuler',
    organization: 'Technology Tidbits', type: 'Media/PR',
    city: 'Greendale, WI', status: 'New', priority: 'Medium', source: 'LinkedIn', contactAccount: 'Ben',
    date: '2026-04-08',
    note: 'Ed Tech blogger since 2010. Goal: get him to write about Vidopick.',
  },
  {
    firstName: 'Sara', lastName: 'Simpson', title: 'Clinical Psychologist',
    email: 'saralederer@gmail.com', phone: '(310) 663-6736', linkedin: 'linkedin.com/in/drsarasimpson',
    organization: 'Dr. Sara Simpson Holistic Therapy LA', type: 'Advisor Prospect',
    city: 'Los Angeles', status: 'Active', priority: 'High', source: 'LinkedIn', contactAccount: 'Ben',
    date: '2026-04-08',
    note: 'Former close friend - texted 4/7/26 to reconnect. Advisory board candidate. Has kids who should use Vidopick.',
  },
  {
    firstName: 'Mark', lastName: 'Silver', title: 'Head of School',
    email: 'msilver@hillbrook.org', phone: '', linkedin: 'linkedin.com/in/mark-silver-29953413',
    organization: 'Hillbrook School', type: 'School',
    city: 'Los Gatos, CA', status: 'Active', priority: 'High', source: 'LinkedIn', contactAccount: 'Sam',
    date: '2026-04-08',
    note: 'Leading 90-year-old school expanding from JK-8 to JK-12 with two campuses in Los Gatos and downtown San Jose. Also Executive Coach.',
  },
  {
    firstName: 'Ben', lastName: 'Hebebrand', title: 'Interim Head of School',
    email: 'ben.hebebrand1962@gmail.com', phone: '(847) 345-8621', linkedin: 'linkedin.com/in/benhebebrand',
    organization: 'The Pathfinder School', type: 'School',
    city: 'Traverse City, MI', status: 'Active', priority: 'High', source: 'LinkedIn', contactAccount: 'Sam',
    date: '2026-04-08',
    note: 'Interim Head of School at The Pathfinder School (Aug 2025-present).',
  },
  {
    firstName: 'Dana', lastName: 'Harrison', title: 'Head of School',
    email: 'dharrison@newtownfriends.org', phone: '', linkedin: 'linkedin.com/in/dana-harrison-053265a',
    organization: 'Newtown Friends School', type: 'School',
    city: 'Newtown, PA', status: 'Active', priority: 'High', source: 'LinkedIn', contactAccount: 'Sam',
    date: '2026-04-08',
    note: 'Head of School at Newtown Friends School since 2010.',
  },
  {
    firstName: 'Lauren', lastName: 'Lambert', title: 'Head of School',
    email: 'laurengale66@gmail.com', phone: '', linkedin: 'linkedin.com/in/lauren-lambert-2b228954',
    organization: 'Stoneleigh-Burnham School', type: 'School',
    city: 'Greenfield, MA', status: 'Active', priority: 'High', source: 'LinkedIn', contactAccount: 'Sam',
    date: '2026-04-08',
    note: 'Head of School at Stoneleigh-Burnham School since Jul 2023.',
  },
  {
    firstName: 'Jennifer', lastName: 'Ujiie', title: 'Principal',
    email: 'jennifer.ujiie@gmail.com', phone: '', linkedin: 'linkedin.com/in/jennifer-ujiie-a8820268',
    organization: 'Denman Middle School (SFUSD)', type: 'School',
    city: 'San Francisco, CA', status: 'Active', priority: 'High', source: 'LinkedIn', contactAccount: 'Sam',
    date: '2026-04-08',
    note: 'Principal at Denman Middle School (SFUSD) since Jul 2023. 12+ years in SFUSD.',
  },
  {
    firstName: 'John', lastName: 'Bracker', title: 'Head of School',
    email: 'johnwbracker@gmail.com', phone: '', linkedin: 'linkedin.com/in/john-bracker-225b139',
    organization: 'Polytechnic School', type: 'School',
    city: 'Pasadena, CA', status: 'Active', priority: 'High', source: 'LinkedIn', contactAccount: 'Sam',
    date: '2024-10-08',
    note: 'Sam connected Oct 2024. Original message sent introducing Ben and Vidopick. Connected but no follow-up since. Head of School at Polytechnic School since 2014.',
  },
  {
    firstName: 'Michelle', lastName: 'Bracken', title: 'Psychology Teacher & School Counselor',
    email: 'mbracken@hw.com', phone: '', linkedin: 'linkedin.com/in/michelle-bracken-24a82aa',
    organization: 'Harvard-Westlake School', type: 'School',
    city: 'Los Angeles, CA', status: 'Active', priority: 'High', source: 'LinkedIn', contactAccount: 'Sam',
    date: '2026-04-08',
    note: 'Psychology teacher and school counselor at Harvard-Westlake for 32+ years. Also Licensed MFT in private practice.',
  },
  {
    firstName: 'Steven', lastName: 'Roushakes', title: 'Head of School',
    email: 'roushakess@hotmail.com', phone: '', linkedin: 'linkedin.com/in/steven-roushakes-6893455',
    organization: 'The New School of Northern Virginia', type: 'School',
    city: 'Arlington, VA', status: 'Active', priority: 'High', source: 'LinkedIn', contactAccount: 'Sam',
    date: '2026-04-08',
    note: 'Head of School at The New School of Northern Virginia since 2017.',
  },
  {
    firstName: 'Tim', lastName: 'Montgomery', title: 'Head of School',
    email: 'tmontgomery@thepiedmontschool.com', phone: '', linkedin: 'linkedin.com/in/tim-montgomery-0a7b8748',
    organization: 'The Piedmont School', type: 'School',
    city: 'Kernersville, NC', status: 'Active', priority: 'High', source: 'LinkedIn', contactAccount: 'Sam',
    date: '2026-04-08',
    note: 'Head of School at The Piedmont School since 2013. Non-profit school.',
  },
  {
    firstName: 'Timothy', lastName: 'Dernlan', title: 'Head of School',
    email: '', phone: '', linkedin: 'linkedin.com/in/timdernlan',
    organization: 'Classical School of Wichita', type: 'School',
    city: 'Wichita, KS', status: 'Active', priority: 'Medium', source: 'LinkedIn', contactAccount: 'Sam',
    date: '2026-04-08',
    note: 'Dr. Timothy Dernlan - Classical Christian Education focus. Author and consultant. Head of School at Classical School of Wichita since Jul 2025. No email found.',
  },
  {
    firstName: 'Jacqueline', lastName: 'Ragland', title: 'Education Specialist',
    email: 'jnlragland@gmail.com', phone: '', linkedin: 'linkedin.com/in/jackyrag',
    organization: 'Carlsbad Unified School District', type: 'School District',
    city: 'San Diego, CA', status: 'Active', priority: 'Medium', source: 'LinkedIn', contactAccount: 'Sam',
    date: '2026-04-08',
    note: '9+ years curriculum development and instructional design. Education Specialist at Carlsbad USD since Aug 2021.',
  },
  {
    firstName: 'Paul', lastName: 'Lazenby', title: 'President',
    email: 'paul.j.lazenby@gmail.com', phone: '', linkedin: 'linkedin.com/in/paullazenby',
    organization: 'Mother of Divine Grace School', type: 'School',
    city: 'Los Angeles, CA', status: 'Active', priority: 'High', source: 'LinkedIn', contactAccount: 'Sam',
    date: '2026-04-08',
    note: 'President at Mother of Divine Grace - Catholic distance learning school serving thousands of students in 28+ countries PreK-12th grade.',
  },
  {
    firstName: 'Soo', lastName: 'Chang', title: 'Head of School',
    email: 'soochang1977@gmail.com', phone: '(770) 769-8460', linkedin: 'linkedin.com/in/soo-chang-75688116',
    organization: 'Coastal Christian School', type: 'School',
    city: 'Pismo Beach, CA', status: 'Active', priority: 'High', source: 'LinkedIn', contactAccount: 'Sam',
    date: '2026-04-08',
    note: 'Head of School at Coastal Christian School since Feb 2026.',
  },
  {
    firstName: 'JP', lastName: 'Culley', title: 'Head of School',
    email: 'jpculley@gmail.com', phone: '', linkedin: 'linkedin.com/in/jp-culley-4a451b45',
    organization: 'Holland Hall School', type: 'School',
    city: 'Tulsa, OK', status: 'Active', priority: 'High', source: 'LinkedIn', contactAccount: 'Sam',
    date: '2026-04-08',
    note: 'Head of School at Holland Hall since 2013.',
  },
  {
    firstName: 'Dennis', lastName: 'Chapman', title: 'Head of School',
    email: 'dennischapman03@yahoo.com', phone: '', linkedin: 'linkedin.com/in/dr-dennis-chapman-8a54993',
    organization: 'The Village School of Naples', type: 'School',
    city: 'Naples, FL', status: 'Active', priority: 'High', source: 'LinkedIn', contactAccount: 'Sam',
    date: '2026-04-08',
    note: 'Dr. Dennis Chapman. Head of School since 2018. Grew enrollment 58%, fundraising from $200K to $2MM. Strong academic innovator.',
  },
  {
    firstName: 'James', lastName: 'Spellman', title: 'Principal',
    email: 'macspellman@yahoo.com', phone: '', linkedin: 'linkedin.com/in/james-spellman-49b657ab',
    organization: 'St. Monica Catholic High School', type: 'School',
    city: 'Santa Monica, CA', status: 'Active', priority: 'High', source: 'LinkedIn', contactAccount: 'Sam',
    date: '2026-04-08',
    note: 'Principal at St. Monica Catholic High School since 2017. 16+ years in educational leadership.',
  },
  {
    firstName: 'Seth', lastName: 'Pozzi', title: 'Head of School',
    email: 'sethpozzi@gmail.com', phone: '', linkedin: 'linkedin.com/in/seth-pozzi-8378201a',
    organization: 'Woodland Hills Private School', type: 'School',
    city: 'Woodland Hills, CA', status: 'Active', priority: 'High', source: 'LinkedIn', contactAccount: 'Sam',
    date: '2026-04-08',
    note: 'Head of School at Woodland Hills Private School since 2015. Two campuses (preschool and elementary). 100-member team.',
  },
  {
    firstName: 'Chris', lastName: 'Lincoln', title: 'Head of School',
    email: 'chris.lincoln@mac.com', phone: '(949) 584-9515', linkedin: 'linkedin.com/in/chris-lincoln-74963320',
    organization: 'McDowell School', type: 'School',
    city: 'Laguna Niguel, CA', status: 'Active', priority: 'Low', source: 'LinkedIn', contactAccount: 'Sam',
    date: '2026-04-08',
    note: 'Role at McDowell ended Jun 2024 - verify current position before reaching out. Also speaker/author.',
  },
  {
    firstName: 'David', lastName: 'Dean', title: 'President',
    email: 'ddean@stjs.org', phone: '', linkedin: 'linkedin.com/in/david-dean-3032ab49',
    organization: "St. John the Apostle School", type: 'School',
    city: 'North Richland Hills, TX', status: 'Active', priority: 'High', source: 'LinkedIn', contactAccount: 'Sam',
    date: '2026-04-08',
    note: "President at St. John the Apostle School since 2013.",
  },
  {
    firstName: 'Amos', lastName: 'Mikaele', title: 'Vice Principal',
    email: 'amos.mikaele@gmail.com', phone: '', linkedin: 'linkedin.com/in/amosmikaele',
    organization: "The O'Farrell Charter School", type: 'School',
    city: 'San Diego, CA', status: 'Active', priority: 'Medium', source: 'LinkedIn', contactAccount: 'Sam',
    date: '2026-04-08',
    note: "Vice Principal at O'Farrell Charter School since Oct 2024. Previously founding school counselor. K-12 educator and administrator.",
  },
  {
    firstName: 'Christine', lastName: 'Offutt', title: 'Resource Itinerant / Special Education Teacher',
    email: 'ckoffutt@aol.com', phone: '', linkedin: 'linkedin.com/in/christine-offutt-95199011',
    organization: 'Los Angeles Unified School District', type: 'School',
    city: 'Los Angeles, CA', status: 'Active', priority: 'Medium', source: 'LinkedIn', contactAccount: 'Sam',
    date: '2026-04-08',
    note: 'Special Ed teacher at LAUSD for 10+ years. Also 20 years in video/film/media. Unique background.',
  },
  {
    firstName: 'Vivian', lastName: 'Vasquez', title: 'Principal (Former)',
    email: 'vivian.d.vasquez@gmail.com', phone: '', linkedin: 'linkedin.com/in/vivianvasquez',
    organization: 'St. Joseph Dual Language Catholic School', type: 'School',
    city: 'Pomona, CA', status: 'Active', priority: 'Low', source: 'LinkedIn', contactAccount: 'Sam',
    date: '2026-04-08',
    note: 'Role at St. Joseph ended Jun 2023 - may no longer be in this position. Dual language school background relevant.',
  },
  {
    firstName: 'Sarah', lastName: 'Ben-Nissan', title: 'Teacher',
    email: 'sbennissan@ucla.edu', phone: '', linkedin: 'linkedin.com/in/sarah-ben-nissan-9264a2bb',
    organization: 'Wise School (Stephen Wise Temple)', type: 'School',
    city: 'Woodland Hills, CA', status: 'Active', priority: 'High', source: 'LinkedIn', contactAccount: 'Sam',
    date: '2026-04-08',
    note: 'Teacher at Wise School / Stephen Wise Temple since 2017. Jewish school - use Hebrew/Leo connecting to Judaism angle for Sam message.',
  },
  {
    firstName: 'Philip', lastName: '', title: 'Director',
    email: 'ben@benkass.com', phone: '818-555-3131',
    organization: 'Mindful Minds Preschool', type: 'School',
    city: 'Burbank', status: 'New', priority: 'High', source: 'Direct Meeting', contactAccount: 'Ben',
    date: '2026-05-20',
    note: 'Met with Barbara (secretary) on 5/20/26. Philip (Director) on vacation until Sunday 5/25. Left info sheet about pilot program.',
  },
  // Lauren Branco — two contacts: Lauren (primary) + Gaby Katz (met with)
  {
    firstName: 'Lauren', lastName: 'Branco', title: 'Director',
    email: 'lbranco@btee.org', phone: '818-845-1734',
    extraContacts: [
      { firstName: 'Gaby', lastName: 'Katz', title: '', email: 'gkatz@btee.org', phone: '', linkedin: '', isPrimary: false },
    ],
    organization: 'Temple Emanu El', type: 'School',
    city: 'Burbank', status: 'New', priority: 'High', source: 'Direct Meeting', contactAccount: 'Ben',
    date: '2026-05-20',
    note: 'Met with Gaby Katz (gkatz@btee.org) who introduced us to new director Lauren Branco.',
  },
  {
    firstName: 'Lena', lastName: '', title: 'Director',
    email: 'info@burbankccc.com', phone: '818-953-7186',
    organization: 'Burbank Child Care Center & Preschool', type: 'School',
    city: 'Burbank', status: 'New', priority: 'Medium', source: 'Direct Meeting', contactAccount: 'Ben',
    date: '2026-05-20',
    note: 'Met Lena - just started running the school again (day 1) after being away for a year and a half. Previously ran it for 21 years. Very busy right now, follow up.',
  },
];

async function importLeads() {
  let count = 0;
  for (const data of LEADS) {
    const docRef = db.collection('leads').doc();
    await docRef.set(makeLead(data));
    count++;
    console.log(`✅ ${count}/${LEADS.length} — ${data.organization}`);
  }
  console.log(`\nDone. Imported ${count} leads.`);
  process.exit(0);
}

importLeads().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
