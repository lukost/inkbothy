import { describe, expect, it } from 'vitest';
import { isValidMonth, parseResume, type Resume, resumeText } from '../../src/content/resume.ts';

const NOW = new Date('2026-06-15T00:00:00Z');
const role = {
  role: 'Engineer',
  org: 'Acme',
  location: 'Berlin',
  start: '2020-03',
  end: '2022-06',
  highlights: ['Did *things*', 'Did more'],
};
const education = {
  degree: 'MSc',
  institution: 'Uni',
  start: '2012-10',
  end: '2017-06',
  note: 'Thesis',
};

/** The resume read from `data`, which must be a mapping. */
function read(data: unknown): { resume: Resume; warnings: string[] } {
  const { resume, warnings } = parseResume(data, NOW);
  if (!resume) {
    throw new Error('expected a resume');
  }
  return { resume, warnings };
}

describe('isValidMonth', () => {
  it.each(['2020-01', '2020-12', '0001-09'])('accepts %s', (v) => {
    expect(isValidMonth(v)).toBe(true);
  });

  it.each([
    '2020-00',
    '2020-13',
    '2020-1',
    '20-01',
    '2020-01-01',
    ' 2020-01',
    202001,
    null,
    undefined,
  ])('rejects %j', (v) => {
    expect(isValidMonth(v)).toBe(false);
  });
});

