import { describe, expect, it } from 'vitest';
import {
  canonicalizeDepartmentListFromRows,
  canonicalizeProfileDepartmentsFromRows,
} from '../departmentResolver';

const rows = [
  {
    _id: 'cpsc',
    abbreviation: 'CPSC',
    name: 'Computer Science',
    displayName: 'CPSC - Computer Science',
    aliases: [],
  },
  {
    _id: 'psyc',
    abbreviation: 'PSYC',
    name: 'Psychology',
    displayName: 'PSYC - Psychology',
    aliases: [],
  },
  {
    _id: 'cee',
    abbreviation: 'CEE',
    name: 'Chemical & Environmental Engineering',
    displayName: 'CEE - Chemical & Environmental Engineering',
    aliases: ['Chemical and Environmental Engineering'],
  },
  {
    _id: 'ece',
    abbreviation: 'ECE',
    name: 'Electrical Engineering',
    displayName: 'ECE - Electrical Engineering',
    aliases: ['Electrical & Computer Engineering'],
  },
  {
    _id: 'meng',
    abbreviation: 'MENG',
    name: 'Mechanical Engineering & Materials Science',
    displayName: 'MENG - Mechanical Engineering & Materials Science',
    aliases: [],
  },
  {
    _id: 'glbl',
    abbreviation: 'GLBL',
    name: 'Global Affairs',
    displayName: 'GLBL - Global Affairs',
    aliases: ['Jackson School of Global Affairs'],
  },
  {
    _id: 'mgt',
    abbreviation: 'MGT',
    name: 'Management',
    displayName: 'MGT - Management',
    aliases: [],
  },
  {
    _id: 'art',
    abbreviation: 'ART',
    name: 'Art',
    displayName: 'ART - Art',
    aliases: ['School of Art'],
  },
  {
    _id: 'afst',
    abbreviation: 'AFST',
    name: 'African Studies',
    displayName: 'AFST - African Studies',
    aliases: [],
  },
  {
    _id: 'econ',
    abbreviation: 'ECON',
    name: 'Economics',
    displayName: 'ECON - Economics',
    aliases: [],
  },
  {
    _id: 'ysm',
    abbreviation: 'YSM',
    name: 'Yale School of Medicine',
    displayName: 'YSM - Yale School of Medicine',
    aliases: [],
  },
  {
    _id: 'nurs',
    abbreviation: 'NURS',
    name: 'Nursing',
    displayName: 'NURS - Nursing',
    aliases: [],
  },
  {
    _id: 'law',
    abbreviation: 'LAW',
    name: 'Law',
    displayName: 'LAW - Law',
    aliases: [],
  },
  {
    _id: 'arch',
    abbreviation: 'ARCH',
    name: 'Architecture',
    displayName: 'ARCH - Architecture',
    aliases: [],
  },
  {
    _id: 'musi',
    abbreviation: 'MUSI',
    name: 'Music',
    displayName: 'MUSI - Music',
    aliases: [],
  },
  {
    _id: 'engl',
    abbreviation: 'ENGL',
    name: 'English Language & Literature',
    displayName: 'ENGL - English Language & Literature',
    aliases: [],
  },
  {
    _id: 'ehs',
    abbreviation: 'EHS',
    name: 'Environmental Health Sciences',
    displayName: 'EHS - Environmental Health Sciences',
    aliases: [],
  },
  {
    _id: 'psyt',
    abbreviation: 'PSYT',
    name: 'Psychiatry',
    displayName: 'PSYT - Psychiatry',
    aliases: [],
  },
  {
    _id: 'inmd',
    abbreviation: 'INMD',
    name: 'Internal Medicine',
    displayName: 'INMD - Internal Medicine',
    aliases: [],
  },
  {
    _id: 'rbi',
    abbreviation: 'R&BI',
    name: 'Radiology & Biomedical Imaging',
    displayName: 'R&BI - Radiology & Biomedical Imaging',
    aliases: [],
  },
  {
    _id: 'gene',
    abbreviation: 'GENE',
    name: 'Genetics',
    displayName: 'GENE - Genetics',
    aliases: [],
  },
  {
    _id: 'em',
    abbreviation: 'EM',
    name: 'Emergency Medicine',
    displayName: 'EM - Emergency Medicine',
    aliases: [],
  },
  {
    _id: 'nsci',
    abbreviation: 'NSCI',
    name: 'Neuroscience',
    displayName: 'NSCI - Neuroscience',
    aliases: [],
  },
  {
    _id: 'ibio',
    abbreviation: 'IBIO',
    name: 'Immunobiology',
    displayName: 'IBIO - Immunobiology',
    aliases: [],
  },
  {
    _id: 'anes',
    abbreviation: 'ANES',
    name: 'Anesthesiology',
    displayName: 'ANES - Anesthesiology',
    aliases: [],
  },
  {
    _id: 'derm',
    abbreviation: 'DERM',
    name: 'Dermatology',
    displayName: 'DERM - Dermatology',
    aliases: [],
  },
  {
    _id: 'mbb',
    abbreviation: 'MB&B',
    name: 'Molecular Biophysics & Biochemistry',
    displayName: 'MB&B - Molecular Biophysics & Biochemistry',
    aliases: [],
  },
  {
    _id: 'chld',
    abbreviation: 'CHLD',
    name: 'Child Study Center',
    displayName: 'CHLD - Child Study Center',
    aliases: [],
  },
  {
    _id: 'obgn',
    abbreviation: 'OBGN',
    name: 'Obstetrics, Gynecology & Reproductive Sciences',
    displayName: 'OBGN - Obstetrics, Gynecology & Reproductive Sciences',
    aliases: [],
  },
  {
    _id: 'trad',
    abbreviation: 'TRAD',
    name: 'Therapeutic Radiology/Radiation Oncology',
    displayName: 'TRAD - Therapeutic Radiology/Radiation Oncology',
    aliases: [],
  },
  {
    _id: 'urlg',
    abbreviation: 'URLG',
    name: 'Urology',
    displayName: 'URLG - Urology',
    aliases: [],
  },
  {
    _id: 'mbp',
    abbreviation: 'MBP',
    name: 'Microbial Pathogenesis',
    displayName: 'MBP - Microbial Pathogenesis',
    aliases: [],
  },
  {
    _id: 'cbio',
    abbreviation: 'CBIO',
    name: 'Cell Biology',
    displayName: 'CBIO - Cell Biology',
    aliases: [],
  },
  {
    _id: 'cmp',
    abbreviation: 'C&MP',
    name: 'Cellular & Molecular Physiology',
    displayName: 'C&MP - Cellular & Molecular Physiology',
    aliases: [],
  },
  {
    _id: 'hist',
    abbreviation: 'HIST',
    name: 'History',
    displayName: 'HIST - History',
    aliases: [],
  },
  {
    _id: 'bis',
    abbreviation: 'BIS',
    name: 'Biostatistics',
    displayName: 'BIS - Biostatistics',
    aliases: [],
  },
  {
    _id: 'emd',
    abbreviation: 'EMD',
    name: 'Epidemiology of Microbial Diseases',
    displayName: 'EMD - Epidemiology of Microbial Diseases',
    aliases: [],
  },
  {
    _id: 'cpmd',
    abbreviation: 'CPMD',
    name: 'Comparative Medicine',
    displayName: 'CPMD - Comparative Medicine',
    aliases: [],
  },
  {
    _id: 'phar',
    abbreviation: 'PHAR',
    name: 'Pharmacology',
    displayName: 'PHAR - Pharmacology',
    aliases: [],
  },
  {
    _id: 'oprh',
    abbreviation: 'OPRH',
    name: 'Orthopaedics & Rehabilitation',
    displayName: 'OPRH - Orthopaedics & Rehabilitation',
    aliases: [],
  },
  {
    _id: 'nrsg',
    abbreviation: 'NRSG',
    name: 'Neurosurgery',
    displayName: 'NRSG - Neurosurgery',
    aliases: [],
  },
  {
    _id: 'path',
    abbreviation: 'PATH',
    name: 'Pathology',
    displayName: 'PATH - Pathology',
    aliases: [],
  },
  {
    _id: 'surg',
    abbreviation: 'SURG',
    name: 'Surgery',
    displayName: 'SURG - Surgery',
    aliases: [],
  },
  {
    _id: 'pedt',
    abbreviation: 'PEDT',
    name: 'Pediatrics',
    displayName: 'PEDT - Pediatrics',
    aliases: [],
  },
  {
    _id: 'nrlg',
    abbreviation: 'NRLG',
    name: 'Neurology',
    displayName: 'NRLG - Neurology',
    aliases: [],
  },
  {
    _id: 'opvs',
    abbreviation: 'OPVS',
    name: 'Ophthalmology & Visual Science',
    displayName: 'OPVS - Ophthalmology & Visual Science',
    aliases: [],
  },
  {
    _id: 'bids',
    abbreviation: 'BIDS',
    name: 'Biomedical Informatics and Data Science',
    displayName: 'BIDS - Biomedical Informatics and Data Science',
    aliases: [],
  },
  {
    _id: 'eall',
    abbreviation: 'EALL',
    name: 'East Asian Languages & Literatures',
    displayName: 'EALL - East Asian Languages & Literatures',
    aliases: [],
  },
  {
    _id: 'chem',
    abbreviation: 'CHEM',
    name: 'Chemistry',
    displayName: 'CHEM - Chemistry',
    aliases: [],
  },
  {
    _id: 'span',
    abbreviation: 'SPAN/PORT',
    name: 'Spanish & Portuguese',
    displayName: 'SPAN/PORT - Spanish & Portuguese',
    aliases: [],
  },
  {
    _id: 'socy',
    abbreviation: 'SOCY',
    name: 'Sociology',
    displayName: 'SOCY - Sociology',
    aliases: [],
  },
  {
    _id: 'phys',
    abbreviation: 'PHYS',
    name: 'Physics',
    displayName: 'PHYS - Physics',
    aliases: [],
  },
  {
    _id: 'math',
    abbreviation: 'MATH',
    name: 'Mathematics',
    displayName: 'MATH - Mathematics',
    aliases: [],
  },
  {
    _id: 'nelc',
    abbreviation: 'NELC',
    name: 'Near Eastern Languages & Civilizations',
    displayName: 'NELC - Near Eastern Languages & Civilizations',
    aliases: [],
  },
  {
    _id: 'eeb',
    abbreviation: 'EEB',
    name: 'Ecology & Evolutionary Biology',
    displayName: 'EEB - Ecology & Evolutionary Biology',
    aliases: [],
  },
  {
    _id: 'phil',
    abbreviation: 'PHIL',
    name: 'Philosophy',
    displayName: 'PHIL - Philosophy',
    aliases: [],
  },
  {
    _id: 'fren',
    abbreviation: 'FREN',
    name: 'French',
    displayName: 'FREN - French',
    aliases: [],
  },
  {
    _id: 'hsar',
    abbreviation: 'HSAR',
    name: 'History of Art',
    displayName: 'HSAR - History of Art',
    aliases: [],
  },
  {
    _id: 'rlst',
    abbreviation: 'RLST',
    name: 'Religious Studies',
    displayName: 'RLST - Religious Studies',
    aliases: [],
  },
  {
    _id: 'ling',
    abbreviation: 'LING',
    name: 'Linguistics',
    displayName: 'LING - Linguistics',
    aliases: [],
  },
  {
    _id: 'hums',
    abbreviation: 'HUMS',
    name: 'Humanities',
    displayName: 'HUMS - Humanities',
    aliases: [],
  },
  {
    _id: 'clss',
    abbreviation: 'CLSS',
    name: 'Classics',
    displayName: 'CLSS - Classics',
    aliases: [],
  },
  {
    _id: 'gman',
    abbreviation: 'GMAN',
    name: 'German',
    displayName: 'GMAN - German',
    aliases: [],
  },
  {
    _id: 'amst',
    abbreviation: 'AMST',
    name: 'American Studies',
    displayName: 'AMST - American Studies',
    aliases: [],
  },
  {
    _id: 'slav',
    abbreviation: 'SLAV',
    name: 'Slavic Languages & Literatures',
    displayName: 'SLAV - Slavic Languages & Literatures',
    aliases: [],
  },
  {
    _id: 'ital',
    abbreviation: 'ITAL',
    name: 'Italian Studies',
    displayName: 'ITAL - Italian Studies',
    aliases: [],
  },
  {
    _id: 'wgss',
    abbreviation: 'WGSS',
    name: "Women's, Gender, & Sexuality Studies",
    displayName: "WGSS - Women's, Gender, & Sexuality Studies",
    aliases: [],
  },
  {
    _id: 'astr',
    abbreviation: 'ASTR',
    name: 'Astronomy',
    displayName: 'ASTR - Astronomy',
    aliases: [],
  },
  {
    _id: 'sds',
    abbreviation: 'S&DS',
    name: 'Statistics & Data Science',
    displayName: 'S&DS - Statistics & Data Science',
    aliases: [],
  },
  {
    _id: 'film',
    abbreviation: 'FILM',
    name: 'Film & Media Studies',
    displayName: 'FILM - Film & Media Studies',
    aliases: [],
  },
  {
    _id: 'erm',
    abbreviation: 'ER&M',
    name: 'Ethnicity, Race, & Migration',
    displayName: 'ER&M - Ethnicity, Race, & Migration',
    aliases: [],
  },
  {
    _id: 'cplt',
    abbreviation: 'CPLT',
    name: 'Comparative Literature',
    displayName: 'CPLT - Comparative Literature',
    aliases: [],
  },
  {
    _id: 'jdst',
    abbreviation: 'JDST',
    name: 'Jewish Studies',
    displayName: 'JDST - Jewish Studies',
    aliases: [],
  },
  {
    _id: 'afam',
    abbreviation: 'AFAM',
    name: 'Black Studies',
    displayName: 'AFAM - Black Studies',
    aliases: [],
  },
  {
    _id: 'hpm',
    abbreviation: 'HPM',
    name: 'Health Policy & Management',
    displayName: 'HPM - Health Policy & Management',
    aliases: [],
  },
  {
    _id: 'cde',
    abbreviation: 'CDE',
    name: 'Chronic Disease Epidemiology',
    displayName: 'CDE - Chronic Disease Epidemiology',
    aliases: [],
  },
  {
    _id: 'evst',
    abbreviation: 'EVST',
    name: 'Environment',
    displayName: 'EVST - Environment',
    aliases: ['Environmental Studies'],
  },
  {
    _id: 'hshm',
    abbreviation: 'HSHM',
    name: 'History of Science & Medicine',
    displayName: 'HSHM - History of Science & Medicine',
    aliases: [],
  },
  {
    _id: 'tdps',
    abbreviation: 'TDPS',
    name: 'Theater, Dance, & Performance Studies',
    displayName: 'TDPS - Theater, Dance, & Performance Studies',
    aliases: [],
  },
  {
    _id: 'eps',
    abbreviation: 'EPS',
    name: 'Earth & Planetary Sciences',
    displayName: 'EPS - Earth & Planetary Sciences',
    aliases: [],
  },
  {
    _id: 'rsee',
    abbreviation: 'RSEE',
    name: 'European & Russian Studies',
    displayName: 'RSEE - European & Russian Studies',
    aliases: [],
  },
  {
    _id: 'sast',
    abbreviation: 'SAST',
    name: 'South Asian Studies',
    displayName: 'SAST - South Asian Studies',
    aliases: [],
  },
  {
    _id: 'last',
    abbreviation: 'LAST',
    name: 'Latin American Studies',
    displayName: 'LAST - Latin American Studies',
    aliases: [],
  },
  {
    _id: 'mmes',
    abbreviation: 'MMES',
    name: 'Modern Middle East Studies',
    displayName: 'MMES - Modern Middle East Studies',
    aliases: [],
  },
  {
    _id: 'mcdb',
    abbreviation: 'MCDB',
    name: 'Molecular, Cellular & Developmental Biology',
    displayName: 'MCDB - Molecular, Cellular & Developmental Biology',
    aliases: [],
  },
];

