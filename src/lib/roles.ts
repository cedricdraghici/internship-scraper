/**
 * Role title matching. See "Roles to target" in CLAUDE.md.
 *
 * Order matters: exclusions run before inclusions, because most false positives
 * ("Sales Engineer", "Engineering Manager") also contain a matching keyword.
 */

import type { JobType, RoleCategory } from '../types.js';

/**
 * Titles that contain a match keyword but are not the job I want.
 * Checked first, an exclusion always wins.
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
  // Bank and insurer intern programs are mostly finance roles. Without this,
  // "Financial Advisor Intern - Mobile" matched the intern shorthand, which read
  // "mobile" as mobile development.
  // Deliberately narrow: bare "risk" or "analyst" would drop real engineering roles
  // like "Software Developer Intern, Risk Platform", so match the finance job itself
  // rather than any mention of a finance-adjacent word.
  [/\b(financial|finance|investment|banking|wealth|actuarial|accounting|underwriting)\s+(advisor|adviser|analyst|associate|intern(ship)?|co.?op|specialist|officer|manager|consultant|representative)\b/, 'finance'],
  [/\b(actuarial|audit|tax|teller|branch manager|relationship manager)\b/, 'finance'],
  [/\b(financial|investment|banking|wealth)\s+(advisor|adviser)\b/, 'non-eng-business'],
];

/** [pattern, category, ruleName], first match wins, so order most-specific first. */
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
  // "Software Development Intern" / "Software Development Co-op": the noun form,
  // with no "engineer"/"developer" head word. Common on Workday postings.
  [/\bsoftware\s+development\b/, 'swe', 'software-development'],
  [/\bsoftware\s+dev\b/, 'swe', 'software-dev'],
  [/\b(sde|swe)\b/, 'swe', 'sde-swe'],
  [/\b(front.?end|back.?end|full.?stack|web|mobile|ios|android|game|embedded|systems)\s+(engineer|developer|dev)\b/, 'swe', 'specialty-developer'],
  [/\b(engineer|developer)\s*,?\s*(front.?end|back.?end|full.?stack|infrastructure|platform)\b/, 'swe', 'developer-comma-specialty'],
  [/\b(programmer|developer)\b/, 'swe', 'generic-developer'],
  [/\bengineer\b.*\b(intern|co.?op)\b/, 'swe', 'engineer-intern'],

  // Intern shorthand: internship titles routinely drop the "engineer"/"developer"
  // head word ("Machine Learning Intern", "Backend Intern", "Engineering Co-op"),
  // so the rules above never fire on them. Only trust these when the title actually
  // says intern/co-op, bare "Data Science" or "Security" is not a role we want.
  //
  // `intern` here is deliberately \bintern\b(ship)? and never a bare prefix: "Internal
  // Audit Manager" and "Internal Sales" would otherwise match, and banks post many of
  // both. Separators are allowed between the role word and the intern word so
  // "Data Scientist, Fall 2026 (Co-op/Internship)" still matches.
  [/\b(ml|machine learning|ai|deep learning|nlp|computer vision|data scien(ce|tist)|applied scien(ce|tist))\b.*\b(intern(ship)?|co.?op)\b/, 'ai-ml', 'ai-ml-intern-shorthand'],
  [/\b(devops|sre|site reliability|platform|infrastructure|cloud)\b.*\b(intern(ship)?|co.?op)\b/, 'devops', 'devops-intern-shorthand'],
  [/\b(software|engineering|developer|development|technical|back.?end|front.?end|full.?stack|web|mobile|ios|android|embedded|systems|qa|test automation|programm(er|ing))\b.*\b(intern(ship)?|co.?op)\b/, 'swe', 'swe-intern-shorthand'],
  // Reverse order: "Intern - Software Engineering", "Co-op, Backend".
  [/\b(intern(ship)?|co.?op)\b.*\b(software|engineering|developer|development|back.?end|front.?end|full.?stack|web|mobile|devops|machine learning|data scien(ce|tist))\b/, 'swe', 'intern-prefix-shorthand'],

  // French titles, common in Quebec postings.
  [/\bing(é|e)nieur\s+(logiciel|en logiciel|d(é|e)veloppement)/, 'swe', 'fr-ingenieur-logiciel'],
  [/\bd(é|e)veloppeur(\.?se)?\b/, 'swe', 'fr-developpeur'],
  [/\bg(é|e)nie logiciel\b/, 'swe', 'fr-genie-logiciel'],
  // Noun form: "Stagiaire en développement de logiciels", "Stage - Développement logiciel".
  [/\bd(é|e)veloppement\s+(de\s+)?logiciels?\b/, 'swe', 'fr-developpement-logiciel'],
  [/\bd(é|e)veloppement\s+(web|mobile|infonuagique|cloud|full.?stack)\b/, 'swe', 'fr-developpement-specialty'],
  [/\bstagiaire\s+en\s+(d(é|e)veloppement|informatique|logiciel|programmation)/, 'swe', 'fr-stagiaire-dev'],
];

// French variants matter: Quebec postings are frequently listed in French
// ("Stagiaire DevOps - Automne 2026" is an internship, not a full-time role).
// Note: co-op patterns deliberately live in COOP only, not here, INTERN is tested
// first, so repeating them would make `co-op` unreachable.
const INTERN = /\bintern(ship)?s?\b|\bsummer\s+20\d\d\b|\b(fall|winter|spring|summer)\s+(term|20\d\d)\b|\bstudent\b|\bplacement\b|\bstagiaire\b|\bstages?\b|\b(é|e)tudiant(e)?\b|\bapprenti(ce|ceship)?\b|\bundergrad(uate)?\b|\bwork\s+term\b/;
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
  // "Intern" wins over "Co-op": titles like "Software Engineering Intern -
  // Fall-Spring Co-op" contain both, and calling those `co-op` split the real
  // internships across two filter values. Co-op only fires when nothing says intern.
  if (INTERN.test(t)) return 'intern';
  if (COOP.test(t)) return 'co-op';
  if (NEW_GRAD.test(t)) return 'new-grad';
  if (CONTRACT.test(t)) return 'contract';
  return 'full-time';
}

/** True for the student-track types, what the `--interns-only` scrape keeps. */
export function isStudentType(type: JobType | null): boolean {
  return type === 'intern' || type === 'co-op';
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