describe('parseResume', () => {
  it('reads every field', () => {
    const { resume, warnings } = read({
      headline: ' Systems engineer ',
      contact: {
        location: 'Berlin',
        email: 'me@example.com',
        links: [{ label: 'Code', url: 'https://example.com/me' }],
      },
      experience: [role],
      education: [education],
      skills: [{ group: 'Languages', items: ['C', 'Rust'] }],
      languages: [{ name: 'English', level: 'fluent' }],
      publications: [{ title: 'Paper', venue: 'Conf', year: '2019', url: 'https://example.com/p' }],
      teaching: [{ ...role, role: 'Lecturer' }],
    });
    expect(warnings).toEqual([]);
    expect(resume).toEqual({
      headline: 'Systems engineer',
      contact: {
        location: 'Berlin',
        email: 'me@example.com',
        links: [{ label: 'Code', url: 'https://example.com/me' }],
      },
      experience: [role],
      education: [education],
      skills: [{ group: 'Languages', items: ['C', 'Rust'] }],
      languages: [{ name: 'English', level: 'fluent' }],
      publications: [{ title: 'Paper', venue: 'Conf', year: '2019', url: 'https://example.com/p' }],
      teaching: [{ ...role, role: 'Lecturer' }],
    });
  });

  it('accepts an empty mapping: every section is optional', () => {
    const { resume, warnings } = read({});
    expect(warnings).toEqual([]);
    expect(resume).toEqual({
      contact: { links: [] },
      experience: [],
      education: [],
      skills: [],
      languages: [],
      publications: [],
      teaching: [],
    });
  });

  it.each([null, undefined, 'text', 4, ['a']])('rejects %j as a whole', (data) => {
    const { resume, warnings } = parseResume(data, NOW);
    expect(resume).toBeNull();
    expect(warnings).toEqual(['expected a mapping at the top level; ignored']);
  });

  it('keeps optional fields out when they are absent or blank', () => {
    const { resume } = read({
      experience: [{ role: 'R', org: 'O', start: '2020-01', end: '2020-02', location: ' ' }],
      education: [{ degree: 'D', institution: 'I', start: '2010-01', end: '2011-01' }],
      languages: [{ name: 'Polish' }],
      publications: [{ title: 'T', venue: 'V', year: 2020 }],
    });
    expect(resume.experience[0]).toEqual({
      role: 'R',
      org: 'O',
      start: '2020-01',
      end: '2020-02',
      highlights: [],
    });
    expect(resume.education[0]).not.toHaveProperty('note');
    expect(resume.languages[0]).toEqual({ name: 'Polish' });
    expect(resume.publications[0]).toEqual({ title: 'T', venue: 'V', year: '2020' });
  });

  describe('periods', () => {
    it.each(['present', 'Present', ' PRESENT '])('accepts end %j', (end) => {
      const { resume, warnings } = read({ experience: [{ ...role, end }] });
      expect(warnings).toEqual([]);
      expect(resume.experience[0]?.end).toBe('present');
    });

    it('accepts a one-month stay', () => {
      const { resume, warnings } = read({
        experience: [{ ...role, start: '2020-05', end: '2020-05' }],
      });
      expect(warnings).toEqual([]);
      expect(resume.experience).toHaveLength(1);
    });

    it.each([
      ['start', '2020-13'],
      ['start', '2020-1'],
      ['start', '2020-02-30'],
      ['start', undefined],
      ['start', 'now'],
      ['end', '2020-00'],
      ['end', 'soon'],
      ['end', undefined],
    ])('drops an entry whose %s is %j, with a warning', (key, value) => {
      const { resume, warnings } = read({
        experience: [{ ...role }, { ...role, [key]: value }],
      });
      expect(resume.experience).toHaveLength(1);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(new RegExp(`^experience\\[1\\]: ${key} must be a month`));
    });

    it('drops an entry that ends before it starts', () => {
      const { resume, warnings } = read({
        education: [{ ...education, start: '2017-06', end: '2012-10' }],
      });
      expect(resume.education).toEqual([]);
      expect(warnings).toEqual([
        'education[0]: end 2012-10 is before start 2017-06; entry ignored',
      ]);
    });
  });

  describe('entries', () => {
    it.each(['experience', 'education', 'skills', 'languages', 'publications', 'teaching'])(
      'warns about a %s that is not a list',
      (key) => {
        const { warnings } = read({ [key]: { a: 1 } });
        expect(warnings).toEqual([`${key}: expected a list; ignored`]);
      },
    );

    it.each(['text', 5, null, ['x']])('drops the non-mapping entry %j', (entry) => {
      const { resume, warnings } = read({ skills: [entry, { group: 'G', items: ['a'] }] });
      expect(resume.skills).toEqual([{ group: 'G', items: ['a'] }]);
      expect(warnings).toEqual(['skills[0]: expected a mapping; entry ignored']);
    });

    it('warns about unknown keys at every level and still reads the entry', () => {
      const { resume, warnings } = read({
        extra: 1,
        contact: { phone: '1' },
        experience: [{ ...role, salary: 'x' }],
        education: [{ ...education, gpa: '4' }],
        skills: [{ group: 'G', items: ['a'], level: 1 }],
        languages: [{ name: 'L', native: 'yes' }],
        publications: [{ title: 'T', venue: 'V', year: '2020', doi: 'x' }],
      });
      expect(warnings).toEqual([
        'unknown key "extra"; ignored',
        'contact: unknown key "phone"; ignored',
        'experience[0]: unknown key "salary"; ignored',
        'education[0]: unknown key "gpa"; ignored',
        'skills[0]: unknown key "level"; ignored',
        'languages[0]: unknown key "native"; ignored',
        'publications[0]: unknown key "doi"; ignored',
      ]);
      expect(resume.experience).toHaveLength(1);
      expect(resume.publications).toHaveLength(1);
    });

    it.each([
      ['experience', { org: 'O', start: '2020-01', end: '2020-02' }, 'a role and an org'],
      ['experience', { role: 'R', start: '2020-01', end: '2020-02' }, 'a role and an org'],
      [
        'education',
        { degree: 'D', start: '2010-01', end: '2011-01' },
        'a degree and an institution',
      ],
      ['skills', { group: 'G', items: [] }, 'a group and at least one item'],
      ['skills', { items: ['a'] }, 'a group and at least one item'],
      ['languages', { level: 'x' }, 'a name'],
      [
        'publications',
        { title: 'T', venue: 'V', year: '99' },
        'a title, a venue and a four-digit year',
      ],
      [
        'publications',
        { title: 'T', venue: 'V', year: '20201' },
        'a title, a venue and a four-digit year',
      ],
      [
        'publications',
        { title: 'T', venue: 'V', year: '20x1' },
        'a title, a venue and a four-digit year',
      ],
      ['publications', { title: 'T', year: '2020' }, 'a title, a venue and a four-digit year'],
    ])('drops a %s entry %j that lacks required fields', (key, entry, needs) => {
      const { warnings, resume } = read({ [key]: [entry] });
      expect(warnings).toEqual([`${key}[0]: needs ${needs}; entry ignored`]);
      expect(Reflect.get(resume, key)).toEqual([]);
    });

    it('drops non-text highlights and items one by one, and a highlights field that is no list', () => {
      const { resume, warnings } = read({
        experience: [
          { ...role, highlights: ['ok', { a: 1 }, '', 'also ok'] },
          { ...role, highlights: 'just text' },
        ],
        skills: [{ group: 'G', items: ['a', ['b'], 'c'] }],
      });
      expect(resume.experience.map((r) => r.highlights)).toEqual([['ok', 'also ok'], []]);
      expect(resume.skills[0]?.items).toEqual(['a', 'c']);
      expect(warnings).toEqual([
        'experience[0].highlights: ignoring non-text entry {"a":1}',
        'experience[1].highlights: expected a list; ignored',
        'skills[0].items: ignoring non-text entry ["b"]',
      ]);
    });

    it('keeps the good entries around a bad one, in order', () => {
      const { resume } = read({
        experience: [{ ...role, role: 'First' }, { role: 'Broken' }, { ...role, role: 'Last' }],
      });
      expect(resume.experience.map((r) => r.role)).toEqual(['First', 'Last']);
    });
  });

  describe('links and addresses', () => {
    it('drops a link with an unsafe or missing URL and keeps the others', () => {
      const { resume, warnings } = read({
        contact: {
          links: [
            { label: 'Bad', url: 'javascript:alert(1)' },
            { label: 'No url' },
            { label: 'Good', url: 'http://example.com' },
          ],
        },
        publications: [{ title: 'T', venue: 'V', year: '2020', url: 'data:text/html,x' }],
      });
      expect(resume.contact.links).toEqual([{ label: 'Good', url: 'http://example.com/' }]);
      expect(resume.publications).toEqual([{ title: 'T', venue: 'V', year: '2020' }]);
      expect(warnings).toEqual([
        'contact.links[0]: needs a label and an http(s) url; entry ignored',
        'contact.links[1]: needs a label and an http(s) url; entry ignored',
        'publications[0]: url is not an http(s) URL; ignored',
      ]);
    });

    it('warns about links that are no list', () => {
      expect(read({ contact: { links: 'x' } }).warnings).toEqual([
        'contact.links: expected a list of { label, url }; ignored',
      ]);
    });

    it.each(['no-at-sign', 'a@b', 'a b@c.de', '<a@b.cd>', 'a@b.c d', '"a"@b.cd'])(
      'drops the email %j',
      (email) => {
        const { resume, warnings } = read({ contact: { email } });
        expect(resume.contact).not.toHaveProperty('email');
        expect(warnings).toEqual([
          `contact.email: not an email address ${JSON.stringify(email)}; ignored`,
        ]);
      },
    );

    it('warns about a contact that is no mapping', () => {
      const { resume, warnings } = read({ contact: ['a'] });
      expect(resume.contact).toEqual({ links: [] });
      expect(warnings).toEqual(['contact: expected a mapping; ignored']);
    });
  });
});

