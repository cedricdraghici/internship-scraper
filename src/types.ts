/** The normalized shape every adapter must produce. See CLAUDE.md. */

export type JobType = 'intern' | 'co-op' | 'new-grad' | 'full-time' | 'contract';
export type RoleCategory = 'swe' | 'devops' | 'ai-ml';
export type JobStatus = 'new' | 'interested' | 'applied' | 'rejected' | 'offer';

/** How confident we are that this posting is actually in Canada. */
export type CanadaConfidence = 'confirmed' | 'ambiguous';

export interface JobPosting {
  /** Stable hash of company+title+location, used for dedupe across sources. */
  id: string;
  title: string;
  company: string;
  location: string;
  /** Two-letter province code when we could parse one, else null. */
  province: string | null;
  remote: boolean;
  url: string;
  source: string;
  /** ISO date the source says it was posted; null when the source only gives an age. */
  postedAt: string | null;
  /** ISO date we first saw it. Set by storage, not by adapters. */
  firstSeenAt: string;
  salaryRaw: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  type: JobType | null;
  roleCategory: RoleCategory | null;
  /** Which title rule matched, so the filter can be tuned against real results. */
  matchedBy: string | null;
  canadaConfidence: CanadaConfidence;
  /** Which location rule fired. */
  canadaMatchedBy: string | null;
  sponsorship: string | null;
  description: string | null;
  status: JobStatus;
}

/** What an adapter returns before storage fills in bookkeeping fields. */
export type RawJob = Omit<
  JobPosting,
  | 'id'
  | 'firstSeenAt'
  | 'status'
  | 'province'
  | 'roleCategory'
  | 'matchedBy'
  | 'canadaConfidence'
  | 'canadaMatchedBy'
>;

export interface Adapter {
  name: string;
  fetch(): Promise<RawJob[]>;
}

export interface SourceResult {
  source: string;
  ok: boolean;
  fetched: number;
  kept: number;
  inserted: number;
  updated: number;
  error?: string;
  ms: number;
}