describe('departmentResolver canonical department lists', () => {
  it('preserves official cross-listed departments', () => {
    const result = canonicalizeDepartmentListFromRows(['Psychology', 'Computer Science'], rows);

    expect(result.departments).toEqual(['Psychology', 'Computer Science']);
    expect(result.unresolved).toEqual([]);
    expect(result.ignored).toEqual([]);
  });

  it('deduplicates aliases into one official department', () => {
    const result = canonicalizeDepartmentListFromRows(
      ['CPSC', 'Computer Science', 'CPSC - Computer Science'],
      rows,
    );

    expect(result.departments).toEqual(['Computer Science']);
  });

  it('maps Yale directory Computer Science org-unit labels to CPSC', () => {
    const result = canonicalizeDepartmentListFromRows(
      ['EASCPS Computer Science', 'EAS School of Engineering and Applied Science'],
      rows,
    );

    expect(result.departments).toEqual(['Computer Science']);
    expect(result.ignored).toEqual(['EAS School of Engineering and Applied Science']);
    expect(result.unresolved).toEqual([]);
  });

  it('returns profile-facing display names from canonical rows', () => {
    const result = canonicalizeProfileDepartmentsFromRows(
      {
        primaryDepartment: 'EASCPS Computer Science',
        secondaryDepartments: ['EAS School of Engineering and Applied Science'],
        departments: ['Computer Science'],
      },
      rows,
    );

    expect(result.primaryDepartment).toBe('CPSC - Computer Science');
    expect(result.secondaryDepartments).toEqual([]);
    expect(result.departments).toEqual(['CPSC - Computer Science']);
    expect(result.unresolved).toEqual([]);
    expect(result.ignored).toEqual(['EAS School of Engineering and Applied Science']);
  });

  it('maps specific source-unit labels to official departments and ignores broad school labels', () => {
    const result = canonicalizeDepartmentListFromRows(
      [
        'EASCEE CEE Faculty',
        'EASMEC MechE Faculty',
        'Mechanical Engineering',
        'Materials Science',
        'EAS School of Engineering and Applied Science',
      ],
      rows,
    );

    expect(result.departments).toEqual([
      'Chemical & Environmental Engineering',
      'Mechanical Engineering & Materials Science',
    ]);
    expect(result.ignored).toEqual(['EAS School of Engineering and Applied Science']);
    expect(result.unresolved).toEqual([]);
  });

  it('maps Jackson and Art school source labels to official department rows', () => {
    expect(
      canonicalizeDepartmentListFromRows(['JAC Jackson School of Global Affairs'], rows).departments,
    ).toEqual(['Global Affairs']);
    expect(canonicalizeDepartmentListFromRows(['ARTSCH School of Art - All School'], rows).departments).toEqual([
      'Art',
    ]);
  });

  it('maps specific MacMillan program labels but ignores the broad center label', () => {
    const result = canonicalizeDepartmentListFromRows(
      ['MACAFR Council On African Studies', 'MAC MacMillan Center'],
      rows,
    );

    expect(result.departments).toEqual(['African Studies']);
    expect(result.ignored).toEqual(['MAC MacMillan Center']);
  });

  it('ignores broad medical school labels while preserving specific canonical departments', () => {
    const result = canonicalizeDepartmentListFromRows(['Pediatrics', 'Yale School of Medicine'], rows);

    expect(result.departments).toEqual(['Pediatrics']);
    expect(result.ignored).toEqual(['Yale School of Medicine']);
    expect(result.unresolved).toEqual([]);
  });

  it('does not expose the broad FAS other academic departments source bucket', () => {
    const result = canonicalizeDepartmentListFromRows(
      ['Psychology', 'FAS Other FAS and Academic Departments'],
      rows,
    );

    expect(result.departments).toEqual(['Psychology']);
    expect(result.ignored).toEqual(['FAS Other FAS and Academic Departments']);
    expect(result.unresolved).toEqual([]);
  });

  it('maps professional-school source-unit families to canonical departments when specific enough', () => {
    const result = canonicalizeDepartmentListFromRows(
      [
        'NUR School of Nursing',
        'NURPRO MSN Program',
        'LAW School of Law',
        'LAWFAF Academic Faculty',
        'ARCSCH School of Architecture - All',
        'ARC School of Architecture',
        'SCM School of Music',
        'SCMMUS Dean',
      ],
      rows,
    );

    expect(result.departments).toEqual(['Nursing', 'Law', 'Architecture', 'Music']);
    expect(result.ignored).toEqual([]);
    expect(result.unresolved).toEqual([]);
  });

  it('maps FAS and YSPH source-unit labels to canonical department rows', () => {
    const result = canonicalizeDepartmentListFromRows(
      [
        'FASENG English',
        'FAS Other FAS and Academic Departments',
        'SPHDPT Environmental Health Sciences (EHS)',
        'SPH School of Public Health',
      ],
      rows,
    );

    expect(result.departments).toEqual([
      'English Language & Literature',
      'Environmental Health Sciences',
    ]);
    expect(result.ignored).toEqual([
      'FAS Other FAS and Academic Departments',
      'SPH School of Public Health',
    ]);
    expect(result.unresolved).toEqual([]);
  });

  it('maps high-confidence Yale School of Medicine source-unit families', () => {
    const result = canonicalizeDepartmentListFromRows(
      [
        'MEDPSY Psych Divisions-CNRU',
        'MEDINT Cardiology',
        'MEDDRA Radiology',
        'MEDGEN Genetics-All',
        'MEDEME Emergency Medicine - All',
        'MEDNSC MNBIO Neuroscience Department',
        'MEDIMU Immunobiology-All',
        'MEDANE Section of Perioperative Adult Anesthesia',
        'MEDDER General Dermatology',
        'MEDMBB MB and B-All',
        'MEDCSC Child Study Center - All',
        'MEDOBG MOBGYN-All',
        'MEDTRA Therapeutic Radiology',
        'MEDURO Urology - All',
        'MEDMPA Microbial Pathogenesis-All',
        'MEDCEL Cell Biology-All',
        'MEDCMP C And M Physiology-All',
        'MED School of Medicine',
      ],
      rows,
    );

    expect(result.departments).toEqual([
      'Psychiatry',
      'Internal Medicine',
      'Radiology & Biomedical Imaging',
      'Genetics',
      'Emergency Medicine',
      'Neuroscience',
      'Immunobiology',
      'Anesthesiology',
      'Dermatology',
      'Molecular Biophysics & Biochemistry',
      'Child Study Center',
      'Obstetrics, Gynecology & Reproductive Sciences',
      'Therapeutic Radiology/Radiation Oncology',
      'Urology',
      'Microbial Pathogenesis',
      'Cell Biology',
      'Cellular & Molecular Physiology',
    ]);
    expect(result.ignored).toEqual(['MED School of Medicine']);
    expect(result.unresolved).toEqual([]);
  });

  it('maps additional reviewed FAS source-unit families to active canonical rows', () => {
    const result = canonicalizeDepartmentListFromRows(
      [
        'FASHIS History',
        'FASEAL East Asian Languages and Literatures',
        'FASCHM Administration',
        'FASSPP Dept of Spanish and Portuguese',
        'FASSOC Sociology',
        'FASPHY Physics Business Operations',
        'FASMAT Mathematics',
        'FASNEL Near Eastern Languages and Civilizations',
        'FASEEB Department Administration',
        'FASPHI Philosophy Department',
        'FASFRE French Department',
        'FASHOA History of Art',
        'FASRST  Religious Studies',
        'FASLIN Linguistics-Research Unit',
        'FASHUM Humanities Studies',
        'FASCLA Classics Department',
        'FASGER German',
        'FASAMS American Studies',
        'FASSLA Slavic Languages and Literatures',
        'FASITA Italian Department',
        'FASGSS Womens,Gender and Sexuality Studies',
        'FASAST Astronomy',
        'FASSTA Statistics',
        'FASFIL Film Studies',
        'FASERM Ethnicity, Race & Migration',
        'FASCLI Comparative Literature',
        'FASJUD Judaic Studies',
        'FASAAS Black Studies',
      ],
      rows,
    );

    expect(result.departments).toEqual([
      'History',
      'East Asian Languages & Literatures',
      'Chemistry',
      'Spanish & Portuguese',
      'Sociology',
      'Physics',
      'Mathematics',
      'Near Eastern Languages & Civilizations',
      'Ecology & Evolutionary Biology',
      'Philosophy',
      'French',
      'History of Art',
      'Religious Studies',
      'Linguistics',
      'Humanities',
      'Classics',
      'German',
      'American Studies',
      'Slavic Languages & Literatures',
      'Italian Studies',
      "Women's, Gender, & Sexuality Studies",
      'Astronomy',
      'Statistics & Data Science',
      'Film & Media Studies',
      'Ethnicity, Race, & Migration',
      'Comparative Literature',
      'Jewish Studies',
      'Black Studies',
    ]);
    expect(result.unresolved).toEqual([]);
  });

  it('maps additional reviewed YSPH and YSM source-unit families to active canonical rows', () => {
    const result = canonicalizeDepartmentListFromRows(
      [
        'SPHDPT  Biostatistics (BIS)',
        'SPHDPT  Epidemiology of Microbial Diseases (EMD)',
        'SPHDPT  Health Policy and Management (HPM)',
        'SPHDPT Chronic Disease Epidemiology (CDE)',
        'MEDPAT MPATH-All',
        'MEDCOM Comparative Medicine-All',
        'MEDPHA Pharmacology-All',
        'MEDORT Orthopaedics - All',
        'MEDNSG Neurosurgery - All',
        'MEDSUR Otolaryngology-General Otolaryngology',
        'MEDPED Critical Care',
        'MEDNEU Epilepsy',
        'MEDOPT Ophthalmology Specialities',
        'MEDBMI Biomedical Informatics & Data Science',
        'MEDHIS History Of Medicine-All',
      ],
      rows,
    );

    expect(result.departments).toEqual([
      'Biostatistics',
      'Epidemiology of Microbial Diseases',
      'Health Policy & Management',
      'Chronic Disease Epidemiology',
      'Pathology',
      'Comparative Medicine',
      'Pharmacology',
      'Orthopaedics & Rehabilitation',
      'Neurosurgery',
      'Surgery',
      'Pediatrics',
      'Neurology',
      'Ophthalmology & Visual Science',
      'Biomedical Informatics and Data Science',
      'History of Science & Medicine',
    ]);
    expect(result.unresolved).toEqual([]);
  });

  it('maps reviewed professional-school center families to their canonical school departments', () => {
    const result = canonicalizeDepartmentListFromRows(
      [
        'LAWFAC Non Center-Related Faculty Activity',
        'LAWCEN Information Society Project',
        'LAWLSO Legal Services Organization',
        'JACBLC Blue Center',
        'JACTEA Jackson Senior Fellows',
        'SOMRES Center for Customer Insights',
        'School of Management',
      ],
      rows,
    );

    expect(result.departments).toEqual(['Law', 'Global Affairs', 'Management']);
    expect(result.unresolved).toEqual([]);
  });

  it('ignores broad administrative source-unit families without canonical department rows', () => {
    const result = canonicalizeDepartmentListFromRows(
      [
        'DRAADM Business Office',
        'DRA David Geffen School of Drama at Yale',
        'DIVFIN Divinity General',
        'DIV School of Divinity',
        'ISM Institute of Sacred Music',
        'YCO Yale College Operating Units',
        'YHP Yale Health',
        'ATH Athletics',
        'Graduate School of Arts & Sci',
      ],
      rows,
    );

    expect(result.departments).toEqual([]);
    expect(result.ignored).toEqual([
      'DRAADM Business Office',
      'DRA David Geffen School of Drama at Yale',
      'DIVFIN Divinity General',
      'DIV School of Divinity',
      'ISM Institute of Sacred Music',
      'YCO Yale College Operating Units',
      'YHP Yale Health',
      'ATH Athletics',
      'Graduate School of Arts & Sci',
    ]);
    expect(result.unresolved).toEqual([]);
  });

  it('maps additional reviewed low-volume source-unit labels to active canonical rows', () => {
    const result = canonicalizeDepartmentListFromRows(
      [
        'FASTHE Theater Studies',
        'Theater Studies',
        'FASEPS Earth & Planetary Sciences',
        'MACEUR Council on European Studies',
        'MACSAS Council on South Asian Studies',
        'MACMID Council on Middle East Studies',
        'MACLAT Council On Latin American Studies',
        'ENVCEN EVST Environmental Studies',
        'FASECO Cowles Foundation',
        'FASECO Economic Growth Center',
        'FASMCD Research Unit',
        'Law School',
        'JACOPC Johnson Center for the Study of American Diplomacy',
      ],
      rows,
    );

    expect(result.departments).toEqual([
      'Theater, Dance, & Performance Studies',
      'Earth & Planetary Sciences',
      'European & Russian Studies',
      'South Asian Studies',
      'Modern Middle East Studies',
      'Latin American Studies',
      'Environment',
      'Economics',
      'Molecular, Cellular & Developmental Biology',
      'Law',
      'Global Affairs',
    ]);
    expect(result.unresolved).toEqual([]);
  });

  it('ignores reviewed source units that have no active canonical department row', () => {
    const result = canonicalizeDepartmentListFromRows(
      [
        'MEDCCC Medical Oncology',
        'MEDLAB Laboratory Medicine',
        'SPHDPT  Social and Behavioral Sciences (SBS)',
        'MACSEA Council on Southeast Asian Studies',
        'MACADM Administration',
        'MEDKEC Keck Biotechnology Services',
        'SPHADM Dean\'s Office',
        'EASCEN SEAS Dean\'s Office',
        'FASFDA FAS Dean Administration',
      ],
      rows,
    );

    expect(result.departments).toEqual([]);
    expect(result.unresolved).toEqual([]);
    expect(result.ignored).toEqual([
      'MEDCCC Medical Oncology',
      'MEDLAB Laboratory Medicine',
      'SPHDPT  Social and Behavioral Sciences (SBS)',
      'MACSEA Council on Southeast Asian Studies',
      'MACADM Administration',
      'MEDKEC Keck Biotechnology Services',
      'SPHADM Dean\'s Office',
      'EASCEN SEAS Dean\'s Office',
      'FASFDA FAS Dean Administration',
    ]);
  });

  it('handles the final reviewed residual labels without leaving unresolved profile departments', () => {
    const result = canonicalizeDepartmentListFromRows(
      [
        'International and Development Economics',
        'Laboratory Medicine',
        'FASCOG Digital Ethics Center',
        'FASWHC Whitney Humanities Center',
        'EASCTI Center for Engineering and Innovative Design',
        'FASEPE Program on Ethics, Politics and Economics',
        'FASLSC Center for Language Study',
        'ENVACC Research',
        'Yale Summer Session',
      ],
      rows,
    );

    expect(result.departments).toEqual(['Economics']);
    expect(result.unresolved).toEqual([]);
    expect(result.ignored).toEqual([
      'Laboratory Medicine',
      'FASCOG Digital Ethics Center',
      'FASWHC Whitney Humanities Center',
      'EASCTI Center for Engineering and Innovative Design',
      'FASEPE Program on Ethics, Politics and Economics',
      'FASLSC Center for Language Study',
      'ENVACC Research',
      'Yale Summer Session',
    ]);
  });
});
