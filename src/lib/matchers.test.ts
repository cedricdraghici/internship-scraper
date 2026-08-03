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
  assert.equal(classifyType('Software Engineering Intern - Fall-Spring Co-op'), 'co-op');
  assert.equal(classifyType('New Grad Software Engineer'), 'new-grad');
  assert.equal(classifyType('Software Engineer'), 'full-time');
});

test('roles: French titles (Quebec postings)', () => {
  // Real title seen in live data — "stagiaire" is an intern, not full-time.
  assert.equal(classifyType('Stagiaire DevOps - Automne 2026'), 'intern');
  assert.equal(matchRole('Stagiaire DevOps - Automne 2026').category, 'devops');
  assert.equal(matchRole('Développeur logiciel').matches, true);
  assert.equal(matchRole('Ingénieur logiciel senior').category, 'swe');
  assert.equal(classifyType('Développeur - stage été 2027'), 'intern');
});
