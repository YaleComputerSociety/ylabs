export interface MajorTopicMapping {
  readonly researchAreas: readonly string[];
  readonly departments: readonly string[];
  readonly noSignalReason?: string;
}

export const MAJOR_TOPIC_MAP: Readonly<Record<string, MajorTopicMapping>> = {
  Neuroscience: {
    researchAreas: [
      'Neuroimaging',
      'Neurodegenerative Diseases',
      'Neurophysiology',
      'Cognitive Neuroscience',
      'Functional Neuroimaging',
      'Synapses',
      'Neurodevelopmental Disorders',
      'Prefrontal Cortex',
      'Memory',
    ],
    departments: ['Neuroscience'],
  },
  Psychology: {
    researchAreas: [
      'Psychology',
      'Psychiatry and Psychology',
      'Psychological Phenomena',
      'Resilience, Psychological',
      'Cognition',
      'Behavioral Science',
      'Stress, Psychological',
      'Cognitive Neuroscience',
      'Clinical Psychology',
      'Emotions',
      'Neuropsychology',
      'Developmental Psychology',
      'Personality',
      'Behavior and Behavior Mechanisms',
      'Decision Making',
    ],
    departments: ['Psychology'],
  },
  'Cognitive Science': {
    researchAreas: [
      'Cognition',
      'Cognitive Neuroscience',
      'Decision Making',
      'Linguistics',
      'Language Learning',
    ],
    departments: ['Cognitive Science'],
  },
  'Computer Science': {
    researchAreas: [
      'Deep Learning',
      'Natural Language Processing',
      'Neural Networks, Computer',
      'Computer Simulation',
      'Large Language Models',
      'Mathematical Computing',
    ],
    departments: ['Computer Science'],
  },
  Economics: {
    researchAreas: [
      'Political Economy',
      'Industrial Organization',
      'Labor Economics',
      'Econometrics',
      'Macroeconomics',
      'Economic Development',
      'Economic History',
      'Corporate Finance',
      'Economic Theory',
      'Game Theory',
      'Development Economics',
      'Public Economics',
      'Health Economics',
      'Financial Economics',
      'Behavioral Economics',
      'Financial Markets',
      'Inequality',
      'International Trade',
      'Market Design',
      'Environmental Economics',
      'International Economics',
    ],
    departments: ['Economics'],
  },
  'Statistics and Data Science': {
    researchAreas: [
      'Statistics',
      'Biostatistics',
      'Data Science',
      'Statistics as Topic',
      'Econometrics',
    ],
    departments: ['Statistics & Data Science', 'Biostatistics'],
  },
  Mathematics: {
    researchAreas: ['Optimization'],
    departments: ['Mathematics'],
  },
  'Applied Mathematics': {
    researchAreas: ['Optimization', 'Statistics', 'Computational Biology'],
    departments: ['Applied Mathematics'],
  },
  Physics: {
    researchAreas: [
      'Physics',
      'Condensed Matter Physics',
      'Particle Physics',
      'Quantum Physics',
      'Nuclear Physics',
      'Cosmology',
    ],
    departments: ['Physics'],
  },
  'Applied Physics': {
    researchAreas: ['Condensed Matter Physics', 'Quantum Physics', 'Materials Science', 'Physics'],
    departments: ['Applied Physics'],
  },
  Astronomy: {
    researchAreas: ['Cosmology', 'Planetary Science'],
    departments: ['Astronomy'],
  },
  Astrophysics: {
    researchAreas: ['Cosmology', 'Planetary Science', 'Physics', 'Particle Physics'],
    departments: ['Astronomy', 'Physics'],
  },
  Chemistry: {
    researchAreas: ['Physical Chemistry', 'Organic Chemistry', 'Catalysis'],
    departments: ['Chemistry'],
  },
  'Molecular Biophysics & Biochemistry': {
    researchAreas: [
      'Biochemistry',
      'Biophysics',
      'Molecular Biology',
      'Cryoelectron Microscopy',
      'DNA Repair',
    ],
    departments: ['Molecular Biophysics & Biochemistry'],
  },
  'Molecular, Cellular, & Developmental Biology': {
    researchAreas: [
      'Molecular Biology',
      'Cell Biology',
      'Developmental Biology',
      'Genomics',
      'Stem Cells',
      'Signal Transduction',
      'Epigenomics',
      'Epigenetics',
      'Human Genetics',
    ],
    departments: ['Molecular, Cellular & Developmental Biology', 'Cell Biology'],
  },
  'Ecology & Evolutionary Biology': {
    researchAreas: [
      'Ecology',
      'Ecosystem Dynamics and Biodiversity',
      'Biodiversity',
      'Ecosystem Conservation and Resilience',
      'Evolutionary Biology',
      'Habitat Conservation',
      'Urban Ecology',
      'Biodiversity Loss',
      'Population Genetics',
      'Genetics, Population',
    ],
    departments: ['Ecology & Evolutionary Biology'],
  },
  'Biomedical Engineering': {
    researchAreas: [
      'Biomedical Engineering',
      'Bioengineering',
      'Tissue Engineering',
      'Medical Imaging',
      'Magnetic Resonance Imaging',
      'Imaging, Three-Dimensional',
    ],
    departments: ['Biomedical Engineering'],
  },
  'Electrical Engineering': {
    researchAreas: ['Electronics', 'Signal Processing'],
    departments: ['Electrical & Computer Engineering'],
  },
  'Mechanical Engineering': {
    researchAreas: ['Materials Science'],
    departments: ['Mechanical Engineering & Materials Science'],
  },
  'Chemical Engineering': {
    researchAreas: ['Catalysis', 'Materials Science', 'Clean Energy', 'Energy'],
    departments: ['Chemical & Environmental Engineering'],
  },
  'Environmental Engineering': {
    researchAreas: ['Air Pollution', 'Clean Energy', 'Sustainable Design', 'Environmental Science'],
    departments: ['Chemical & Environmental Engineering'],
  },
  'Engineering Sciences (Chemical)': {
    researchAreas: ['Catalysis', 'Materials Science', 'Clean Energy', 'Energy'],
    departments: ['Chemical & Environmental Engineering'],
  },
  'Engineering Sciences (Electrical)': {
    researchAreas: ['Electronics', 'Signal Processing'],
    departments: ['Electrical & Computer Engineering'],
  },
  'Engineering Sciences (Mechanical)': {
    researchAreas: ['Materials Science'],
    departments: ['Mechanical Engineering & Materials Science'],
  },
  'Engineering Sciences (Environmental)': {
    researchAreas: ['Air Pollution', 'Clean Energy', 'Sustainable Design', 'Environmental Science'],
    departments: ['Chemical & Environmental Engineering'],
  },
  'Electrical Engineering & Computer Science': {
    researchAreas: [
      'Electronics',
      'Signal Processing',
      'Deep Learning',
      'Natural Language Processing',
      'Neural Networks, Computer',
      'Computer Simulation',
      'Large Language Models',
      'Mathematical Computing',
    ],
    departments: ['Electrical & Computer Engineering', 'Computer Science'],
  },
  'Computer Science & Economics': {
    researchAreas: [
      'Deep Learning',
      'Natural Language Processing',
      'Neural Networks, Computer',
      'Computer Simulation',
      'Large Language Models',
      'Mathematical Computing',
      'Econometrics',
      'Game Theory',
      'Market Design',
      'Industrial Organization',
      'Behavioral Economics',
      'Financial Economics',
      'Economic Theory',
    ],
    departments: ['Computer Science', 'Economics'],
  },
  'Computer Science & Mathematics': {
    researchAreas: [
      'Deep Learning',
      'Natural Language Processing',
      'Neural Networks, Computer',
      'Computer Simulation',
      'Large Language Models',
      'Mathematical Computing',
      'Optimization',
    ],
    departments: ['Computer Science', 'Mathematics'],
  },
  'Computer Science & Psychology': {
    researchAreas: [
      'Natural Language Processing',
      'Large Language Models',
      'Psychology',
      'Cognition',
      'Cognitive Neuroscience',
      'Decision Making',
      'Developmental Psychology',
    ],
    departments: ['Computer Science', 'Psychology'],
  },
  'Computing and the Arts': {
    researchAreas: ['Digital Humanities', 'Visual Arts', 'Music Theory', 'Graphic Design'],
    departments: ['Computer Science', 'Art'],
  },
  'Economics & Mathematics': {
    researchAreas: [
      'Econometrics',
      'Economic Theory',
      'Game Theory',
      'Financial Economics',
      'Macroeconomics',
      'Market Design',
      'Optimization',
    ],
    departments: ['Economics', 'Mathematics'],
  },
  'Mathematics & Philosophy': {
    researchAreas: ['Optimization', 'Metaphysics'],
    departments: ['Mathematics', 'Philosophy'],
  },
  'Mathematics & Physics': {
    researchAreas: [
      'Optimization',
      'Physics',
      'Condensed Matter Physics',
      'Particle Physics',
      'Quantum Physics',
      'Nuclear Physics',
      'Cosmology',
    ],
    departments: ['Mathematics', 'Physics'],
  },
  'Physics & Geosciences': {
    researchAreas: ['Physics', 'Planetary Science', 'Geology', 'Climate Science and Policy'],
    departments: ['Physics', 'Earth & Planetary Sciences'],
  },
  'Physics & Philosophy': {
    researchAreas: ['Physics', 'Quantum Physics', 'Cosmology', 'Particle Physics', 'Metaphysics'],
    departments: ['Physics', 'Philosophy'],
  },
  'Earth and Planetary Sciences': {
    researchAreas: ['Planetary Science', 'Geology', 'Climate Science and Policy'],
    departments: ['Earth & Planetary Sciences'],
  },
  'Environmental Studies': {
    researchAreas: [
      'Climate Change',
      'Climate Science and Policy',
      'Environmental Resources and Systems',
      'Sustainability',
      'Environmental Science',
      'Environmental Justice',
      'Sustainable Development',
      'Ecosystem Conservation and Resilience',
      'Land Conservation',
      'Climate/Environmental Policy',
      'Habitat Conservation',
      'Environmental Economics',
      'Environmental Governance and Leadership',
      'Biodiversity',
      'Ecology',
      'Urban Ecology',
    ],
    departments: [],
  },
  History: {
    researchAreas: [
      'Cultural History',
      'Intellectual History',
      'Economic History',
      'Social History',
      'Ancient History',
      'Modern History',
    ],
    departments: ['History'],
  },
  English: {
    researchAreas: [
      'American Literature',
      'Literature',
      'Creative Writing',
      'Poetry',
      'Comparative Literature',
    ],
    departments: ['English Language & Literature'],
  },
  Philosophy: {
    researchAreas: ['Metaphysics'],
    departments: ['Philosophy'],
  },
  'Political Science': {
    researchAreas: [
      'Political Science',
      'Political Economy',
      'Constitutional Law',
      'International Relations',
      'Political Theory',
      'Comparative Politics',
      'International Law',
      'Law',
    ],
    departments: ['Political Science'],
  },
  Sociology: {
    researchAreas: [
      'Sociology',
      'Social Movements',
      'Social Determinants of Health',
      'Demography',
      'Inequality',
      'Social and Cultural Perspectives',
      'Social History',
      'Social Justice',
    ],
    departments: ['Sociology'],
  },
  Anthropology: {
    researchAreas: ['Anthropology', 'Archaeology', 'Material Culture'],
    departments: ['Anthropology'],
  },
  'Archaeological Studies': {
    researchAreas: ['Archaeology', 'Material Culture', 'Ancient History'],
    departments: ['Archaeological Studies'],
  },
  Music: {
    researchAreas: ['Music History', 'Musicology', 'Music Theory', 'Ethnomusicology', 'Music'],
    departments: ['Music'],
  },
  Art: {
    researchAreas: ['Visual Arts', 'Fine Arts', 'Contemporary Art', 'Graphic Design'],
    departments: ['Art'],
  },
  'History of Art': {
    researchAreas: ['Art History', 'Material Culture', 'Contemporary Art'],
    departments: ['History of Art'],
  },
  Architecture: {
    researchAreas: ['Built Environment', 'Sustainable Design'],
    departments: ['Architecture'],
  },
  'Theater & Performance Studies': {
    researchAreas: ['Performance Studies'],
    departments: ['Theater, Dance, & Performance Studies'],
  },
  'Theater, Dance, & Performance Studies': {
    researchAreas: ['Performance Studies'],
    departments: ['Theater, Dance, & Performance Studies'],
  },
  'Film and Media Studies': {
    researchAreas: ['Media Studies', 'Journalism'],
    departments: ['Film & Media Studies'],
  },
  'Religious Studies': {
    researchAreas: ['Theology', 'Religious Studies', 'Islamic Studies'],
    departments: ['Religious Studies'],
  },
  Classics: {
    researchAreas: ['Ancient History', 'Archaeology'],
    departments: ['Classics'],
  },
  'Classical Civilization': {
    researchAreas: ['Ancient History', 'Archaeology'],
    departments: ['Classics'],
  },
  'Greek, Ancient & Modern': {
    researchAreas: ['Ancient History'],
    departments: ['Classics'],
  },
  Linguistics: {
    researchAreas: ['Linguistics', 'Language Learning', 'Natural Language Processing'],
    departments: ['Linguistics'],
  },
  'American Studies': {
    researchAreas: ['American Studies', 'American Literature', 'Latin American Studies'],
    departments: ['American Studies'],
  },
  'African American Studies': {
    researchAreas: ['African Diaspora'],
    departments: ['Black Studies'],
  },
  'Black Studies': {
    researchAreas: ['African Diaspora'],
    departments: ['Black Studies'],
  },
  'African Studies': {
    researchAreas: ['African Studies', 'African Diaspora'],
    departments: ['African Studies'],
  },
  'East Asian Studies': {
    researchAreas: [],
    departments: ['East Asian Languages & Literatures'],
  },
  'East Asian Languages & Literatures': {
    researchAreas: [],
    departments: ['East Asian Languages & Literatures'],
  },
  'Global Affairs': {
    researchAreas: [
      'International Relations',
      'Economic Development',
      'Development Economics',
      'Sustainable Development',
      'International Trade',
      'International Economics',
      'International Law',
      'Globalization',
    ],
    departments: ['Global Affairs'],
  },
  "Women's, Gender, & Sexuality Studies": {
    researchAreas: ['Gender Studies', 'Feminism', 'Sexual and Gender Minorities'],
    departments: ["Women's, Gender, & Sexuality Studies"],
  },
  'Ethnicity, Race, & Migration': {
    researchAreas: ['Ethnic Studies', 'African Diaspora'],
    departments: ['Ethnicity, Race, & Migration'],
  },
  'History of Science, Medicine, & Public Health': {
    researchAreas: ['Environment and Public Health'],
    departments: ['History of Science & Medicine', 'History of Medicine'],
  },
  Humanities: {
    researchAreas: [
      'Intellectual History',
      'Cultural History',
      'Comparative Literature',
      'Literature',
      'Philosophy',
      'Digital Humanities',
    ],
    departments: ['Humanities'],
  },
  'Near Eastern Languages & Civilizations': {
    researchAreas: ['Ancient History', 'Islamic Studies'],
    departments: ['Near Eastern Languages & Civilizations'],
  },
  'Modern Middle Eastern Studies': {
    researchAreas: ['Islamic Studies'],
    departments: ['Near Eastern Languages & Civilizations'],
  },
  'Modern Middle East Studies': {
    researchAreas: ['Islamic Studies'],
    departments: ['Near Eastern Languages & Civilizations'],
  },
  'Latin American Studies': {
    researchAreas: ['Latin American Studies'],
    departments: ['Spanish & Portuguese'],
  },
  Spanish: {
    researchAreas: ['Latin American Studies'],
    departments: ['Spanish & Portuguese'],
  },
  Portuguese: {
    researchAreas: [],
    departments: ['Spanish & Portuguese'],
  },
  French: {
    researchAreas: [],
    departments: ['French'],
  },
  'German Studies': {
    researchAreas: [],
    departments: ['German'],
  },
  Italian: {
    researchAreas: [],
    departments: ['Italian Studies'],
  },
  'Italian Studies': {
    researchAreas: [],
    departments: ['Italian Studies'],
  },
  Russian: {
    researchAreas: [],
    departments: ['Slavic Languages & Literatures'],
  },
  'Russian & East European Studies': {
    researchAreas: [],
    departments: ['Slavic Languages & Literatures'],
  },
  'Russian, East European, and Eurasian Studies': {
    researchAreas: [],
    departments: ['Slavic Languages & Literatures'],
  },
  'Judaic Studies': {
    researchAreas: [],
    departments: ['Jewish Studies'],
  },
  'Jewish Studies': {
    researchAreas: [],
    departments: ['Jewish Studies'],
  },
  'South Asian Studies': {
    researchAreas: [],
    departments: [],
    noSignalReason: 'no served topic or department holds enough rows',
  },
  'Urban Studies': {
    researchAreas: [
      'Urban',
      'Urban Health',
      'Urban Land Use',
      'Urban Ecology',
      'Built Environment',
    ],
    departments: [],
  },
  'Comparative Literature': {
    researchAreas: ['Comparative Literature', 'Literature', 'Poetry'],
    departments: ['Comparative Literature'],
  },
  'Literature & Comparative Cultures': {
    researchAreas: ['Comparative Literature', 'Literature', 'Poetry'],
    departments: ['Comparative Literature'],
  },
  'Ethics, Politics, & Economics': {
    researchAreas: [
      'Political Theory',
      'Political Economy',
      'Political Science',
      'Behavioral Economics',
      'Public Economics',
      'Inequality',
      'Economic Theory',
    ],
    departments: ['Philosophy', 'Political Science', 'Economics'],
  },
  'Special Divisional Major': {
    researchAreas: [],
    departments: [],
    noSignalReason: 'self-designed major with no fixed field',
  },
  Undeclared: {
    researchAreas: [],
    departments: [],
    noSignalReason: 'no declared field',
  },
  'Visiting International Program': {
    researchAreas: [],
    departments: [],
    noSignalReason: 'visiting students have no Yale major',
  },
};

