import { describe, expect, it } from 'vitest';

import {
  auditProfileRecord,
  candidateOfficialProfileUrls,
  candidateProfileFactsMatchUser,
  classifyStoredBioIssue,
  classifyStoredTitleIssue,
  compareOfficialProfileFacts,
  extractOfficialProfileFactsFromHtml,
  parseProfileDataQualityAuditArgs,
  profileUrlMismatchIssue,
  reconcileLiveProfileUrlMismatchFinding,
  reconcileMissingOfficialProfileFinding,
  reconcileProfileUrlMismatchFinding,
  reconcileWrongPersonFindingsForFacts,
  weakAffiliationSummaryIssue,
} from '../profileDataQualityAudit';

describe('profileDataQualityAudit helpers', () => {
  it('generates likely official profile URLs from name and school signals', () => {
    expect(
      candidateOfficialProfileUrls({
        fname: 'Morgan',
        lname: 'Vector',
        title: 'Professor of Epidemiology',
        primaryDepartment: 'Epidemiology',
      }),
    ).toEqual([
      'https://ysph.yale.edu/profile/morgan-vector/',
      'https://ysph.yale.edu/profile/morgan-vector-1/',
      'https://ysph.yale.edu/profile/morgan-vector2/',
      'https://ysph.yale.edu/profile/m-vector/',
      'https://medicine.yale.edu/profile/morgan-vector/',
      'https://medicine.yale.edu/profile/morgan-vector-1/',
      'https://medicine.yale.edu/profile/morgan-vector2/',
      'https://medicine.yale.edu/profile/m-vector/',
    ]);
  });

  it('includes email-local and netid profile URL variants for live missing-profile verification', () => {
    expect(
      candidateOfficialProfileUrls({
        netid: 'mv123',
        fname: 'Morgan',
        lname: 'Vector',
        email: 'morgan.river-vector@yale.edu',
        title: 'Assistant Professor of Medicine',
      }),
    ).toEqual([
      'https://medicine.yale.edu/profile/morgan-vector/',
      'https://medicine.yale.edu/profile/morgan-vector-1/',
      'https://medicine.yale.edu/profile/morgan-vector2/',
      'https://medicine.yale.edu/profile/m-vector/',
      'https://medicine.yale.edu/profile/morgan-river-vector/',
      'https://medicine.yale.edu/profile/mv123/',
    ]);
  });

  it('includes numeric exact-name profile URL variants from official Yale profile sitemap patterns', () => {
    const urls = candidateOfficialProfileUrls({
      netid: 'pv123',
      fname: 'Parker',
      lname: 'Vector',
      email: 'parker.vector@yale.edu',
      title: 'Assistant Professor of Public Health',
      primaryDepartment: 'Health Policy',
    });

    expect(urls).toContain('https://ysph.yale.edu/profile/parker-vector-1/');
    expect(urls).toContain('https://ysph.yale.edu/profile/parker-vector2/');
    expect(urls).toContain('https://medicine.yale.edu/profile/parker-vector-1/');
    expect(urls).toContain('https://medicine.yale.edu/profile/parker-vector2/');
  });

  it('includes compact first-initial surname-particle profile URL variants', () => {
    expect(
      candidateOfficialProfileUrls({
        netid: 'mo123',
        fname: 'Morgan',
        lname: "O'Vector",
        email: 'mo123@yale.edu',
        title: 'Clinical Instructor in Pediatrics',
      }),
    ).toEqual([
      'https://medicine.yale.edu/profile/morgan-o-vector/',
      'https://medicine.yale.edu/profile/morgan-o-vector-1/',
      'https://medicine.yale.edu/profile/morgan-o-vector2/',
      'https://medicine.yale.edu/profile/m-o-vector/',
      'https://medicine.yale.edu/profile/movector/',
      'https://medicine.yale.edu/profile/mo123/',
    ]);
  });

  it('detects stored bios that are title-only or website/address chrome', () => {
    expect(
      classifyStoredBioIssue({
        bio: 'Associate Professor of Psychiatry',
        title: 'Associate Professor of Psychiatry',
      }),
    ).toBe('title-only');
    expect(classifyStoredBioIssue({ bio: "Lu Lu's website\n\nKline Tower Room 106" })).toBe(
      'website-or-address-chrome',
    );
    expect(
      classifyStoredBioIssue({
        bio:
          'Morgan Vector is the founding director of the Example Modeling Center and studies disease modeling at Yale.',
      }),
    ).toBe('');
    expect(
      classifyStoredBioIssue({
        bio:
          "Morgan Vector's official Yale profile lists research interests in Data Systems, Public Health, and Example Methods, based on Yale's official profile data.",
        title: 'Associate Professor of Example Methods',
      }),
    ).toBe('research-interest-summary');
  });

  it('reports generated research-interest summaries as non-biographical bios', () => {
    const findings = auditProfileRecord({
      user: {
        netid: 'mv123',
        fname: 'Morgan',
        lname: 'Vector',
        title: 'Associate Professor of Example Methods',
        bio:
          "Morgan Vector's official Yale profile lists research interests in Data Systems, Public Health, and Example Methods, based on Yale's official profile data.",
      },
      publicProfile: { netid: 'mv123', fname: 'Morgan', lname: 'Vector' },
    });

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          issue: 'bio-not-personal-bio',
          detail: 'research-interest-summary',
        }),
      ]),
    );
  });

  it('detects stored titles that are navigation, contact, or directory-label chrome', () => {
    expect(
      classifyStoredTitleIssue({
        title: 'Home About Research Academics People Media Events Outreach Opportunities',
      }),
    ).toBe('navigation-chrome');
    expect(
      classifyStoredTitleIssue({
        title:
          'Professor of Example Studies 217 Prospect St, New Haven, CT 06511 +1 (475) 200-0000 morgan.vector@yale.edu',
      }),
    ).toBe('contact-or-address-chrome');
    expect(classifyStoredTitleIssue({ title: 'Research / Faculty' })).toBe(
      'generic-directory-label',
    );
    expect(classifyStoredTitleIssue({ title: 'Associate Professor of Example Methods' })).toBe(
      '',
    );
  });

  it('reports stored title chrome as its own audit finding', () => {
    const findings = auditProfileRecord({
      user: {
        netid: 'mv123',
        fname: 'Morgan',
        lname: 'Vector',
        title: 'Research / Faculty',
        bio: '',
      },
      publicProfile: { netid: 'mv123', fname: 'Morgan', lname: 'Vector' },
    });

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          issue: 'title-chrome-or-directory-label',
          detail: 'generic-directory-label',
        }),
      ]),
    );
  });

  it('does not flag substantial biographies just because they mention a website', () => {
    expect(
      classifyStoredBioIssue({
        bio:
          'Personal Website Morgan Vector is a computational social scientist who studies housing, education, and public policy. Their current research combines administrative records, causal inference, and field experiments to measure how public systems shape opportunity.',
      }),
    ).toBe('');
  });

  it('does not flag substantial career biographies just because they end with footer chrome', () => {
    expect(
      classifyStoredBioIssue({
        bio:
          'Riley North is a visiting lecturer who practiced law for many years and represented professional service organizations in complex disputes. North has written and spoken widely on professional ethics, risk management, and legal education, and has served on national advisory boards. Contact Webmaster Web Accessibility Privacy Policy.',
      }),
    ).toBe('');
  });

  it('does not flag substantial clinical biographies just because they include Yale Medicine footer chrome', () => {
    expect(
      classifyStoredBioIssue({
        bio:
          'Casey Meridian treats patients with complex hand and shoulder conditions and develops individualized treatment plans. Meridian uses minimally invasive surgical approaches when possible, collaborates across clinical specialties, and studies ways to improve recovery after injury. Clinical Specialties Hand Surgery Learn More on Yale Medicine See All.',
      }),
    ).toBe('');
  });

  it('keeps flagging website/address chrome when there is no substantial biography', () => {
    expect(
      classifyStoredBioIssue({
        bio: 'Personal Website\nLab Website\nKline Tower Room 106',
      }),
    ).toBe('website-or-address-chrome');
  });

  it('extracts official profile name and title facts from JSON-LD', () => {
    const facts = extractOfficialProfileFactsFromHtml(
      `
      <html>
        <head><title>Morgan Vector | Yale School of Public Health</title></head>
        <body>
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "ProfilePage",
              "mainEntity": {
                "@type": "Person",
                "name": "Morgan Vector",
                "jobTitle": "Associate Professor of Epidemiology"
              }
            }
          </script>
        </body>
      </html>
      `,
      'https://ysph.yale.edu/profile/morgan-vector/',
    );

    expect(facts).toEqual({
      url: 'https://ysph.yale.edu/profile/morgan-vector/',
      name: 'Morgan Vector',
      title: 'Associate Professor of Epidemiology',
      email: '',
    });
  });

  it('uses a fuller page-title name when JSON-LD omits the stored first name', () => {
    const facts = extractOfficialProfileFactsFromHtml(
      `
      <html>
        <head><title>Avery Morgan Vector, MD | Yale School of Medicine</title></head>
        <body>
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "ProfilePage",
              "mainEntity": {
                "@type": "Person",
                "name": "Morgan Vector",
                "jobTitle": "Assistant Professor of Medicine"
              }
            }
          </script>
        </body>
      </html>
      `,
      'https://medicine.yale.edu/profile/morgan-vector/',
    );

    expect(facts).toEqual({
      url: 'https://medicine.yale.edu/profile/morgan-vector/',
      name: 'Avery Morgan Vector',
      title: 'Assistant Professor of Medicine',
      email: '',
    });
    expect(
      reconcileMissingOfficialProfileFinding(
        {
          netid: 'av123',
          fname: 'Avery',
          lname: 'Vector',
          email: 'avery.vector@yale.edu',
          title: 'Assistant Professor',
        },
        {
          issue: 'missing-official-profile-url',
          netid: 'av123',
          name: 'Avery Vector',
          candidateUrls: ['https://medicine.yale.edu/profile/avery-vector/'],
        },
        [facts],
      ),
    ).toBeNull();
  });

  it('flags official profile facts that disagree with stored name or title', () => {
    expect(
      compareOfficialProfileFacts(
        {
          netid: 'mv123',
          fname: 'Morgan',
          lname: 'Vector',
          email: 'morgan.vector@yale.edu',
          title: 'Assistant Professor of Epidemiology',
        },
        {
          url: 'https://ysph.yale.edu/profile/morgan-vector/',
          name: 'Morgan Vector',
          title: 'Associate Professor of Epidemiology',
          email: 'morgan.vector@yale.edu',
        },
      ),
    ).toMatchObject({
      issue: 'official-profile-name-or-title-mismatch',
      detail: 'title-rank-mismatch',
    });

    expect(
      compareOfficialProfileFacts(
        {
          netid: 'mv123',
          fname: 'Morgan',
          lname: 'Vector',
          email: 'morgan.vector@yale.edu',
          title: 'Associate Professor of Epidemiology',
        },
        {
          url: 'https://ysph.yale.edu/profile/morgan-vector/',
          name: 'Morgan Vector',
          title: 'Associate Professor of Epidemiology',
          email: 'morgan.vector@yale.edu',
        },
      ),
    ).toBeNull();
  });

  it('accepts official profile facts when the official page email exactly matches the stored user', () => {
    expect(
      compareOfficialProfileFacts(
        {
          netid: 'jc123',
          fname: 'Jocelyn',
          lname: 'Carter',
          email: 'jane.carter@example.invalid',
          title: 'Research Affiliate',
        },
        {
          url: 'https://example.test/profile/jane-carter/',
          name: 'Jane Carter',
          title: '',
          email: 'jane.carter@example.invalid',
        },
      ),
    ).toBeNull();
  });

  it('accepts official profile facts when public Yale email aliases identify the stored user', () => {
    const user = {
      netid: 'mn123',
      fname: 'Morgan',
      lname: 'North',
      email: 'mn123@yale.edu',
      title: 'Clinical Instructor',
    };
    const facts = {
      url: 'https://medicine.yale.edu/profile/mn123/',
      name: 'Morgan Sunny',
      title: 'Clinical Instructor',
      email: 'morgan.north@yale.edu',
    };

    expect(candidateProfileFactsMatchUser(user, facts)).toBe(true);
    expect(compareOfficialProfileFacts(user, facts)).toBeNull();
  });

  it('accepts official names that reorder compound stored name tokens with an initial', () => {
    expect(
      compareOfficialProfileFacts(
        {
          netid: 'av123',
          fname: 'Avery Stone',
          lname: 'Garden',
          email: 'avery.stonegarden@yale.edu',
          title: 'Assistant Professor of Radiology and Biomedical Imaging',
        },
        {
          url: 'https://medicine.yale.edu/profile/avery-garden/',
          name: 'Avery G. Stone',
          title: '',
          email: '',
        },
      ),
    ).toBeNull();
  });

  it('accepts official names that expand stored initials when email supports the formal name', () => {
    expect(
      compareOfficialProfileFacts(
        {
          netid: 'rq123',
          fname: 'RQ',
          lname: 'Vector',
          email: 'river.vector@example.invalid',
          title: 'Research Assistant',
        },
        {
          url: 'https://example.test/profile/river-vector/',
          name: 'River Vector',
          title: '',
          email: '',
        },
      ),
    ).toBeNull();
  });

  it('accepts official names that use a formal first name when email supports a known preferred name', () => {
    expect(
      compareOfficialProfileFacts(
        {
          netid: 'lv123',
          fname: 'Lex',
          lname: 'Vector',
          email: 'lex@example.invalid',
          title: 'Research Affiliate',
        },
        {
          url: 'https://example.test/profile/alexander-vector/',
          name: 'Alexander Vector',
          title: '',
          email: '',
        },
      ),
    ).toBeNull();
  });

  it('accepts official names that use a preferred first name when email supports the stored formal name', () => {
    expect(
      compareOfficialProfileFacts(
        {
          netid: 'rv123',
          fname: 'River',
          lname: 'Vector',
          email: 'river.vector@example.invalid',
          title: 'Assistant Professor',
        },
        {
          url: 'https://example.test/profile/river-vector/',
          name: 'Riv Vector',
          title: '',
          email: '',
        },
      ),
    ).toBeNull();

    expect(
      compareOfficialProfileFacts(
        {
          netid: 'dv123',
          fname: 'Dmitry',
          lname: 'Vector',
          email: 'dmitry.vector@example.invalid',
          title: 'Assistant Professor Adjunct',
        },
        {
          url: 'https://example.test/profile/dmitry-vector/',
          name: 'Dima Vector',
          title: '',
          email: '',
        },
      ),
    ).toBeNull();
  });

  it('accepts official names that use another common preferred first name for a stored formal name', () => {
    expect(
      compareOfficialProfileFacts(
        {
          netid: 'ls123',
          fname: 'Lawrence',
          lname: 'Stone',
          email: 'lawrence.stone@example.invalid',
          title: 'Professor Emeritus of Example Studies',
        },
        {
          url: 'https://example.test/profile/lawrence-stone/',
          name: 'Larry Stone',
          title: '',
          email: '',
        },
      ),
    ).toBeNull();

    expect(
      compareOfficialProfileFacts(
        {
          netid: 'lv456',
          fname: 'Lucile',
          lname: 'Vector',
          email: 'lucile.vector@example.invalid',
          title: 'Assistant Clinical Professor of Example Studies',
        },
        {
          url: 'https://example.test/profile/lucile-vector/',
          name: 'Andrea Vector',
          title: 'Assistant Clinical Professor',
          email: '',
        },
      ),
    ).toBeNull();

    expect(
      compareOfficialProfileFacts(
        {
          netid: 'mv789',
          fname: 'Maisy',
          lname: 'Stone',
          email: 'maisy.stone@example.invalid',
          title: 'Clinical Fellow',
        },
        {
          url: 'https://example.test/profile/maisy-stone/',
          name: 'Meredith Stone',
          title: 'Clinical Fellow',
          email: '',
        },
      ),
    ).toBeNull();
  });

  it('accepts official names that shorten a compound stored last name', () => {
    expect(
      compareOfficialProfileFacts(
        {
          netid: 'av123',
          fname: 'Avery',
          lname: 'Stone River',
          email: 'avery.stoneriver@example.invalid',
          title: 'Professor of Finance and Professor Adjunct of Law',
        },
        {
          url: 'https://som.yale.edu/faculty-research/faculty-directory/avery-q-stone',
          name: 'Avery Q. Stone',
          title: 'Professor of Finance',
          email: '',
        },
      ),
    ).toBeNull();
  });

  it('does not flag profile URLs that shorten a compound stored last name to one substantive token', () => {
    expect(
      profileUrlMismatchIssue({
        netid: 'av123',
        fname: 'Avery Middle',
        lname: 'River Stone',
        title: 'Associate Research Scientist',
        profileUrls: {
          medicine: 'https://medicine.yale.edu/profile/avery-stone/',
        },
      }),
    ).toBeNull();

    expect(
      profileUrlMismatchIssue({
        netid: 'bv123',
        fname: 'Blake',
        lname: 'River Stone',
        title: 'Associate Research Scientist',
        profileUrls: {
          medicine: 'https://medicine.yale.edu/profile/avery-stone/',
        },
      }),
    ).toMatchObject({
      issue: 'wrong-person-profile-url',
    });
  });

  it('accepts official names that use a formal first name for a stored nickname', () => {
    expect(
      compareOfficialProfileFacts(
        {
          netid: 'dv123',
          fname: 'Debbie',
          lname: 'Vector',
          email: 'debbie.vector@yale.edu',
          title: 'Assistant Professor Adjunct',
        },
        {
          url: 'https://medicine.yale.edu/profile/deborah-vector/',
          name: 'Deborah Vector',
          title: '',
          email: '',
        },
      ),
    ).toBeNull();

    expect(
      compareOfficialProfileFacts(
        {
          netid: 'mv124',
          fname: 'Maggie',
          lname: 'Vector',
          email: 'maggie.vector@yale.edu',
          title: 'Assistant Professor Adjunct',
        },
        {
          url: 'https://medicine.yale.edu/profile/margaret-vector/',
          name: 'Margaret Vector',
          title: '',
          email: '',
        },
      ),
    ).toBeNull();

    expect(
      compareOfficialProfileFacts(
        {
          netid: 'hv123',
          fname: 'Klar',
          lname: 'Vector',
          email: 'klar.vector@yale.edu',
          title: 'Professor',
        },
        {
          url: 'https://medicine.yale.edu/profile/klar-vector/',
          name: 'Henry Vector',
          title: '',
          email: '',
        },
      ),
    ).toBeNull();

    expect(
      compareOfficialProfileFacts(
        {
          netid: 'hv124',
          fname: 'Harold',
          lname: 'Vector',
          email: 'harold.vector@yale.edu',
          title: 'Assistant Professor',
        },
        {
          url: 'https://medicine.yale.edu/profile/harold-vector/',
          name: 'Harry Vector',
          title: '',
          email: '',
        },
      ),
    ).toBeNull();

    expect(
      compareOfficialProfileFacts(
        {
          netid: 'mv125',
          fname: 'Maggie',
          lname: 'River',
          email: 'fixture125@yale.edu',
          title: 'Clinical Associate',
        },
        {
          url: 'https://medicine.yale.edu/profile/magdalena-river/',
          name: 'Magdalena River',
          title: '',
          email: '',
        },
      ),
    ).toBeNull();

    expect(
      compareOfficialProfileFacts(
        {
          netid: 'mv126',
          fname: 'Maddy',
          lname: 'Vector',
          email: 'maddy.vector@yale.edu',
          title: 'Postdoctoral Associate',
        },
        {
          url: 'https://medicine.yale.edu/profile/maddy-vector/',
          name: 'Madeleine Vector',
          title: '',
          email: '',
        },
      ),
    ).toBeNull();

    expect(
      compareOfficialProfileFacts(
        {
          netid: 'nv127',
          fname: 'Nova',
          lname: 'Vector',
          email: 'nova.vector@yale.edu',
          title: 'Postdoctoral Associate',
        },
        {
          url: 'https://medicine.yale.edu/profile/nova-vector/',
          name: 'Xavier Vector',
          title: '',
          email: '',
        },
      ),
    ).toBeNull();

    expect(
      compareOfficialProfileFacts(
        {
          netid: 'nv128',
          fname: 'Nova',
          lname: 'River',
          email: 'nova.fixture128@example.invalid',
          title: 'Postdoctoral Associate',
        },
        {
          url: 'https://medicine.yale.edu/profile/nova-river/',
          name: 'Xavier River',
          title: '',
          email: '',
        },
      ),
    ).toBeNull();
  });

  it('accepts live candidate profile facts only when they identify the stored user', () => {
    const user = {
      netid: 'mv123',
      fname: 'Morgan',
      lname: 'Vector',
      email: 'morgan.vector@yale.edu',
    };

    expect(
      candidateProfileFactsMatchUser(user, {
        url: 'https://ysph.yale.edu/profile/morgan-vector/',
        name: 'Morgan Vector',
        title: 'Professor of Epidemiology',
        email: '',
      }),
    ).toBe(true);
    expect(
      candidateProfileFactsMatchUser(user, {
        url: 'https://ysph.yale.edu/profile/mv123/',
        name: 'M. Vector',
        title: 'Professor of Epidemiology',
        email: 'morgan.vector@yale.edu',
      }),
    ).toBe(true);
    expect(
      candidateProfileFactsMatchUser(user, {
        url: 'https://ysph.yale.edu/profile/riley-vector/',
        name: 'Riley Vector',
        title: 'Professor of Epidemiology',
        email: 'riley.vector@yale.edu',
      }),
    ).toBe(false);
  });

  it('does not let a matching candidate URL slug override a different official given name', () => {
    const user = {
      netid: 'ev123',
      fname: 'Evelyn',
      lname: 'Vector',
      email: 'fixture123@yale.edu',
    };

    expect(
      candidateProfileFactsMatchUser(user, {
        url: 'https://medicine.yale.edu/profile/evelyn-vector/',
        name: 'Avery Vector',
        title: 'Assistant Professor of Medicine',
        email: '',
      }),
    ).toBe(false);

    expect(
      compareOfficialProfileFacts(user, {
        url: 'https://medicine.yale.edu/profile/evelyn-vector/',
        name: 'Avery Vector',
        title: 'Assistant Professor of Medicine',
        email: '',
      }),
    ).toMatchObject({
      issue: 'official-profile-name-or-title-mismatch',
      officialName: 'Avery Vector',
    });
  });

  it('flags official profile URLs whose readable slug does not match the person', () => {
    expect(
      profileUrlMismatchIssue({
        fname: 'Riley',
        lname: 'North',
        profileUrls: { medicine: 'https://medicine.yale.edu/profile/rowan-north/' },
      }),
    ).toMatchObject({
      issue: 'wrong-person-profile-url',
      url: 'https://medicine.yale.edu/profile/rowan-north/',
    });
    expect(
      profileUrlMismatchIssue({
        fname: 'Morgan',
        lname: 'Vector',
        profileUrls: { physics: 'https://physics.yale.edu/people/morgan-vector' },
      }),
    ).toBeNull();
    expect(
      profileUrlMismatchIssue({
        netid: 'mv123',
        fname: 'Morgan',
        lname: 'Vector',
        profileUrls: { music: 'https://music.yale.edu/people/vector' },
      }),
    ).toBeNull();
    expect(
      profileUrlMismatchIssue({
        netid: 'mv123',
        fname: 'Morgan',
        lname: 'Vector',
        profileUrls: { medicine: 'https://medicine.yale.edu/profile/MV123/' },
      }),
    ).toBeNull();
  });

  it('accepts alternate official profile slugs derived from the stored email local-part', () => {
    expect(
      profileUrlMismatchIssue({
        netid: 'av123',
        fname: 'Avery',
        lname: 'Stone',
        email: 'avery.river-garden@yale.edu',
        profileUrls: { medicine: 'https://medicine.yale.edu/profile/avery-river-garden/' },
      }),
    ).toBeNull();

    expect(
      profileUrlMismatchIssue({
        netid: 'bv123',
        fname: 'Blake',
        lname: 'Stone',
        email: 'blake123.stone@yale.edu',
        profileUrls: { medicine: 'https://medicine.yale.edu/profile/avery-river-garden/' },
      }),
    ).toMatchObject({
      issue: 'wrong-person-profile-url',
    });
  });

  it('accepts common nickname slugs for formal stored first names', () => {
    expect(
      profileUrlMismatchIssue({
        netid: 'ws123',
        fname: 'William',
        lname: 'Stone',
        profileUrls: { medicine: 'https://medicine.yale.edu/profile/bill-stone/' },
      }),
    ).toBeNull();
  });

  it('accepts compact initial-plus-surname official profile slugs', () => {
    expect(
      profileUrlMismatchIssue({
        netid: 'gp123',
        fname: 'Gray',
        lname: 'Post',
        profileUrls: { medicine: 'https://medicine.yale.edu/profile/gpost7/' },
      }),
    ).toBeNull();

    expect(
      profileUrlMismatchIssue({
        netid: 'rn123',
        fname: 'Riley',
        lname: 'North',
        profileUrls: { medicine: 'https://medicine.yale.edu/profile/rowan-north/' },
      }),
    ).toMatchObject({
      issue: 'wrong-person-profile-url',
    });
  });

  it('accepts compact official slugs with a minor extra character when live facts identify the user', () => {
    const user = {
      netid: 'sv123',
      fname: 'Sera',
      lname: 'Wellbrook',
      email: 'sera.wellbrook@example.edu',
      title: 'Assistant Clinical Professor',
    };
    const finding = profileUrlMismatchIssue({
      ...user,
      profileUrls: { medicine: 'https://medicine.yale.edu/profile/serawelllbrook/' },
    });

    expect(finding).toMatchObject({ issue: 'wrong-person-profile-url' });
    expect(
      reconcileProfileUrlMismatchFinding(user, finding!, {
        url: 'https://medicine.yale.edu/profile/serawelllbrook/',
        name: 'Sera Wellbrook',
        title: 'Assistant Clinical Professor',
        email: 'sera.wellbrook@example.edu',
      }),
    ).toBeNull();
  });

  it('reconciles wrong-person findings when a stored typo slug redirects to matching official facts', () => {
    const user = {
      netid: 'sv123',
      fname: 'Sera',
      lname: 'Wellbrook',
      email: 'sera.wellbrook@example.edu',
      title: 'Assistant Clinical Professor',
    };
    const finding = profileUrlMismatchIssue({
      ...user,
      profileUrls: { medicine: 'https://medicine.yale.edu/profile/serawelllbrook/' },
    });

    expect(finding).toMatchObject({ issue: 'wrong-person-profile-url' });
    expect(
      reconcileWrongPersonFindingsForFacts([finding!], user, {
        url: 'https://medicine.yale.edu/profile/sera-wellbrook/',
        name: 'Sera Wellbrook',
        title: 'Assistant Clinical Professor',
        email: 'sera.wellbrook@example.edu',
      }),
    ).toEqual([]);
  });

  it('does not report a missing official profile when a Yale netid profile URL is stored', () => {
    const findings = auditProfileRecord({
      user: {
        netid: 'mv123',
        fname: 'Morgan',
        lname: 'Vector',
        title: 'Professor of Epidemiology',
        primaryDepartment: 'Epidemiology',
        profileUrls: { medicine: 'https://medicine.yale.edu/profile/MV123/' },
      },
      publicProfile: { netid: 'mv123', fname: 'Morgan', lname: 'Vector' },
    });

    expect(findings.find((finding) => finding.issue === 'missing-official-profile-url')).toBeUndefined();
  });

  it('does not report a missing official profile when a safe public website fallback is available', () => {
    const findings = auditProfileRecord({
      user: {
        netid: 'mf124',
        fname: 'Morgan',
        lname: 'Faculty',
        title: 'Assistant Professor of Medicine',
        primaryDepartment: 'Medicine',
        website: 'https://morgan-faculty.example.test/',
      },
      publicProfile: {
        netid: 'mf124',
        fname: 'Morgan',
        lname: 'Faculty',
        website: 'https://morgan-faculty.example.test/',
      },
    });

    expect(findings.find((finding) => finding.issue === 'missing-official-profile-url')).toBeUndefined();
  });

  it('still reports a missing official profile when the fallback website is not public-safe', () => {
    const findings = auditProfileRecord({
      user: {
        netid: 'mf125',
        fname: 'Morgan',
        lname: 'Faculty',
        title: 'Assistant Professor of Medicine',
        primaryDepartment: 'Medicine',
        website: 'javascript:alert(1)',
      },
      publicProfile: {
        netid: 'mf125',
        fname: 'Morgan',
        lname: 'Faculty',
        website: '',
      },
    });

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          issue: 'missing-official-profile-url',
        }),
      ]),
    );
  });

  it('does not expose internal profile fallback paths in missing-profile findings', () => {
    const findings = auditProfileRecord({
      user: {
        netid: 'mf126',
        fname: 'Morgan',
        lname: 'Faculty',
        title: 'Assistant Professor of Medicine',
        primaryDepartment: 'Medicine',
      },
      publicProfile: {
        netid: 'mf126',
        fname: 'Morgan',
        lname: 'Faculty',
        website: '',
      },
    });

    const finding = findings.find((row) => row.issue === 'missing-official-profile-url');
    expect(finding).toBeDefined();
    expect(finding).not.toHaveProperty('internalProfilePath');
  });

  it('requires a faculty-like title before flagging missing generated official profile candidates', () => {
    const emptyTitleFindings = auditProfileRecord({
      user: {
        netid: 'av123',
        fname: 'Avery',
        lname: 'Vector',
        title: '',
        primaryDepartment: 'Radiology and Biomedical Imaging',
      },
      publicProfile: { netid: 'av123', fname: 'Avery', lname: 'Vector' },
    });
    const staffTitleFindings = auditProfileRecord({
      user: {
        netid: 'rs123',
        fname: 'Riley',
        lname: 'Signal',
        title: 'Research Support Specialist Yale School of Medicine Support Services',
        primaryDepartment: 'Medicine',
      },
      publicProfile: { netid: 'rs123', fname: 'Riley', lname: 'Signal' },
    });
    const postdocTitleFindings = auditProfileRecord({
      user: {
        netid: 'td123',
        fname: 'Taylor',
        lname: 'Delta',
        title: 'Postdoctoral Associate',
        primaryDepartment: 'Medicine',
      },
      publicProfile: { netid: 'td123', fname: 'Taylor', lname: 'Delta' },
    });
    const visitingTitleFindings = auditProfileRecord({
      user: {
        netid: 'vf123',
        fname: 'Val',
        lname: 'Field',
        title: 'Visiting Fellow',
        primaryDepartment: 'School of Public Health',
      },
      publicProfile: { netid: 'vf123', fname: 'Val', lname: 'Field' },
    });
    const recruitingTitleFindings = auditProfileRecord({
      user: {
        netid: 'rp123',
        fname: 'Rowan',
        lname: 'Pilot',
        title: 'Medical School Recruit - Associate Professor',
        primaryDepartment: 'Medicine',
      },
      publicProfile: { netid: 'rp123', fname: 'Rowan', lname: 'Pilot' },
    });
    const facultyTitleFindings = auditProfileRecord({
      user: {
        netid: 'mf123',
        fname: 'Morgan',
        lname: 'Faculty',
        title: 'Assistant Professor of Medicine',
        primaryDepartment: 'Medicine',
      },
      publicProfile: { netid: 'mf123', fname: 'Morgan', lname: 'Faculty' },
    });

    expect(
      emptyTitleFindings.find((finding) => finding.issue === 'missing-official-profile-url'),
    ).toBeUndefined();
    expect(
      staffTitleFindings.find((finding) => finding.issue === 'missing-official-profile-url'),
    ).toBeUndefined();
    expect(
      postdocTitleFindings.find((finding) => finding.issue === 'missing-official-profile-url'),
    ).toBeUndefined();
    expect(
      visitingTitleFindings.find((finding) => finding.issue === 'missing-official-profile-url'),
    ).toBeUndefined();
    expect(
      recruitingTitleFindings.find((finding) => finding.issue === 'missing-official-profile-url'),
    ).toBeUndefined();
    expect(facultyTitleFindings).toEqual(
      expect.arrayContaining([expect.objectContaining({ issue: 'missing-official-profile-url' })]),
    );
  });

  it('matches official preferred first names when the stored Yale email supports the official name', () => {
    expect(
      candidateProfileFactsMatchUser(
        {
          netid: 'yv123',
          fname: 'Yardley',
          lname: 'Vector',
          email: 'yara.vector@yale.edu',
        },
        {
          url: 'https://medicine.yale.edu/profile/yara-vector/',
          name: 'Yara Vector',
          title: 'Assistant Professor',
          email: '',
        },
      ),
    ).toBe(true);
  });

  it('still reports a missing official profile when the only stored Yale profile belongs to another person', () => {
    const findings = auditProfileRecord({
      user: {
        netid: 'mv123',
        fname: 'Morgan',
        lname: 'Vector',
        title: 'Professor of Epidemiology',
        primaryDepartment: 'Epidemiology',
        profileUrls: { medicine: 'https://medicine.yale.edu/profile/riley-vector/' },
      },
      publicProfile: { netid: 'mv123', fname: 'Morgan', lname: 'Vector' },
    });

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ issue: 'missing-official-profile-url' }),
        expect.objectContaining({ issue: 'profile-url-slug-mismatch' }),
      ]),
    );
  });

  it('clears a wrong-person URL finding when live profile facts identify the stored person', () => {
    const user = {
      netid: 'mv123',
      fname: 'Morgan',
      lname: 'Vector',
      email: 'morgan.vector@yale.edu',
      title: 'Professor of Epidemiology',
    };
    const finding = profileUrlMismatchIssue({
      ...user,
      profileUrls: { medicine: 'https://medicine.yale.edu/profile/mv999/' },
    });

    expect(finding).toMatchObject({ issue: 'wrong-person-profile-url' });
    expect(
      reconcileProfileUrlMismatchFinding(user, finding!, {
        url: 'https://medicine.yale.edu/profile/mv999/',
        name: 'M. Vector',
        title: 'Professor of Epidemiology',
        email: 'morgan.vector@yale.edu',
      }),
    ).toBeNull();
  });

  it('clears an odd-slug wrong-person URL finding when live profile facts exactly name the stored person', () => {
    const user = {
      netid: 'sv123',
      fname: 'Sandra',
      lname: 'Vector-Stern',
      email: 'sandra.vector-stern@example.edu',
      title: 'Associate Clinical Professor',
    };
    const finding = profileUrlMismatchIssue({
      ...user,
      profileUrls: { medicine: 'https://medicine.yale.edu/profile/sanvecste/' },
    });

    expect(finding).toMatchObject({ issue: 'wrong-person-profile-url' });
    expect(
      reconcileProfileUrlMismatchFinding(user, finding!, {
        url: 'https://medicine.yale.edu/profile/sanvecste/',
        name: 'Sandra Vector-Stern',
        title: '',
        email: '',
      }),
    ).toBeNull();
  });

  it('removes an opaque-slug wrong-person URL finding during live stored-profile compare', () => {
    const user = {
      netid: 'mn123',
      fname: 'Morgan',
      lname: 'North',
      title: 'Assistant Clinical Professor of Dermatology',
    };
    const finding = profileUrlMismatchIssue({
      ...user,
      profileUrls: { medicine: 'https://medicine.yale.edu/profile/mnapds/' },
    });

    expect(finding).toMatchObject({ issue: 'wrong-person-profile-url' });
    expect(
      reconcileWrongPersonFindingsForFacts([finding!], user, {
        url: 'https://medicine.yale.edu/profile/mnapds/',
        name: 'Morgan North',
        title: 'Assistant Clinical Professor',
        email: '',
      }),
    ).toEqual([]);
  });

  it('drops a live wrong-person URL finding when official facts could not be fetched', () => {
    const user = {
      netid: 'mn123',
      fname: 'Morgan',
      lname: 'North',
      title: 'Assistant Clinical Professor of Dermatology',
    };
    const finding = profileUrlMismatchIssue({
      ...user,
      profileUrls: { medicine: 'https://medicine.yale.edu/profile/mnapds/' },
    });

    expect(finding).toMatchObject({ issue: 'wrong-person-profile-url' });
    expect(reconcileLiveProfileUrlMismatchFinding(user, finding!, null)).toBeNull();
  });

  it('clears a missing official URL finding when an existing alternate-slug profile identifies the user', () => {
    const user = {
      netid: 'mv123',
      fname: 'Morgan',
      lname: 'Vector River',
      email: 'morgan.vectorriver@yale.edu',
      title: 'Assistant Professor of Radiology and Biomedical Imaging',
    };
    const finding = auditProfileRecord({
      user: {
        ...user,
        profileUrls: { medicine: 'https://medicine.yale.edu/profile/mv-river/' },
      },
      publicProfile: user,
    }).find((row) => row.issue === 'missing-official-profile-url');

    expect(finding).toMatchObject({ issue: 'missing-official-profile-url' });
    expect(
      reconcileMissingOfficialProfileFinding(user, finding!, [
        {
          url: 'https://medicine.yale.edu/profile/mv-river/',
          name: 'Morgan V. River',
          title: 'Assistant Professor of Radiology and Biomedical Imaging',
          email: '',
        },
      ]),
    ).toBeNull();
  });

  it('keeps a wrong-person URL finding when live profile facts identify another person', () => {
    const user = {
      netid: 'mv123',
      fname: 'Morgan',
      lname: 'Vector',
      email: 'morgan.vector@yale.edu',
      title: 'Professor of Epidemiology',
    };
    const finding = profileUrlMismatchIssue({
      ...user,
      profileUrls: { medicine: 'https://medicine.yale.edu/profile/riley-vector/' },
    });

    expect(
      reconcileProfileUrlMismatchFinding(user, finding!, {
        url: 'https://medicine.yale.edu/profile/riley-vector/',
        name: 'Riley Vector',
        title: 'Professor of Epidemiology',
        email: 'riley.vector@yale.edu',
      }),
    ).toMatchObject({
      issue: 'wrong-person-profile-url',
      officialName: 'Riley Vector',
    });
  });

  it('does not treat an official middle initial as a stored first-name match', () => {
    const user = {
      netid: 'sr123',
      fname: 'Sage',
      lname: 'River',
      email: '',
      title: 'Clinical Research Affiliate',
    };
    const finding = profileUrlMismatchIssue({
      ...user,
      profileUrls: { medicine: 'https://medicine.yale.edu/profile/shan-river/' },
    });

    expect(finding).toMatchObject({ issue: 'wrong-person-profile-url' });
    expect(
      reconcileProfileUrlMismatchFinding(user, finding!, {
        url: 'https://medicine.yale.edu/profile/shan-river/',
        name: 'Shan S. River',
        title: '',
        email: 'shan.river@example.edu',
      }),
    ).toMatchObject({
      issue: 'wrong-person-profile-url',
      officialName: 'Shan S. River',
    });
  });

  it('flags a broad affiliation summary when a later lead home is available', () => {
    expect(
      weakAffiliationSummaryIssue({
        research_interest_summary:
          'The Example Institute accelerates interdisciplinary research into cognition across Yale.',
        researchEntities: [
          { name: 'Example Institute', role: 'core-faculty' },
          { name: 'Vector Lab', role: 'pi' },
        ],
      }),
    ).toMatchObject({
      issue: 'weak-affiliation-summary',
      currentEntity: 'Example Institute',
      strongerEntity: 'Vector Lab',
    });
  });

  it('flags label-contaminated research summaries generated from profile shells', () => {
    expect(
      weakAffiliationSummaryIssue({
        netid: 'mv123',
        fname: 'Morgan',
        lname: 'Vector',
        research_interest_summary:
          'Research fields include Research Areas: synthetic policy, example methods, and Teaching Interests: introductory seminars.',
        researchEntities: [
          {
            name: 'Morgan Vector Faculty Research',
            role: 'pi',
            shortDescription:
              'Studies synthetic policy, example methods, and Research Areas: synthetic policy.',
          },
        ],
      }),
    ).toMatchObject({
      issue: 'weak-affiliation-summary',
      currentEntity: 'Morgan Vector Faculty Research',
      detail: 'Research context summary contains profile-directory labels instead of direct research prose.',
    });
  });

  it('flags affiliation-only research entity summaries when no research work is described', () => {
    expect(
      weakAffiliationSummaryIssue({
        netid: 'rv123',
        fname: 'Riley',
        lname: 'Vector',
        research_interest_summary:
          'Riley Vector studies synthetic methods and public systems using archival data.',
        researchEntities: [
          {
            name: 'Riley Vector Faculty Research',
            role: 'pi',
            shortDescription:
              'Riley Vector is affiliated with the Example Center and the Program in Synthetic Studies.',
          },
        ],
      }),
    ).toMatchObject({
      issue: 'weak-affiliation-summary',
      currentEntity: 'Riley Vector Faculty Research',
      detail: 'Research entity summary is affiliation-only and does not describe research work.',
    });
  });

  it('combines per-profile findings into a report row', () => {
    const findings = auditProfileRecord({
      user: {
        netid: 'mv123',
        fname: 'Morgan',
        lname: 'Vector',
        title: 'Professor of Epidemiology',
        primaryDepartment: 'Epidemiology',
        profileUrls: { orcid: 'https://orcid.org/0000-0000-0000-0000' },
        bio: '',
      },
      publicProfile: {
        research_interest_summary: 'The Example Disease Modeling Center studies disease.',
        researchEntities: [{ name: 'Example Disease Modeling Center', role: 'pi' }],
      },
    });

    expect(findings).toEqual([
      expect.objectContaining({
        issue: 'missing-official-profile-url',
        candidateUrls: [
          'https://ysph.yale.edu/profile/morgan-vector/',
          'https://ysph.yale.edu/profile/morgan-vector-1/',
          'https://ysph.yale.edu/profile/morgan-vector2/',
          'https://ysph.yale.edu/profile/m-vector/',
          'https://ysph.yale.edu/profile/mv123/',
          'https://medicine.yale.edu/profile/morgan-vector/',
          'https://medicine.yale.edu/profile/morgan-vector-1/',
          'https://medicine.yale.edu/profile/morgan-vector2/',
          'https://medicine.yale.edu/profile/m-vector/',
          'https://medicine.yale.edu/profile/mv123/',
        ],
      }),
    ]);
  });

  it('parses bounded dry-run arguments', () => {
    expect(
      parseProfileDataQualityAuditArgs([
        '--limit=25',
        '--skip=300',
        '--sample-limit=5',
        '--verify-live',
        '--live-missing-skip=10',
        '--live-missing-limit=0',
        '--live-compare-skip=20',
        '--live-compare-limit=7',
        '--output=/tmp/profile-audit.json',
      ]),
    ).toEqual({
      limit: 25,
      skip: 300,
      sampleLimit: 5,
      verifyLive: true,
      liveMissingSkip: 10,
      liveMissingLimit: 0,
      liveCompareSkip: 20,
      liveCompareLimit: 7,
      output: '/tmp/profile-audit.json',
    });
    expect(parseProfileDataQualityAuditArgs(['--live-missing-limit', '12'])).toMatchObject({
      liveMissingLimit: 12,
    });
    expect(parseProfileDataQualityAuditArgs(['--live-missing-skip', '34'])).toMatchObject({
      liveMissingSkip: 34,
    });
    expect(parseProfileDataQualityAuditArgs(['--live-compare-limit', '0'])).toMatchObject({
      liveCompareLimit: 0,
    });
    expect(parseProfileDataQualityAuditArgs(['--live-compare-skip', '56'])).toMatchObject({
      liveCompareSkip: 56,
    });
    expect(() => parseProfileDataQualityAuditArgs(['--live-missing-limit=-1'])).toThrow(
      /--live-missing-limit must be a non-negative integer/,
    );
    expect(() => parseProfileDataQualityAuditArgs(['--live-missing-skip=-1'])).toThrow(
      /--live-missing-skip must be a non-negative integer/,
    );
    expect(() => parseProfileDataQualityAuditArgs(['--live-compare-skip=-1'])).toThrow(
      /--live-compare-skip must be a non-negative integer/,
    );
    expect(() => parseProfileDataQualityAuditArgs(['--output=/etc/profile-audit.json'])).toThrow(
      /--output must write under/,
    );
    expect(() => parseProfileDataQualityAuditArgs(['--output=/tmp/profile-audit.txt'])).toThrow(
      /--output must point to a \.json report file/,
    );
  });
});
