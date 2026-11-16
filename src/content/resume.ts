import { safeHttpUrl } from '../lib/url.ts';
import { isRecord } from '../shared/guards.ts';
import type { Link } from '../types.ts';
import { linkList, listOf, scalarText, type Warn } from './model.ts';

/** End date of a position that has not ended. */
export const PRESENT = 'present';

/** `YYYY-MM` months; `end` may also be `PRESENT`. */
export interface Period {
  readonly start: string;
  readonly end: string;
}

export interface Role extends Period {
  readonly role: string;
  readonly org: string;
  readonly location?: string;
  /** Inline Markdown. */
  readonly highlights: readonly string[];
}

export interface Education extends Period {
  readonly degree: string;
  readonly institution: string;
  readonly note?: string;
}

export interface SkillGroup {
  readonly group: string;
  readonly items: readonly string[];
}

export interface Language {
  readonly name: string;
  readonly level?: string;
}

export interface Publication {
  readonly title: string;
  readonly venue: string;
  readonly year: string;
  readonly url?: string;
}

export interface Contact {
  readonly location?: string;
  readonly email?: string;
  readonly links: readonly Link[];
}

export interface Resume {
  readonly headline?: string;
  readonly contact: Contact;
  readonly experience: readonly Role[];
  readonly education: readonly Education[];
  readonly skills: readonly SkillGroup[];
  readonly languages: readonly Language[];
  readonly publications: readonly Publication[];
  readonly teaching: readonly Role[];
}

type Fields = Readonly<Record<string, unknown>>;

const MONTH_RE = /^\d{4}-(?:0[1-9]|1[0-2])$/;
const YEAR_RE = /^\d{4}$/;
/** No whitespace, quotes or the characters that start a `mailto:` header (`?`, `&`) or add recipients (`,`, `;`). */
const ADDRESS_PART = '[^\\s@<>"?&,;]+';
const EMAIL_RE = new RegExp(`^${ADDRESS_PART}@${ADDRESS_PART}\\.${ADDRESS_PART}$`);

const TOP_KEYS = new Set([
  'headline',
  'contact',
  'experience',
  'education',
  'skills',
  'languages',
  'publications',
  'teaching',
]);
const CONTACT_KEYS = new Set(['location', 'email', 'links']);
const ROLE_KEYS = new Set(['role', 'org', 'location', 'start', 'end', 'highlights']);
const EDUCATION_KEYS = new Set(['degree', 'institution', 'start', 'end', 'note']);
const SKILL_KEYS = new Set(['group', 'items']);
const LANGUAGE_KEYS = new Set(['name', 'level']);
const PUBLICATION_KEYS = new Set(['title', 'venue', 'year', 'url']);

/** True for a `YYYY-MM` string naming a real month. */
export const isValidMonth = (value: unknown): value is string =>
  typeof value === 'string' && MONTH_RE.test(value);

/** YAML's failsafe schema keeps `~` and `null` as strings; as a whole value they mean absent. */
const NULL_WORDS: ReadonlySet<string> = new Set(['~', 'null']);

/** Trimmed text of a scalar field; undefined for anything else and for a null word. */
function scalar(value: unknown): string | undefined {
  const t = scalarText(value);
  return t !== undefined && NULL_WORDS.has(t) ? undefined : t;
}

/** Non-empty trimmed text of a scalar field. */
const text = (value: unknown): string | undefined => scalar(value) || undefined;

/** Warns about each key outside `known`; `where` names the entry ('' at the top level). */
function checkKeys(fields: Fields, known: ReadonlySet<string>, where: string, warn: Warn): void {
  const prefix = where ? `${where}: ` : '';
  for (const key of Object.keys(fields)) {
    if (!known.has(key)) {
      warn(`${prefix}unknown key "${key}"; ignored`);
    }
  }
}

/** Non-empty text entries of a list; anything else warns. */
function textList(value: unknown, where: string, warn: Warn): string[] {
  return listOf(value, where, warn, '', (item) => {
    const entry = scalar(item);
    if (entry === undefined) {
      warn(`${where}: ignoring non-text entry ${JSON.stringify(item)}`);
    }
    return entry || undefined;
  });
}

/** Mapping entries of a list, each read by `parse`; non-mappings and entries `parse` rejects (undefined) are dropped with a warning. */
function entries<T>(
  value: unknown,
  where: string,
  warn: Warn,
  parse: (fields: Fields, where: string, warn: Warn) => T | undefined,
): T[] {
  return listOf(value, where, warn, '', (raw, at) => {
    if (isRecord(raw)) {
      return parse(raw, at, warn);
    }
    warn(`${at}: expected a mapping; entry ignored`);
    return undefined;
  });
}

/** Valid `start` and `end` (a month or `present`, `end` not before `start`); undefined, with a warning, otherwise. A start after `thisMonth` warns but stays. */
function period(fields: Fields, where: string, warn: Warn, thisMonth: string): Period | undefined {
  const start = scalar(fields.start);
  const end = scalar(fields.end)?.toLowerCase();
  if (!isValidMonth(start)) {
    warn(`${where}: start must be a month, YYYY-MM; entry ignored`);
  } else if (end !== PRESENT && !isValidMonth(end)) {
    warn(`${where}: end must be a month, YYYY-MM, or "${PRESENT}"; entry ignored`);
  } else if (end !== PRESENT && end < start) {
    warn(`${where}: end ${end} is before start ${start}; entry ignored`);
  } else {
    if (start > thisMonth) {
      warn(`${where}: start ${start} is in the future`);
    }
    return { start, end };
  }
  return undefined;
}

