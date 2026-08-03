/**
 * Role title matching. See "Roles to target" in CLAUDE.md.
 *
 * Order matters: exclusions run before inclusions, because most false positives
 * ("Sales Engineer", "Engineering Manager") also contain a matching keyword.
 */

import type { JobType, RoleCategory } from '../types.js';

/**
 * Titles that contain a match keyword but are not the job I want.
 * Checked first — an exclusion always wins.
 */
const EXCLUSIONS: Array<[RegExp, string]> = [
  [/\b(sales|solutions?|customer|field|support|partner|forward.deployed)\s+engineer/, 'non-eng-engineer'],
  [/\b(hardware|mechanical|electrical|civil|chemical|industrial|process|manufacturing|firmware|test|quality|validation|optical|rf)\s+engineer/, 'other-discipline'],
  [/\b(engineering|software|technical|development)\s+(manager|director|lead|head)\b/, 'management'],
  [/\bmanager,?\s+(software|engineering)/, 'management'],
  [/\b(vp|vice president|head of|chief|principal architect)\b/, 'leadership'],
  [/\b(recruiter|sourcer|talent|hr|people ops)\b/, 'recruiting'],
  [/\b(technical writer|documentation|content|marketing|designer|ux researcher)\b/, 'non-eng'],
  [/\b(professor|lecturer|instructor|teaching assistant|postdoc)\b/, 'academic'],
  [/\bengineering\s+(program|project|product)\s+manager/, 'management'],
  [/\b(program|project|product)\s+manager\b/, 'management'],
];

/** [pattern, category, ruleName] — first match wins, so order most-specific first. */
const INCLUSIONS: Array<[RegExp, RoleCategory, string]> = [
  // AI / ML
  [/\b(ai|artificial intelligence)\s+(engineer|developer|dev)\b/, 'ai-ml', 'ai-engineer'],
  [/\b(ml|machine learning)\s+(engineer|developer|dev)\b/, 'ai-ml', 'ml-engineer'],
  [/\b(deep learning|nlp|computer vision|llm|genai|generative ai)\s+(engineer|developer|scientist)\b/, 'ai-ml', 'ai-specialty'],
  [/\bapplied\s+(scientist|ml|ai)\b/, 'ai-ml', 'applied-scientist'],
  [/\bresearch engineer\b/, 'ai-ml', 'research-engineer'],
  [/\bmlops\b/, 'ai-ml', 'mlops'],

  // DevOps / infra
  [/\bdev\s?ops\b/, 'devops', 'devops'],
  [/\b(site reliability|sre)\b/, 'devops', 'sre'],
  [/\b(platform|infrastructure|infra|cloud|systems?)\s+engineer\b/, 'devops', 'platform-infra'],
  [/\b(build|release|deployment)\s+engineer\b/, 'devops', 'build-release'],

  // Core software
  [/\bsoftware\s+(development\s+)?engineer\b/, 'swe', 'software-engineer'],
  [/\bsoftware\s+(developer|dev)\b/, 'swe', 'software-developer'],
  [/\bsoftware\s+engineering\b/, 'swe', 'software-engineering'],
  [/\bsoftware\s+dev\b/, 'swe', 'software-dev'],
  [/\b(sde|swe)\b/, 'swe', 'sde-swe'],
  [/\b(front.?end|back.?end|full.?stack|web|mobile|ios|android|game|embedded|systems)\s+(engineer|developer|dev)\b/, 'swe', 'specialty-developer'],
  [/\b(engineer|developer)\s*,?\s*(front.?end|back.?end|full.?stack|infrastructure|platform)\b/, 'swe', 'developer-comma-specialty'],
  [/\b(programmer|developer)\b/, 'swe', 'generic-developer'],
  [/\bengineer\b.*\b(intern|co.?op)\b/, 'swe', 'engineer-intern'],

  // French titles — common in Quebec postings.
  [/\bing(é|e)nieur\s+(logiciel|en logiciel|d(é|e)veloppement)/, 'swe', 'fr-ingenieur-logiciel'],
  [/\bd(é|e)veloppeur(\.?se)?\b/, 'swe', 'fr-developpeur'],
  [/\bg(é|e)nie logiciel\b/, 'swe', 'fr-genie-logiciel'],
];

// French variants matter: Quebec postings are frequently listed in French
// ("Stagiaire DevOps - Automne 2026" is an internship, not a full-time role).
const INTERN = /\bintern(ship)?\b|\bco.?op\b|\bsummer\s+20\d\d\b|\bstudent\b|\bplacement\b|\bstagiaire\b|\bstage\b|\b(é|e)tudiant\b/;
const COOP = /\bco.?op\b|\balternance\b/;
const NEW_GRAD = /\bnew\s?grad(uate)?\b|\bentry.level\b|\buniversity grad|\bcampus\b|\bearly career\b|\bjeune dipl(ô|o)m(é|e)\b/;
const CONTRACT = /\bcontract(or)?\b|\bfixed.term\b|\btemporary\b|\bfreelance\b|\bcontractuel\b/;

export interface RoleMatch {
  matches: boolean;
  category: RoleCategory | null;
  type: JobType | null;
  matchedBy: string | null;
  /** Set when an exclusion fired, for debugging the filter. */
  excludedBy?: string;
}

export function normalizeTitle(title: string): string {
  return (title ?? '')
    .toLowerCase()
    .replace(/[_/|]/g, ' ')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

export function classifyType(title: string): JobType | null {
  const t = normalizeTitle(title);
  if (COOP.test(t)) return 'co-op';
  if (INTERN.test(t)) return 'intern';
  if (NEW_GRAD.test(t)) return 'new-grad';
  if (CONTRACT.test(t)) return 'contract';
  return 'full-time';
}

export function matchRole(title: string): RoleMatch {
  const t = normalizeTitle(title);
  if (!t) return { matches: false, category: null, type: null, matchedBy: null };

  for (const [re, reason] of EXCLUSIONS) {
    if (re.test(t)) {
      return { matches: false, category: null, type: null, matchedBy: null, excludedBy: reason };
    }
  }

  for (const [re, category, rule] of INCLUSIONS) {
    if (re.test(t)) {
      return { matches: true, category, type: classifyType(t), matchedBy: rule };
    }
  }

  return { matches: false, category: null, type: null, matchedBy: null };
}