describe('null words', () => {
  it.each(['~', 'null', ' ~ ', ' null '])('treats %j as absent in every text field', (word) => {
    const { resume, warnings } = read({
      headline: word,
      contact: { location: word, email: word },
      experience: [{ ...role, location: word }],
      education: [{ ...education, note: word }],
      languages: [{ name: 'English', level: word }],
    });
    expect(resume.headline).toBeUndefined();
    expect(resume.contact).toEqual({ links: [] });
    expect(resume.experience[0]).not.toHaveProperty('location');
    expect(resume.education[0]).not.toHaveProperty('note');
    expect(resume.languages[0]).toEqual({ name: 'English' });
    expect(warnings).toEqual([]);
  });

  it('drops an entry whose required text is a null word', () => {
    const { resume, warnings } = read({
      experience: [
        { ...role, role: '~' },
        { ...role, org: 'null' },
      ],
      education: [{ ...education, degree: '~' }],
      skills: [{ group: 'null', items: ['a'] }],
      publications: [
        { title: 'T', venue: '~', year: '2020' },
        { title: 'T', venue: 'V', year: '~' },
      ],
    });
    expect(resume.experience).toEqual([]);
    expect(resume.education).toEqual([]);
    expect(resume.skills).toEqual([]);
    expect(resume.publications).toEqual([]);
    expect(warnings).toHaveLength(6);
  });

  it('warns about a null word in a list of text, and keeps the rest', () => {
    const { resume, warnings } = read({
      experience: [{ ...role, highlights: ['~', 'kept', 'null'] }],
      skills: [{ group: 'G', items: ['a', '~'] }],
    });
    expect(resume.experience[0]?.highlights).toEqual(['kept']);
    expect(resume.skills[0]?.items).toEqual(['a']);
    expect(warnings).toEqual([
      'experience[0].highlights: ignoring non-text entry "~"',
      'experience[0].highlights: ignoring non-text entry "null"',
      'skills[0].items: ignoring non-text entry "~"',
    ]);
  });

  it('reads a null word as no date', () => {
    const { warnings } = read({
      experience: [
        { ...role, start: '~' },
        { ...role, end: 'null' },
      ],
    });
    expect(warnings).toEqual([
      'experience[0]: start must be a month, YYYY-MM; entry ignored',
      'experience[1]: end must be a month, YYYY-MM, or "present"; entry ignored',
    ]);
  });

  it.each(['Null', 'nullable', 'null pointers', '~/bin', 'a~'])('keeps the text %j', (word) => {
    const { resume, warnings } = read({ headline: word, experience: [{ ...role, org: word }] });
    expect(resume.headline).toBe(word);
    expect(resume.experience[0]?.org).toBe(word);
    expect(warnings).toEqual([]);
  });
});