function role(fields: Fields, where: string, warn: Warn, thisMonth: string): Role | undefined {
  checkKeys(fields, ROLE_KEYS, where, warn);
  const [title, org, location] = [text(fields.role), text(fields.org), text(fields.location)];
  if (!title || !org) {
    warn(`${where}: needs a role and an org; entry ignored`);
    return undefined;
  }
  const dates = period(fields, where, warn, thisMonth);
  return (
    dates && {
      role: title,
      org,
      ...(location ? { location } : {}),
      ...dates,
      highlights: textList(fields.highlights, `${where}.highlights`, warn),
    }
  );
}

function education(
  fields: Fields,
  where: string,
  warn: Warn,
  thisMonth: string,
): Education | undefined {
  checkKeys(fields, EDUCATION_KEYS, where, warn);
  const [degree, institution, note] = [
    text(fields.degree),
    text(fields.institution),
    text(fields.note),
  ];
  if (!degree || !institution) {
    warn(`${where}: needs a degree and an institution; entry ignored`);
    return undefined;
  }
  const dates = period(fields, where, warn, thisMonth);
  return dates && { degree, institution, ...(note ? { note } : {}), ...dates };
}

function skillGroup(fields: Fields, where: string, warn: Warn): SkillGroup | undefined {
  checkKeys(fields, SKILL_KEYS, where, warn);
  const group = text(fields.group);
  const items = textList(fields.items, `${where}.items`, warn);
  if (!group || items.length === 0) {
    warn(`${where}: needs a group and at least one item; entry ignored`);
    return undefined;
  }
  return { group, items };
}

function language(fields: Fields, where: string, warn: Warn): Language | undefined {
  checkKeys(fields, LANGUAGE_KEYS, where, warn);
  const [name, level] = [text(fields.name), text(fields.level)];
  if (!name) {
    warn(`${where}: needs a name; entry ignored`);
    return undefined;
  }
  return { name, ...(level ? { level } : {}) };
}

function publication(fields: Fields, where: string, warn: Warn): Publication | undefined {
  checkKeys(fields, PUBLICATION_KEYS, where, warn);
  const [title, venue, year] = [text(fields.title), text(fields.venue), scalar(fields.year)];
  if (!title || !venue || !year || !YEAR_RE.test(year)) {
    warn(`${where}: needs a title, a venue and a four-digit year; entry ignored`);
    return undefined;
  }
  const url = safeHttpUrl(fields.url);
  if (fields.url != null && !url) {
    warn(`${where}: url is not an http(s) URL; ignored`);
  }
  return { title, venue, year, ...(url ? { url } : {}) };
}

function contact(value: unknown, warn: Warn): Contact {
  if (value == null) {
    return { links: [] };
  }
  if (!isRecord(value)) {
    warn('contact: expected a mapping; ignored');
    return { links: [] };
  }
  checkKeys(value, CONTACT_KEYS, 'contact', warn);
  const [location, email] = [text(value.location), text(value.email)];
  const validEmail = email !== undefined && EMAIL_RE.test(email);
  if (email !== undefined && !validEmail) {
    warn(`contact.email: not an email address ${JSON.stringify(email)}; ignored`);
  }
  return {
    ...(location ? { location } : {}),
    ...(validEmail ? { email } : {}),
    links: linkList(value.links, warn, 'contact.links'),
  };
}

/**
 * Leniently read the resume data: every problem becomes a warning and drops
 * the offending entry (or field), never the whole resume.
 *
 * @param now the current date; a position that starts after this month warns
 * @returns the resume, or null when `data` is not a mapping
 */
export function parseResume(
  data: unknown,
  now: Date,
): { resume: Resume | null; warnings: string[] } {
  const warnings: string[] = [];
  const warn: Warn = (msg) => warnings.push(msg);
  if (!isRecord(data)) {
    warn('expected a mapping at the top level; ignored');
    return { resume: null, warnings };
  }
  checkKeys(data, TOP_KEYS, '', warn);
  const thisMonth = now.toISOString().slice(0, 7);
  const headline = text(data.headline);
  const resume: Resume = {
    ...(headline ? { headline } : {}),
    contact: contact(data.contact, warn),
    experience: entries(data.experience, 'experience', warn, (f, w, wn) =>
      role(f, w, wn, thisMonth),
    ),
    education: entries(data.education, 'education', warn, (f, w, wn) =>
      education(f, w, wn, thisMonth),
    ),
    skills: entries(data.skills, 'skills', warn, skillGroup),
    languages: entries(data.languages, 'languages', warn, language),
    publications: entries(data.publications, 'publications', warn, publication),
    teaching: entries(data.teaching, 'teaching', warn, (f, w, wn) => role(f, w, wn, thisMonth)),
  };
  return { resume, warnings };
}

const roleText = ({ role, org, location, highlights }: Role): string[] => [
  role,
  org,
  location ?? '',
  ...highlights,
];

/** The resume's words as plain text for search indexing; dates and URLs are left out. */
export function resumeText(resume: Resume): string {
  const { headline, contact, experience, education, teaching, publications, skills, languages } =
    resume;
  const words = [
    headline ?? '',
    contact.location ?? '',
    ...contact.links.map((l) => l.label),
    ...experience.flatMap(roleText),
    ...education.flatMap((e) => [e.degree, e.institution, e.note ?? '']),
    ...teaching.flatMap(roleText),
    ...publications.flatMap((p) => [p.title, p.venue]),
    ...skills.flatMap((s) => [s.group, ...s.items]),
    ...languages.flatMap((l) => [l.name, l.level ?? '']),
  ];
  return words.join(' ').replace(/\s+/g, ' ').trim();
}