export const YALIES_ABBREVIATED_MAJOR_NAMES: Readonly<Record<string, string>> = {
  'Computer Science & Econ': 'Computer Science & Economics',
  'East Asian Languages & Lits': 'East Asian Languages & Literatures',
  'Elec.Engineering/Computer Sci': 'Electrical Engineering & Computer Science',
  'Engineering Sci-Environmental': 'Engineering Sciences (Environmental)',
  'Engineering Science-Chemical': 'Engineering Sciences (Chemical)',
  'Engineering Science-Electrical': 'Engineering Sciences (Electrical)',
  'Engineering Science-Mechanical': 'Engineering Sciences (Mechanical)',
  'Ethics,Politics & Economics': 'Ethics, Politics, & Economics',
  'Ethnicity, Race & Migration': 'Ethnicity, Race, & Migration',
  'History Science, Medicine & PH': 'History of Science, Medicine, & Public Health',
  'Lit. and Comparative Cultures': 'Literature & Comparative Cultures',
  'Molecular Biophysics & Biochem': 'Molecular Biophysics & Biochemistry',
  'Molecular,Cellular,Dev Biology': 'Molecular, Cellular, & Developmental Biology',
  'Molecular,Cellular,DevBio(Int)': 'Molecular, Cellular, & Developmental Biology (Int.)',
  'Near Eastern Languages & Civs': 'Near Eastern Languages & Civilizations',
  'Russian & E European Studies': 'Russian & East European Studies',
  "Women'sGender&SexualityStudies": "Women's, Gender, & Sexuality Studies",
};

const INTENSIVE_SUFFIX = /\s*\(int\.?\)\s*$/i;

export const normalizeMajorName = (value: string): string =>
  value
    .normalize('NFKC')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(INTENSIVE_SUFFIX, '')
    .replace(/&/g, ' and ')
    .replace(/[,.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const MAPPING_BY_NORMALIZED_NAME: ReadonlyMap<string, MajorTopicMapping> = new Map(
  Object.entries(MAJOR_TOPIC_MAP).map(([major, mapping]) => [normalizeMajorName(major), mapping]),
);

export function resolveMajorTopicMapping(
  yaliesMajor: string | null | undefined,
): MajorTopicMapping | null {
  if (typeof yaliesMajor !== 'string') return null;
  const trimmed = yaliesMajor.trim();
  if (!trimmed) return null;
  const fullName = YALIES_ABBREVIATED_MAJOR_NAMES[trimmed] ?? trimmed;
  return MAPPING_BY_NORMALIZED_NAME.get(normalizeMajorName(fullName)) ?? null;
}

export const hasPersonalizationSignal = (mapping: MajorTopicMapping | null): boolean =>
  mapping !== null && (mapping.researchAreas.length > 0 || mapping.departments.length > 0);
