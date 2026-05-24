export function cleanProfileText(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function profileWordCount(value: unknown): number {
  return cleanProfileText(value).split(/\s+/).filter(Boolean).length;
}

function looksLikeShortProjectOrTopicFragment(text: string): boolean {
  const words = profileWordCount(text);
  if (words > 35) return false;
  if (/[.!?]\s*$/.test(text) || /[.!?]\s+[A-Z]/.test(text)) return false;
  if (!/[;,]| - /.test(text)) return false;
  if (/\b(?:I|we|my|our|his|her|their)\b/i.test(text)) return false;
  if (/\b(?:Dr\.|Professor|lab|group)\b/i.test(text)) return false;
  return true;
}

export function isWeakUserBioCandidate(value: unknown): boolean {
  const text = cleanProfileText(value);
  if (!text) return true;
  return looksLikeShortProjectOrTopicFragment(text);
}

export function researchNarrativeScore(value: unknown): number {
  const text = cleanProfileText(value);
  if (!text) return 0;

  let score = Math.min(1.8, profileWordCount(text) / 90);
  if (/\bResearch Areas?:/i.test(text)) score += 0.8;
  if (/\b(my|our)\s+research interests?\b/i.test(text)) score += 0.35;
  if (/\b(my|our|the)\s+lab\s+focus(?:es|ed)?\b/i.test(text)) score += 0.45;
  if (/\b(?:broad interest of (?:our|the) lab|research in the group is currently focused)\b/i.test(text)) {
    score += 0.7;
  }
  if (/\b(current|currently|collaborat(?:e|ing|ive)|project|fieldwork|expedition|study|studies)\b/i.test(text)) {
    score += 0.3;
  }
  if (/\b(research|morphology|systematics|phylogenetics|evolution|analysis|analyses|data|method|conservation)\b/i.test(text)) {
    score += 0.25;
  }
  if (/[.!?]\s+[A-Z]/.test(text)) score += 0.15;
  if (/Address:|Office Location:|Room \d+|Website\(link|link sends e-mail/i.test(text)) score -= 0.45;
  if (/^(?:Dr\.?\s+)?[A-Z][A-Za-z.'-]+ .*?\b(?:obtained|received|earned|appointed|will be appointed)\b/i.test(text)) {
    score -= 0.6;
  }
  if (/\b(?:B\.?A\.?|B\.?S\.?|Ph\.?D\.?|postdoctoral|mentorship)\b/i.test(text)) score -= 0.3;
  return Math.max(0.1, score);
}

export function isMaterializableUserBioCandidate(value: unknown): boolean {
  const text = cleanProfileText(value);
  if (!text) return false;
  if (profileWordCount(text) > 800) return false;
  if (profileWordCount(text) < 10 && text.length < 120) return false;
  if (isWeakUserBioCandidate(text)) return false;
  if (/\bAwardFund for Physician-Scientist MentorshipResourcesGrant LibraryGrant Writing Course/i.test(text)) {
    return false;
  }
  if (/\b(?:ResourcesGrant LibraryGrant Writing Course|NewsEngage with StudentsJoin Our Team)\b/i.test(text)) {
    return false;
  }
  if (/\b(?:Voluntary|Adjunct) faculty (?:are )?typically\b/i.test(text)) {
    return false;
  }
  if (/\b(?:Group Postdocs|PhD Students|Undergraduates|Alumni Postdocs|Alumni PhD Students)\b/i.test(text)) {
    return false;
  }
  if (/\b(?:View Doctor Profile|Patient Care Locations|making an appointment|Your browser is antiquated)\b/i.test(text)) {
    return false;
  }
  if (/\b(?:Yale Co-AuthorsFrequent collaborators of|Publications TimelineA big-picture view of)\b/i.test(text)) {
    return false;
  }
  if (/\bContactsEmail\S+@\S+|ContactsEmail[A-Za-z0-9._%+-]+@yale\.edu/i.test(text)) {
    return false;
  }
  if (
    /\b(?:DOI:|Peer-Reviewed|Journal Of|Journal of|Selected Publications?|Original Research|Supplemental Material|For a list of selected publications)\b/i.test(
      text,
    )
  ) {
    return false;
  }
  if (
    /\b(?:Grand Rounds|Wall Street Journal|Case Studies in Primary|Title A Novel Approach|Flights to Europe)\b/i.test(
      text,
    )
  ) {
    return false;
  }
  if (/\b(?:New Haven,\s*CT|Prospect Street|Sachem St|Kline Tower|Rosenkranz Hall|Room \d+)\b/i.test(text)) {
    return false;
  }
  if (/^\s*(?:[\w\s.-]+)?(?:Room\s*)?\d{2,5}\s+[A-Z][A-Za-z\s]+(?:Street|St|Avenue|Ave|Road|Rd)\b/i.test(text)) {
    return false;
  }
  return researchNarrativeScore(text) >= 0.25;
}
