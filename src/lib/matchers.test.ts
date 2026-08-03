/** Run: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchCanada } from './canada.js';
import { matchRole, classifyType } from './roles.js';

test('canada: real location strings from live sources', () => {
  // Shapes observed in live Greenhouse + GitHub data.
  assert.equal(matchCanada('Toronto').isCanada, true);
  assert.equal(matchCanada('Toronto, Canada').confidence, 'confirmed');
  assert.equal(matchCanada('Canada').confidence, 'confirmed');
  assert.equal(matchCanada('Toronto, ON').province, 'ON');
  // Job Bank's parenthesized format, incl. towns not in the city list.
  assert.equal(matchCanada('Havelock (ON)').province, 'ON');
  assert.equal(matchCanada('Saint-Bruno (QC)').province, 'QC');
  assert.equal(matchCanada('Vancouver, Canada +1').province, 'BC');
  assert.equal(matchCanada('Montreal, Quebec').province, 'QC');

  const multi = matchCanada('New York, San Francisco, Seattle, or Remote (US/Canada)');
  assert.equal(multi.isCanada, true);
  assert.equal(multi.remote, true);
});

test('canada: rejects non-Canadian locations', () => {
  for (const loc of ['San Francisco, CA', 'Bengaluru, India', 'Sydney, Australia',
                     'Berlin, Germany', 'Dublin, Ireland', 'Cairo, Egypt', 'Riyadh, Saudi Arabia']) {
    assert.equal(matchCanada(loc).isCanada, false, `should reject ${loc}`);
  }
});

test('canada: ambiguous city names are kept but flagged', () => {
  // London ON vs London UK; Vancouver BC vs Vancouver WA.
  assert.equal(matchCanada('London').confidence, 'ambiguous');
  assert.equal(matchCanada('London, United Kingdom').isCanada, false);
  assert.equal(matchCanada('London, Ontario').confidence, 'confirmed');
  assert.equal(matchCanada('Vancouver, WA, United States').isCanada, false);
});

test('canada: remote handling', () => {
  assert.equal(matchCanada('Remote - Canada').confidence, 'confirmed');
  assert.equal(matchCanada('Remote - North America').confidence, 'ambiguous');
  assert.equal(matchCanada('Remote - US only').isCanada, false);
});

test('roles: target titles match', () => {
  const cases: Array<[string, string]> = [
    ['Software Engineer', 'swe'],
    ['Senior Software Engineer, Backend', 'swe'],
    ['Software Engineer Intern (Summer 2027)', 'swe'],
    ['Software Developer Co-op', 'swe'],
    ['2027 Software Dev Engineer Intern', 'swe'],
    ['Software Engineering INTERN', 'swe'],
    ['Frontend Software Engineer Intern - TikTok Foundation', 'swe'],
    ['Full Stack Developer', 'swe'],
    ['DevOps Engineer', 'devops'],
    ['Site Reliability Engineer Intern - Technical Infrastructure', 'devops'],
    ['Platform Engineer', 'devops'],
    ['Cloud Engineer', 'devops'],
    ['AI Engineer', 'ai-ml'],
    ['AI Developer', 'ai-ml'],
    ['Machine Learning Engineer', 'ai-ml'],
    ['Applied Scientist, LLM', 'ai-ml'],
  ];
  for (const [title, category] of cases) {
    const m = matchRole(title);
    assert.equal(m.matches, true, `should match: ${title}`);
    assert.equal(m.category, category, `wrong category for: ${title}`);
  }
});

test('roles: false positives excluded', () => {
  const bad = [
    'Sales Engineer',
    'Solutions Engineer',
    'Customer Engineer',
    'Hardware Engineer',
    'Software Engineering Manager',
    'Manager, Software Engineering',
    'Engineering Program Manager',
    'Technical Recruiter',
    'Mechanical Engineer Intern',
    'Product Manager',
    'Account Executive, AI Sales (Grower)',
  ];
  for (const title of bad) {
    assert.equal(matchRole(title).matches, false, `should exclude: ${title}`);
  }
});

test('roles: job type classification', () => {
  assert.equal(classifyType('Software Engineer Intern'), 'intern');
  // "Intern" beats "Co-op" when a title says both, so internships don't get split
  // across two filter values in the UI.
  assert.equal(classifyType('Software Engineering Intern - Fall-Spring Co-op'), 'intern');
  assert.equal(classifyType('Software Developer Co-op - Fall 2026'), 'intern');
  // Co-op still fires on its own when nothing says "intern".
  assert.equal(classifyType('Junior Full Stack Developer Coop'), 'co-op');
  assert.equal(classifyType('New Grad Software Engineer'), 'new-grad');
  assert.equal(classifyType('Software Engineer'), 'full-time');
});

test('roles: intern shorthand titles (no engineer/developer head word)', () => {
  // Internship titles routinely drop the head word. These were all dropped before.
  for (const t of [
    'Machine Learning Intern/Co-op  (Fall, 2026)',
    'Backend Intern',
    'Engineering Intern',
    'Engineering Co-op',
    'DevOps Intern',
    'Data Science Intern',
    'Web Development Co-op',
    'Intern - Software Engineering',
  ]) {
    assert.equal(matchRole(t).matches, true, `should match: ${t}`);
  }
  // Qualifiers may sit between the role word and the intern word.
  assert.equal(matchRole('Data Scientist, Fall 2026 ( Co-op/Internship) - 12 months').matches, true);
  assert.equal(matchRole('Software Developer, Summer 2027 (Co-op/Internship)').matches, true);

  // The shorthand must not open the door to non-engineering internships.
  for (const t of [
    'Governance, Risk, and Compliance Intern (Fall 2026)',
    'Marketing Intern',
    'Finance Co-op',
    'Sales Engineer Intern',
    'Mechanical Engineer Intern',
    'HR Intern',
  ]) {
    assert.equal(matchRole(t).matches, false, `should exclude: ${t}`);
  }

  // Real bank/insurer titles. "Internal"/"International" must never read as "intern" —
  // these dominate Workday results and would otherwise flood the intern filter.
  for (const t of [
    'Sr. Audit Manager, Internal Audit Quality Control',
    'Audit Manager I (US) Internal Audit Learning and Development',
    'Senior Manager, Internal Sales & Service Support',
    'Manager, International Tax Reporting and Compliance',
    'Equity Research Associate - Internet & New Media',
    'AVP, Internal Audit',
    'Actuarial Internship 2027',
    'C-FIN-201 Tax Intern – Tax Technology & AI Enablement',
  ]) {
    assert.equal(matchRole(t).matches, false, `should exclude: ${t}`);
  }
});

test('roles: software-development noun form (Workday postings)', () => {
  // Real posting that the old rules dropped: no "engineer"/"developer" head word.
  const m = matchRole('Stagiaire en développement de logiciels / Software Development Intern');
  assert.equal(m.matches, true);
  assert.equal(m.category, 'swe');
  assert.equal(m.type, 'intern');
  assert.equal(matchRole('Software Development Intern').matches, true);
  assert.equal(matchRole('Stage - Développement logiciel').matches, true);
  // "Student"/"undergrad" in INTERN must not drag in non-engineering roles.
  assert.equal(matchRole('Student Success Manager').matches, false);
});

test('roles: French titles (Quebec postings)', () => {
  // Real title seen in live data — "stagiaire" is an intern, not full-time.
  assert.equal(classifyType('Stagiaire DevOps - Automne 2026'), 'intern');
  assert.equal(matchRole('Stagiaire DevOps - Automne 2026').category, 'devops');
  assert.equal(matchRole('Développeur logiciel').matches, true);
  assert.equal(matchRole('Ingénieur logiciel senior').category, 'swe');
  assert.equal(classifyType('Développeur - stage été 2027'), 'intern');
});
