import {
  type Contact,
  type Education,
  type Language,
  type Period,
  PRESENT,
  type Publication,
  type Resume,
  type Role,
  type SkillGroup,
} from '../content/resume.ts';
import type { Item } from '../types.ts';
import { articleContent, draftBanner } from './article.ts';
import { heading, html, type Interpolation, Markup } from './html.ts';

export interface ResumeOptions {
  readonly item: Item;
  /** Rendered content of the page, shown below the header. */
  readonly intro: string;
  readonly resume: Resume;
  /** Renders inline Markdown to HTML. */
  readonly inline: (source: string) => string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function month(value: string): Markup {
  const [year = '', number = ''] = value.split('-');
  return html`<time datetime="${value}">${MONTHS[Number(number) - 1]} ${year}</time>`;
}

function period({ start, end }: Period): Markup {
  const to = end === PRESENT ? 'Present' : month(end);
  return html`<p class="resume-period">${month(start)} – ${to}</p>`;
}

/** One position or degree: title, place, period, then `body`. */
function entry(title: string, place: string, dates: Period, body: Markup | ''): Markup {
  return html`<li class="resume-entry">
<header>
${heading(3, title)}
<p class="resume-place">${place}</p>
${period(dates)}
</header>
${body}
</li>`;
}

const entryList = (entries: readonly Markup[]): Markup =>
  html`<ul class="resume-entries">${entries}</ul>`;

/** A titled section; nothing when `list` is empty. */
function section<T>(
  title: string,
  list: readonly T[],
  body: (list: readonly T[]) => Interpolation,
): Markup | '' {
  return list.length === 0
    ? ''
    : html`<section class="resume-section"><h2>${title}</h2>${body(list)}</section>`;
}

function roleEntries(list: readonly Role[], inline: ResumeOptions['inline']): Markup[] {
  return list.map(({ role, org, location, start, end, highlights }) =>
    entry(
      role,
      [org, location].filter(Boolean).join(', '),
      { start, end },
      highlights.length > 0
        ? html`<ul>${highlights.map((h) => html`<li>${new Markup(inline(h))}</li>`)}</ul>`
        : '',
    ),
  );
}

const educationEntries = (list: readonly Education[]): Markup[] =>
  list.map(({ degree, institution, note, start, end }) =>
    entry(degree, institution, { start, end }, note ? html`<p>${note}</p>` : ''),
  );

const skillList = (list: readonly SkillGroup[]): Markup =>
  html`<dl class="resume-skills">${list.map(
    ({ group, items }) => html`<div><dt>${group}</dt><dd>${items.join(', ')}</dd></div>`,
  )}</dl>`;

const languageList = (list: readonly Language[]): Markup =>
  html`<ul class="resume-languages">${list.map(
    ({ name, level }) => html`<li><strong>${name}</strong>${level && html` — ${level}`}</li>`,
  )}</ul>`;

const publicationList = (list: readonly Publication[]): Markup =>
  html`<ol class="resume-publications">${list.map(
    ({ title, venue, year, url }) =>
      html`<li>${url ? html`<a href="${url}">${title}</a>` : title}. ${venue}, ${year}.</li>`,
  )}</ol>`;

function contactList({ location, email, links }: Contact): Markup | '' {
  const items = [
    location,
    email && html`<a href="mailto:${email}">${email}</a>`,
    ...links.map((l) => html`<a href="${l.url}">${l.label}</a>`),
  ].filter((i) => i !== undefined && i !== '');
  return items.length === 0
    ? ''
    : html`<ul class="resume-contact">${items.map((i) => html`<li>${i}</li>`)}</ul>`;
}

/** `<main>` content of the resume page: header with contact details, the page's own text, then the sections. */
export function renderResume({ item, intro, resume, inline }: ResumeOptions): Markup {
  const { headline, contact, experience, education, teaching, publications, skills, languages } =
    resume;
  return html`<section class="resume">
<header class="resume-header">
${draftBanner(item)}
${heading(1, item.meta.title)}
${headline && html`<p class="resume-headline">${headline}</p>`}
${contactList(contact)}
</header>
${intro.trim() !== '' && articleContent(intro)}
${section('Experience', experience, (l) => entryList(roleEntries(l, inline)))}
${section('Education', education, (l) => entryList(educationEntries(l)))}
${section('Teaching', teaching, (l) => entryList(roleEntries(l, inline)))}
${section('Publications', publications, publicationList)}
${section('Skills', skills, skillList)}
${section('Languages', languages, languageList)}
</section>`;
}