describe('positions that start in the future', () => {
  it.each([
    ['experience', role],
    ['teaching', role],
    ['education', education],
  ])('warns about %s starting after this month, and keeps the entry', (key, entry) => {
    const { resume, warnings } = read({
      [key]: [{ ...entry, start: '2026-07', end: 'present' }],
    });
    expect(warnings).toEqual([`${key}[0]: start 2026-07 is in the future`]);
    expect(Reflect.get(resume, key)).toHaveLength(1);
  });

  it('accepts a start in this month or before', () => {
    const { warnings } = read({
      experience: [
        { ...role, start: '2026-06', end: 'present' },
        { ...role, start: '2026-05', end: 'present' },
      ],
    });
    expect(warnings).toEqual([]);
  });

  it('follows the date it is given', () => {
    const data = { experience: [{ ...role, start: '2026-07', end: 'present' }] };
    expect(parseResume(data, new Date('2026-07-01T00:00:00Z')).warnings).toEqual([]);
    expect(parseResume(data, new Date('2026-06-30T23:59:59Z')).warnings).toHaveLength(1);
  });

  it('does not add a second warning to an entry that is dropped anyway', () => {
    const { warnings } = read({ experience: [{ ...role, start: '2030-01', end: '2020-01' }] });
    expect(warnings).toEqual(['experience[0]: end 2020-01 is before start 2030-01; entry ignored']);
  });
});

describe('email addresses', () => {
  it.each([
    'a@b.cd?bcc=x@y.zz',
    'a@b.cd?subject=hi',
    'a@b.cd&cc=x@y.zz',
    'a@b.cd,c@d.ee',
    'a@b.cd;c@d.ee',
    'a?b@c.de',
    'a&b@c.de',
    'a@b?c.de',
  ])('rejects %j: it could add headers or recipients to a mailto: link', (email) => {
    const { resume, warnings } = read({ contact: { email } });
    expect(resume.contact).not.toHaveProperty('email');
    expect(warnings).toHaveLength(1);
  });

  it.each(['me@example.com', 'first.last+tag@sub.example.org', "o'neil@example.ie"])(
    'accepts %j',
    (email) => {
      expect(read({ contact: { email } }).resume.contact.email).toBe(email);
    },
  );
});

describe('resumeText', () => {
  const full: Resume = {
    headline: 'Embedded engineer',
    contact: {
      location: 'Berlin',
      email: 'me@example.com',
      links: [{ label: 'Code', url: 'https://example.com/me' }],
    },
    experience: [
      { ...role, highlights: ['Cut **latency**', 'Plain'] },
      { role: 'Dev', org: 'Old Co', start: '2015-01', end: '2019-12', highlights: [] },
    ],
    education: [
      education,
      { degree: 'BSc', institution: 'College', start: '2008-10', end: '2012-06' },
    ],
    skills: [{ group: 'Languages', items: ['C', 'Rust'] }],
    languages: [{ name: 'English', level: 'fluent' }, { name: 'Polish' }],
    publications: [{ title: 'Paper', venue: 'Conf', year: '2019', url: 'https://example.com/p' }],
    teaching: [
      {
        role: 'Lecturer',
        org: 'Uni',
        start: '2016-10',
        end: '2018-06',
        highlights: ['Did *things*'],
      },
    ],
  };

  it('lists the words of every part, in reading order, without dates and URLs', () => {
    expect(resumeText(full)).toBe(
      [
        'Embedded engineer Berlin Code',
        'Engineer Acme Berlin Cut **latency** Plain',
        'Dev Old Co',
        'MSc Uni Thesis BSc College',
        'Lecturer Uni Did *things*',
        'Paper Conf',
        'Languages C Rust',
        'English fluent Polish',
      ].join(' '),
    );
  });

  it('is empty for a resume without data', () => {
    const bare: Resume = {
      contact: { links: [] },
      experience: [],
      education: [],
      skills: [],
      languages: [],
      publications: [],
      teaching: [],
    };
    expect(resumeText(bare)).toBe('');
  });

  it('collapses whitespace inside entries', () => {
    const odd: Resume = {
      ...full,
      headline: '  a \n b ',
      experience: [],
      education: [],
      teaching: [],
    };
    expect(resumeText(odd).startsWith('a b Berlin')).toBe(true);
  });
});
