import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import OpenAI from 'openai';
import { listingSchema } from '../server/src/models/listing';

// Load environment variables from server/.env
dotenv.config({ path: path.resolve(__dirname, '../server/.env') });

// =============================================================================
// CONFIGURATION
// =============================================================================

const BATCH_SIZE = 10;
const MODEL = 'gpt-4o-mini';
const MAX_KEYWORDS_PER_LISTING = 8;
const RATE_LIMIT_DELAY_MS = 500;

// =============================================================================
// ALIAS MAP: Maps commonly hallucinated / department-like names to valid areas
// The AI tends to suggest department names or slight variations - this catches them.
// =============================================================================

const ALIAS_MAP: Record<string, string> = {
  // Department names → proper research areas
  'american studies': 'American Politics',
  'american history': 'Modern History',
  'african american studies': 'Ethnic Studies',
  'hellenic studies': 'Classical Studies',
  'greek studies': 'Greek Studies',
  'roman studies': 'Roman Studies',
  'east asian studies': 'Asian Studies',
  'south asian studies': 'Asian Studies',
  'near eastern studies': 'Middle Eastern Studies',
  'slavic studies': 'Comparative Literature',
  'french studies': 'Comparative Literature',
  'german studies': 'Comparative Literature',
  'spanish studies': 'Comparative Literature',
  'italian studies': 'Comparative Literature',
  'portuguese studies': 'Comparative Literature',
  'english literature': 'Literature',
  'english studies': 'Literature',
  'women, gender, and sexuality studies': 'Gender Studies',
  'women\'s studies': 'Womens Studies',
  'womens and gender studies': 'Gender Studies',
  'public humanities': 'Digital Humanities',

  // Slight variations / common hallucinations
  'tuberculosis': 'Infectious Disease',
  'tuberculosis research': 'Infectious Disease',
  'laboratory research': 'Experimental Design',
  'interstellar medium': 'Astrophysics',
  'stellar physics': 'Astrophysics',
  'galactic astronomy': 'Astronomy',
  'extragalactic astronomy': 'Astronomy',
  'observational astronomy': 'Astronomy',
  'political history': 'Modern History',
  'social history': 'Social History',
  'intellectual history': 'Intellectual History',
  'environmental health': 'Public Health',
  'environmental health sciences': 'Public Health',
  'occupational health': 'Public Health',
  'microfinance': 'Development Economics',
  'economics of education': 'Education',
  'social inquiry': 'Sociology',
  'justice': 'Criminal Justice',
  'social justice': 'Human Rights',
  'cognitive science': 'Cognitive Psychology',
  'neurolinguistics': 'Psycholinguistics',
  'applied linguistics': 'Linguistics',
  'second language acquisition': 'Linguistics',
  'historical linguistics': 'Linguistics',
  'corpus linguistics': 'Computational Linguistics',
  'clinical research': 'Clinical Medicine',
  'biomedical engineering': 'Bioengineering',
  'biomedical research': 'Translational Medicine',
  'biomedical sciences': 'Translational Medicine',
  'molecular medicine': 'Molecular Biology',
  'molecular genetics': 'Genetics',
  'human genetics': 'Genetics',
  'medical genetics': 'Genetic Disorders',
  'developmental neuroscience': 'Neurobiology',
  'behavioral neuroscience': 'Neuroscience',
  'systems neuroscience': 'Neuroscience',
  'affective neuroscience': 'Neuroscience',
  'social neuroscience': 'Neuroscience',
  'cellular neuroscience': 'Neurobiology',
  'molecular neuroscience': 'Neurobiology',
  'clinical neuroscience': 'Neurology',
  'plant science': 'Plant Biology',
  'plant sciences': 'Plant Biology',
  'animal science': 'Zoology',
  'animal sciences': 'Zoology',
  'data science': 'Big Data Analytics',
  'information technology': 'Information Science',
  'computer science': 'Algorithm Design',
  'applied physics': 'Physics',
  'theoretical physics': 'Physics',
  'experimental physics': 'Physics',
  'applied chemistry': 'Chemistry',
  'earth sciences': 'Earth Science',
  'earth and planetary sciences': 'Planetary Science',
  'ocean engineering': 'Marine Science',
  'marine ecology': 'Marine Biology',
  'conservation ecology': 'Conservation Biology',
  'conservation genetics': 'Conservation Biology',
  'population ecology': 'Population Biology',
  'community ecology': 'Ecology',
  'tropical ecology': 'Ecology',
  'disease ecology': 'Epidemiology',
  'public administration': 'Public Policy',
  'nonprofit management': 'Public Policy',
  'organizational behavior': 'Behavioral Science',
  'management': 'Operations Research',
  'business administration': 'Finance',
  'entrepreneurship': 'Economics',
  'supply chain management': 'Operations Research',
  'marketing': 'Behavioral Economics',
  'strategic management': 'Industrial Organization',
  'real estate': 'Urban Economics',
  'property economics': 'Urban Economics',
  'health services research': 'Healthcare Systems',
  'health informatics': 'Medical Informatics',
  'bioinformatics and computational biology': 'Bioinformatics',
  'structural bioinformatics': 'Structural Biology',
  'chemical biology': 'Biochemistry',
  'medicinal chemistry': 'Drug Discovery',
  'pharmaceutical chemistry': 'Pharmaceutical Sciences',
  'food technology': 'Food Science',
  'food engineering': 'Food Science',
  'applied mathematics': 'Applied Mathematics',
  'pure mathematics': 'Pure Mathematics',
  'mathematical biology': 'Computational Biology',
  'mathematical finance': 'Financial Economics',
  'financial engineering': 'Financial Economics',
  'financial mathematics': 'Financial Economics',
  'actuarial science': 'Risk Management',
  'insurance': 'Risk Management',
  'biostatistics and epidemiology': 'Biostatistics',
  'statistical genetics': 'Population Genetics',
  'statistical learning': 'Machine Learning',
  'deep reinforcement learning': 'Reinforcement Learning',
  'language models': 'Large Language Models',
  'language modeling': 'Large Language Models',
  'image processing': 'Computer Vision',
  'image recognition': 'Computer Vision',
  'pattern recognition': 'Computer Vision',
  'medical physics': 'Nuclear Medicine',
  'health physics': 'Nuclear Medicine',
  'radiation therapy': 'Radiology',
  'radiation biology': 'Radiology',
  'nuclear science': 'Nuclear Physics',
  'materials engineering': 'Materials Science',
  'materials research': 'Materials Science',
  'polymer science': 'Polymer Chemistry',
  'textile science': 'Materials Science',
  'surface science': 'Surface Chemistry',
  'thin films': 'Materials Science',
  'quantum information': 'Quantum Computing',
  'quantum optics': 'Quantum Physics',
  'quantum field theory': 'Quantum Physics',
  'string theory': 'Quantum Physics',
  'general relativity': 'Physics',
  'gravitational physics': 'Physics',
  'computational physics': 'Physics',
  'nonlinear dynamics': 'Dynamical Systems',
  'complex systems': 'Dynamical Systems',
  'network science': 'Graph Theory',
  'network analysis': 'Graph Theory',
  'combinatorial optimization': 'Optimization',
  'mathematical optimization': 'Optimization',
  'convex optimization': 'Convex Analysis',
  'numerical optimization': 'Numerical Methods',
  'stochastic optimization': 'Stochastic Processes',
  'global studies': 'International Relations',
  'security studies': 'International Relations',
  'peace studies': 'International Relations',
  'conflict studies': 'International Relations',
  'foreign policy': 'International Relations',
  'diplomacy': 'International Relations',
  'geopolitics': 'Comparative Politics',
  'global governance': 'Governance',
  'urban development': 'Urban Studies',
  'urban design': 'Urban Planning',
  'landscape architecture': 'Architecture',
  'interior design': 'Design',
  'user experience design': 'Human-Computer Interaction',
  'interaction design': 'Human-Computer Interaction',
  'cultural heritage': 'Museum Studies',
  'heritage studies': 'Museum Studies',
  'archival studies': 'Library Science',
  'children\'s literature': 'Literature',
  'young adult literature': 'Literature',
  'narrative studies': 'Literary Theory',
  'narratology': 'Literary Theory',
  'discourse analysis': 'Rhetoric',
  'hermeneutics': 'Philosophy',
  'phenomenology': 'Philosophy of Mind',
  'existentialism': 'Philosophy',
  'pragmatism': 'Philosophy',
  'analytic philosophy': 'Philosophy',
  'continental philosophy': 'Philosophy',
  'moral philosophy': 'Ethics',
  'applied ethics': 'Ethics',
  'medical ethics': 'Bioethics',
  'research ethics': 'Bioethics',
  'neuroethics': 'Bioethics',
  'environmental ethics': 'Ethics',
  'business ethics': 'Ethics',
  'african american history': 'Social History',
  'latino studies': 'Latin American Studies',
  'chicano studies': 'Latin American Studies',
  'indigenous studies': 'Ethnic Studies',
  'native american studies': 'Ethnic Studies',
  'disability studies': 'Social Work',
  'aging studies': 'Aging Research',
  'gerontology': 'Geriatrics',
  'child development': 'Developmental Psychology',
  'adolescent development': 'Developmental Psychology',
  'human development': 'Developmental Psychology',
  'cognitive development': 'Developmental Psychology',
  'lifespan development': 'Developmental Psychology',
  'clinical social work': 'Social Work',
  'community health': 'Public Health',
  'preventive medicine': 'Public Health',
  'tropical medicine': 'Global Health',
  'substance abuse': 'Mental Health',
  'addiction research': 'Mental Health',
  'addiction': 'Mental Health',
  'sleep research': 'Chronobiology',
  'sleep medicine': 'Chronobiology',
  'exercise science': 'Sports Medicine',
  'kinesiology': 'Sports Medicine',
  'biomechanical engineering': 'Biomechanics',
};

// =============================================================================
// INTERFACES
// =============================================================================

interface ListingSummary {
  id: string;
  title: string;
  description: string;
  departments: string[];
  existingResearchAreas: string[];
  novelSuggestions: string[]; // Track novel areas AI suggested for this listing
}

interface KeywordResult {
  listingId: string;
  title: string;
  oldKeywords: string[];
  newKeywords: string[];
  skipped: boolean;
  reason?: string;
}

// =============================================================================
// BUILD SYSTEM PROMPT WITH ALL VALID RESEARCH AREAS (THE "AGENT" CONTEXT)
// =============================================================================

function buildSystemPrompt(validAreas: string[]): string {
  return `You are a research area classification agent for Yale University research listings.

Your job is to assign the most relevant research areas to each research listing based on its title, description, and departments.

CRITICAL RULES:
1. You MUST use ONLY research areas from the VALID LIST below. Do NOT create new ones.
2. Assign between 2 and ${MAX_KEYWORDS_PER_LISTING} research areas per listing.
3. Choose areas that best describe the core research focus.
4. Prefer specific areas over broad ones when the listing clearly focuses on a niche.
5. Consider the department context when choosing between similar areas.
6. DO NOT use department names as keywords. For example, do NOT return "American Studies" - instead use a specific research area like "American Politics" or "Ethnic Studies".
7. DO NOT invent variations of valid areas. Use the EXACT spelling from the list.
8. If you cannot find a perfect match, pick the closest valid area from the list rather than inventing a new one.

VALID RESEARCH AREAS (use EXACT names from this list ONLY):
${validAreas.join('\n')}

You will receive a batch of listings. For each listing, respond with a JSON object mapping the listing ID to an array of research area names.

Response format (strict JSON, no markdown):
{
  "listing_id_1": ["Area 1", "Area 2", "Area 3"],
  "listing_id_2": ["Area 1", "Area 2"]
}`;
}

function buildUserPrompt(listings: ListingSummary[]): string {
  const entries = listings.map((l, i) => {
    return `--- Listing ${i + 1} ---
ID: ${l.id}
Title: ${l.title}
Description: ${l.description.substring(0, 500)}
Departments: ${l.departments.join(', ') || 'None'}`;
  });

  return `Classify the following ${listings.length} research listings. Assign 2-${MAX_KEYWORDS_PER_LISTING} research areas to each. Use ONLY exact names from the valid research areas list provided in the system message. Do NOT invent new area names or use department names.\n\n${entries.join('\n\n')}`;
}

// =============================================================================
// OPENAI CALL WITH RETRY
// =============================================================================

async function callOpenAI(
  client: OpenAI,
  systemPrompt: string,
  userPrompt: string,
  retries: number = 3
): Promise<Record<string, string[]>> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await client.chat.completions.create({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.2,
        response_format: { type: 'json_object' }
      });

      const content = response.usage
        ? (console.log(`  Tokens: ${response.usage.total_tokens}`), response.choices[0]?.message?.content)
        : response.choices[0]?.message?.content;

      if (!content) {
        throw new Error('Empty response from OpenAI');
      }

      return JSON.parse(content);
    } catch (error: any) {
      if (attempt < retries && (error?.status === 429 || error?.status === 500 || error?.status === 503)) {
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`  Retry ${attempt}/${retries} after ${delay}ms (${error?.status || 'unknown'} error)`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        throw error;
      }
    }
  }
  throw new Error('Max retries exceeded');
}

// =============================================================================
// RESOLVE AREA: Try alias map, then fuzzy match, then reject
// =============================================================================

function resolveArea(
  area: string,
  validAreaSet: Set<string>,
  validAreaLower: Map<string, string>
): { resolved: string | null; wasAlias: boolean; wasNovel: boolean } {
  // 1. Exact match
  if (validAreaSet.has(area)) {
    return { resolved: area, wasAlias: false, wasNovel: false };
  }

  const areaLower = area.toLowerCase().trim();

  // 2. Case-insensitive match
  const caseMatch = validAreaLower.get(areaLower);
  if (caseMatch) {
    return { resolved: caseMatch, wasAlias: false, wasNovel: false };
  }

  // 3. Alias map
  const aliasMatch = ALIAS_MAP[areaLower];
  if (aliasMatch && validAreaSet.has(aliasMatch)) {
    return { resolved: aliasMatch, wasAlias: true, wasNovel: false };
  }

  // 4. Not resolvable - this is a novel suggestion
  return { resolved: null, wasAlias: false, wasNovel: true };
}

// =============================================================================
// DEDUPE NOVEL AREAS: Prune duplicates, near-duplicates, and substrings
// =============================================================================

function dedupeNovelAreas(novelAreas: Map<string, number>): Map<string, number> {
  const entries = Array.from(novelAreas.entries());
  const deduped = new Map<string, number>();

  // Sort by count (highest first) so we keep the most popular variant
  entries.sort((a, b) => b[1] - a[1]);

  for (const [area, count] of entries) {
    const areaLower = area.toLowerCase().trim();

    // Skip if this is a substring/variant of something we already kept
    let isDuplicate = false;
    for (const kept of deduped.keys()) {
      const keptLower = kept.toLowerCase();

      // Check substring match (e.g., "Tuberculosis" vs "Tuberculosis Research")
      if (areaLower.includes(keptLower) || keptLower.includes(areaLower)) {
        isDuplicate = true;
        // Add count to the existing entry
        deduped.set(kept, deduped.get(kept)! + count);
        break;
      }

      // Check very similar (Levenshtein-like: same words, different order)
      const areaWords = new Set(areaLower.split(/\s+/));
      const keptWords = new Set(keptLower.split(/\s+/));
      const intersection = new Set([...areaWords].filter(w => keptWords.has(w)));
      if (intersection.size >= Math.min(areaWords.size, keptWords.size) && intersection.size > 0) {
        isDuplicate = true;
        deduped.set(kept, deduped.get(kept)! + count);
        break;
      }
    }

    if (!isDuplicate) {
      deduped.set(area, count);
    }
  }

  return deduped;
}

// =============================================================================
// RESEARCH FIELD CLASSIFICATION: Use OpenAI to categorize novel areas
// =============================================================================

const VALID_FIELDS = [
  "Computing & Artificial Intelligence",
  "Life Sciences & Biology",
  "Physical Sciences & Engineering",
  "Health & Medicine",
  "Social Sciences",
  "Humanities & Arts",
  "Environmental Sciences",
  "Economics",
  "Mathematics"
];

const FIELD_COLOR_KEYS: Record<string, string> = {
  "Computing & Artificial Intelligence": "blue",
  "Life Sciences & Biology": "green",
  "Physical Sciences & Engineering": "yellow",
  "Health & Medicine": "red",
  "Social Sciences": "purple",
  "Humanities & Arts": "pink",
  "Environmental Sciences": "teal",
  "Economics": "orange",
  "Mathematics": "indigo"
};

/**
 * Uses OpenAI to classify novel research areas into the correct field categories.
 * Batches all areas into a single API call for efficiency.
 */
async function classifyNovelAreas(
  client: OpenAI,
  areaNames: string[]
): Promise<Map<string, { field: string; colorKey: string }>> {
  const result = new Map<string, { field: string; colorKey: string }>();

  if (areaNames.length === 0) return result;

  const systemPrompt = `You are a research area classifier. Given a list of research area names, classify each one into exactly ONE of these fields:

${VALID_FIELDS.map((f, i) => `${i + 1}. ${f}`).join('\n')}

Respond with strict JSON mapping each area name to its field name. Use the EXACT field names listed above.

Example:
{
  "Quantum Optics": "Physical Sciences & Engineering",
  "African American History": "Humanities & Arts",
  "Behavioral Finance": "Economics"
}`;

  const userPrompt = `Classify these research areas:\n${areaNames.map(n => `- ${n}`).join('\n')}`;

  try {
    const response = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.1,
      response_format: { type: 'json_object' }
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      console.log('  WARNING: Empty response from classification call, using fallback');
      for (const name of areaNames) {
        result.set(name, { field: 'Social Sciences', colorKey: 'purple' });
      }
      return result;
    }

    const classifications = JSON.parse(content) as Record<string, string>;
    const validFieldSet = new Set(VALID_FIELDS);

    for (const name of areaNames) {
      const field = classifications[name];
      if (field && validFieldSet.has(field)) {
        result.set(name, { field, colorKey: FIELD_COLOR_KEYS[field] || 'gray' });
      } else {
        // Fallback if GPT returned an invalid field
        result.set(name, { field: 'Social Sciences', colorKey: 'purple' });
      }
    }

    if (response.usage) {
      console.log(`  Classification tokens: ${response.usage.total_tokens}`);
    }
  } catch (error: any) {
    console.error(`  ERROR classifying novel areas: ${error.message}, using fallback`);
    for (const name of areaNames) {
      result.set(name, { field: 'Social Sciences', colorKey: 'purple' });
    }
  }

  return result;
}

// =============================================================================
// MAIN MIGRATION FUNCTION
// =============================================================================

async function generateKeywords(dryRun: boolean = true, forceMode: boolean = false) {
  const prodUrl = process.env.MONGODBURL;
  const migrationUrl = process.env.MONGODBURL_MIGRATION;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!prodUrl) {
    console.error('ERROR: MONGODBURL (Production) not set');
    process.exit(1);
  }
  if (!migrationUrl) {
    console.error('ERROR: MONGODBURL_MIGRATION (ProductionMigration) not set');
    process.exit(1);
  }
  if (!openaiKey) {
    console.error('ERROR: OPENAI_API_KEY not set');
    process.exit(1);
  }

  console.log('\n' + '='.repeat(80));
  console.log('RESEARCH AREA KEYWORD GENERATION');
  console.log('='.repeat(80));
  const modeLabel = forceMode ? 'LIVE-FORCE (re-process ALL listings)' : dryRun ? 'DRY RUN (no changes)' : 'LIVE (changes will be applied)';
  console.log(`Mode: ${modeLabel}`);
  console.log(`Model: ${MODEL}`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log(`Max keywords per listing: ${MAX_KEYWORDS_PER_LISTING}`);
  console.log('='.repeat(80) + '\n');

  const openai = new OpenAI({ apiKey: openaiKey });
  const results: KeywordResult[] = [];

  // Track novel areas suggested by AI that aren't in the valid list or alias map
  const novelAreaCounts = new Map<string, number>();
  // Track alias resolutions
  const aliasResolutions = new Map<string, { to: string; count: number }>();

  let prodConnection: mongoose.Connection | null = null;
  let migrationConnection: mongoose.Connection | null = null;

  try {
    // Connect to Production for research areas
    console.log('Connecting to Production database (for research areas)...');
    prodConnection = await mongoose.createConnection(prodUrl).asPromise();
    console.log('Connected to Production\n');

    // Connect to ProductionMigration for listings
    console.log('Connecting to ProductionMigration database (for listings)...');
    migrationConnection = await mongoose.createConnection(migrationUrl).asPromise();
    console.log('Connected to ProductionMigration\n');

    // Load valid research area names from Production
    const researchAreaSchema = new mongoose.Schema({
      name: String,
      field: String,
      colorKey: String,
      addedBy: String,
      isDefault: Boolean,
    }, { timestamps: true });
    researchAreaSchema.index({ name: 'text' });
    researchAreaSchema.index({ field: 1 });

    const ResearchAreaModel = prodConnection.model('researchAreas', researchAreaSchema);

    console.log('Loading valid research areas from Production...');
    const researchAreaDocs = await ResearchAreaModel.find({}).lean();
    const validAreaNames = researchAreaDocs.map((doc: any) => doc.name as string).sort();
    console.log(`Loaded ${validAreaNames.length} valid research areas\n`);

    // Build lookup structures
    const validAreaSet = new Set(validAreaNames);
    const validAreaLower = new Map<string, string>();
    for (const name of validAreaNames) {
      validAreaLower.set(name.toLowerCase(), name);
    }

    // Build the system prompt once (the "agent" context)
    const systemPrompt = buildSystemPrompt(validAreaNames);

    // Create Listing model on migration connection
    const ListingModel = migrationConnection.model('listings', listingSchema);

    // Fetch all listings from ProductionMigration
    console.log('Fetching listings from ProductionMigration...');
    const listings = await ListingModel.find({}).lean();
    console.log(`Found ${listings.length} total listings\n`);

    // Filter to only listings that need keywords
    const needsKeywords: ListingSummary[] = [];
    for (const listing of listings) {
      const existing = (listing.researchAreas as string[]) || [];
      const hasDescription = !!(listing.description as string)?.trim();

      if (existing.length > 0 && !forceMode) {
        results.push({
          listingId: (listing._id as any).toString(),
          title: listing.title as string,
          oldKeywords: existing,
          newKeywords: existing,
          skipped: true,
          reason: `Already has ${existing.length} research areas`
        });
        continue;
      }

      if (!hasDescription) {
        results.push({
          listingId: (listing._id as any).toString(),
          title: listing.title as string,
          oldKeywords: [],
          newKeywords: [],
          skipped: true,
          reason: 'No description to classify'
        });
        continue;
      }

      needsKeywords.push({
        id: (listing._id as any).toString(),
        title: listing.title as string || '',
        description: (listing.description as string) || '',
        departments: (listing.departments as string[]) || [],
        existingResearchAreas: existing,
        novelSuggestions: []
      });
    }

    console.log(`Listings needing keywords: ${needsKeywords.length}`);
    console.log(`Listings skipped (already have keywords): ${results.filter(r => r.skipped && r.reason?.includes('Already')).length}`);
    console.log(`Listings skipped (no description): ${results.filter(r => r.skipped && r.reason?.includes('No description')).length}\n`);

    if (needsKeywords.length === 0) {
      console.log('No listings need keyword generation. Done!\n');
      await prodConnection.close();
      await migrationConnection.close();
      return;
    }

    // Process in batches
    const totalBatches = Math.ceil(needsKeywords.length / BATCH_SIZE);
    console.log(`Processing ${needsKeywords.length} listings in ${totalBatches} batches...\n`);

    const bulkOps: any[] = [];

    for (let i = 0; i < needsKeywords.length; i += BATCH_SIZE) {
      const batch = needsKeywords.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      console.log(`Batch ${batchNum}/${totalBatches} (${batch.length} listings)...`);

      try {
        const userPrompt = buildUserPrompt(batch);
        const response = await callOpenAI(openai, systemPrompt, userPrompt);

        for (const listing of batch) {
          const assignedAreas = response[listing.id];

          if (!assignedAreas || !Array.isArray(assignedAreas)) {
            console.log(`  WARNING: No result for "${listing.title}"`);
            results.push({
              listingId: listing.id,
              title: listing.title,
              oldKeywords: [],
              newKeywords: [],
              skipped: true,
              reason: 'No result from OpenAI'
            });
            continue;
          }

          // Resolve each area through exact match → case-insensitive → alias → novel
          const resolvedAreas: string[] = [];
          const seenAreas = new Set<string>(); // dedupe within a listing

          for (const area of assignedAreas) {
            const { resolved, wasAlias, wasNovel } = resolveArea(area, validAreaSet, validAreaLower);

            if (resolved) {
              if (!seenAreas.has(resolved)) {
                seenAreas.add(resolved);
                resolvedAreas.push(resolved);
              }
              if (wasAlias) {
                const key = area.toLowerCase().trim();
                const existing = aliasResolutions.get(key);
                if (existing) {
                  existing.count++;
                } else {
                  aliasResolutions.set(key, { to: resolved, count: 1 });
                }
              }
            } else if (wasNovel) {
              // Track this novel suggestion globally and per-listing
              const key = area.trim();
              novelAreaCounts.set(key, (novelAreaCounts.get(key) || 0) + 1);
              listing.novelSuggestions.push(key);
            }
          }

          results.push({
            listingId: listing.id,
            title: listing.title,
            oldKeywords: [],
            newKeywords: resolvedAreas,
            skipped: false
          });

          if (!dryRun && resolvedAreas.length > 0) {
            bulkOps.push({
              updateOne: {
                filter: { _id: new mongoose.Types.ObjectId(listing.id) },
                update: { $set: { researchAreas: resolvedAreas, keywords: resolvedAreas } }
              }
            });
          }
        }
      } catch (error: any) {
        console.error(`  ERROR in batch ${batchNum}: ${error.message}`);
        for (const listing of batch) {
          results.push({
            listingId: listing.id,
            title: listing.title,
            oldKeywords: [],
            newKeywords: [],
            skipped: true,
            reason: `API error: ${error.message}`
          });
        }
      }

      if (i + BATCH_SIZE < needsKeywords.length) {
        await new Promise(r => setTimeout(r, RATE_LIMIT_DELAY_MS));
      }
    }

    // Execute listing keyword updates
    if (!dryRun && bulkOps.length > 0) {
      console.log(`\nExecuting ${bulkOps.length} listing keyword updates...`);
      const result = await ListingModel.bulkWrite(bulkOps);
      console.log(`Modified: ${result.modifiedCount}`);
    }

    // =========================================================================
    // HANDLE NOVEL AREAS: Dedupe, prune, and add to researchAreas collection
    // =========================================================================

    const dedupedNovel = dedupeNovelAreas(novelAreaCounts);
    // Only add novel areas that were suggested 2+ times (reduces noise)
    const MIN_OCCURRENCES = 2;
    const areasToAdd = Array.from(dedupedNovel.entries())
      .filter(([_, count]) => count >= MIN_OCCURRENCES)
      .sort((a, b) => b[1] - a[1]);

    if (areasToAdd.length > 0) {
      console.log('\n' + '-'.repeat(60));
      console.log(`NEW RESEARCH AREAS TO ADD (suggested ${MIN_OCCURRENCES}+ times)`);
      console.log('-'.repeat(60) + '\n');

      // Classify all novel areas into fields using OpenAI
      const areaNames = areasToAdd.map(([name]) => name);
      console.log(`Classifying ${areaNames.length} novel areas into research fields...`);
      const classifications = await classifyNovelAreas(openai, areaNames);

      const newAreaOps: any[] = [];

      for (const [areaName, count] of areasToAdd) {
        const { field, colorKey } = classifications.get(areaName) || { field: 'Social Sciences', colorKey: 'purple' };
        console.log(`  "${areaName}" (${count}x) -> ${field}`);

        if (!dryRun) {
          newAreaOps.push({
            updateOne: {
              filter: { name: areaName },
              update: {
                $setOnInsert: {
                  name: areaName,
                  field,
                  colorKey,
                  isDefault: false,
                  addedBy: 'migration-agent',
                }
              },
              upsert: true
            }
          });
        }
      }

      if (!dryRun && newAreaOps.length > 0) {
        console.log(`\nAdding ${newAreaOps.length} new research areas to Production...`);
        const result = await ResearchAreaModel.bulkWrite(newAreaOps);
        console.log(`Inserted: ${result.upsertedCount}, Already existed: ${result.matchedCount}`);
      }

      // Build set of accepted novel area names for second pass
      const acceptedNovelNames = new Set(areasToAdd.map(([name]) => name));

      // Second pass: append accepted novel areas to the listings that triggered them
      if (acceptedNovelNames.size > 0) {
        const novelAppendOps: any[] = [];
        let novelAppendCount = 0;

        for (const listing of needsKeywords) {
          if (listing.novelSuggestions.length === 0) continue;

          const novelToAdd = listing.novelSuggestions.filter(n => acceptedNovelNames.has(n));
          if (novelToAdd.length === 0) continue;

          // Find this listing's current result and append
          const resultEntry = results.find(r => r.listingId === listing.id && !r.skipped);
          if (resultEntry) {
            const existingSet = new Set(resultEntry.newKeywords);
            const deduped = novelToAdd.filter(n => !existingSet.has(n));
            if (deduped.length > 0) {
              resultEntry.newKeywords.push(...deduped);
              novelAppendCount += deduped.length;

              if (!dryRun) {
                novelAppendOps.push({
                  updateOne: {
                    filter: { _id: new mongoose.Types.ObjectId(listing.id) },
                    update: { $addToSet: { researchAreas: { $each: deduped }, keywords: { $each: deduped } } }
                  }
                });
              }
            }
          }
        }

        if (novelAppendCount > 0) {
          console.log(`\nAppending ${novelAppendCount} novel areas back to listings that triggered them...`);
          if (!dryRun && novelAppendOps.length > 0) {
            const appendResult = await ListingModel.bulkWrite(novelAppendOps);
            console.log(`Updated ${appendResult.modifiedCount} listings with novel areas`);
          }
        }
      }
    }

    // =========================================================================
    // PRINT RESULTS
    // =========================================================================

    console.log('\n' + '='.repeat(80));
    console.log('RESULTS');
    console.log('='.repeat(80) + '\n');

    const updated = results.filter(r => !r.skipped && r.newKeywords.length > 0);
    const skipped = results.filter(r => r.skipped);
    const failed = results.filter(r => !r.skipped && r.newKeywords.length === 0);

    console.log(`Total listings: ${listings.length}`);
    console.log(`Keywords generated: ${updated.length}`);
    console.log(`Skipped: ${skipped.length}`);
    if (failed.length > 0) console.log(`Failed: ${failed.length}`);

    if (updated.length > 0) {
      const avgKeywords = updated.reduce((sum, r) => sum + r.newKeywords.length, 0) / updated.length;
      console.log(`Average keywords per listing: ${avgKeywords.toFixed(1)}`);
    }

    // Alias resolution summary
    if (aliasResolutions.size > 0) {
      console.log('\n' + '-'.repeat(60));
      console.log('ALIAS RESOLUTIONS (remapped suggestions)');
      console.log('-'.repeat(60) + '\n');
      const sorted = Array.from(aliasResolutions.entries()).sort((a, b) => b[1].count - a[1].count);
      for (const [from, { to, count }] of sorted.slice(0, 30)) {
        console.log(`  "${from}" -> "${to}" (${count}x)`);
      }
      if (sorted.length > 30) {
        console.log(`  ... and ${sorted.length - 30} more`);
      }
    }

    // Novel areas that were too rare to add
    const tooRare = Array.from(dedupedNovel.entries())
      .filter(([_, count]) => count < MIN_OCCURRENCES)
      .sort((a, b) => b[1] - a[1]);
    if (tooRare.length > 0) {
      console.log('\n' + '-'.repeat(60));
      console.log(`NOVEL AREAS REJECTED (appeared < ${MIN_OCCURRENCES} times)`);
      console.log('-'.repeat(60) + '\n');
      for (const [area, count] of tooRare.slice(0, 20)) {
        console.log(`  "${area}" (${count}x)`);
      }
      if (tooRare.length > 20) {
        console.log(`  ... and ${tooRare.length - 20} more`);
      }
    }

    // Sample of generated keywords
    if (updated.length > 0) {
      console.log('\n' + '-'.repeat(60));
      console.log(`GENERATED KEYWORDS ${dryRun ? '(preview)' : '(applied)'} - first 20`);
      console.log('-'.repeat(60) + '\n');
      for (const result of updated.slice(0, 20)) {
        console.log(`  "${result.title}"`);
        console.log(`    -> ${result.newKeywords.join(', ')}`);
      }
      if (updated.length > 20) {
        console.log(`  ... and ${updated.length - 20} more`);
      }
    }

    // Skip reasons
    const skipReasons = new Map<string, number>();
    for (const r of skipped) {
      const reason = r.reason || 'unknown';
      skipReasons.set(reason, (skipReasons.get(reason) || 0) + 1);
    }
    if (skipReasons.size > 0) {
      console.log('\n' + '-'.repeat(60));
      console.log('SKIP REASONS');
      console.log('-'.repeat(60) + '\n');
      for (const [reason, count] of Array.from(skipReasons.entries()).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${reason}: ${count}`);
      }
    }

    await prodConnection.close();
    await migrationConnection.close();
    console.log('\nDisconnected from databases');

    if (dryRun && updated.length > 0) {
      console.log('\n' + '='.repeat(80));
      console.log('To apply these changes, run with --live flag:');
      console.log('  npm run generate:keywords:live');
      console.log('To re-process ALL listings (including ones with existing keywords):');
      console.log('  npm run generate:keywords:force');
      console.log('='.repeat(80) + '\n');
    }

  } catch (error) {
    console.error('Fatal error:', error);
    if (prodConnection) await prodConnection.close();
    if (migrationConnection) await migrationConnection.close();
    process.exit(1);
  }
}

// =============================================================================
// CLASSIFY-ONLY MODE: Re-classify migration-agent areas that have wrong fields
// =============================================================================

async function classifyExistingAreas() {
  const prodUrl = process.env.MONGODBURL;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!prodUrl || !openaiKey) {
    console.error('ERROR: MONGODBURL and OPENAI_API_KEY must be set');
    process.exit(1);
  }

  console.log('\n' + '='.repeat(80));
  console.log('CLASSIFY EXISTING RESEARCH AREAS');
  console.log('='.repeat(80) + '\n');

  const openai = new OpenAI({ apiKey: openaiKey });
  let prodConnection: mongoose.Connection | null = null;

  try {
    prodConnection = await mongoose.createConnection(prodUrl).asPromise();
    console.log('Connected to Production\n');

    const researchAreaSchema = new mongoose.Schema({
      name: String,
      field: String,
      colorKey: String,
      addedBy: String,
      isDefault: Boolean,
    }, { timestamps: true });
    researchAreaSchema.index({ name: 'text' });
    researchAreaSchema.index({ field: 1 });

    const ResearchAreaModel = prodConnection.model('researchAreas', researchAreaSchema);

    // Find areas added by migration-agent that may need reclassification
    const agentAreas = await ResearchAreaModel.find({ addedBy: 'migration-agent' }).lean();
    console.log(`Found ${agentAreas.length} areas added by migration-agent\n`);

    if (agentAreas.length === 0) {
      console.log('No areas to classify. Done!\n');
      await prodConnection.close();
      return;
    }

    const areaNames = agentAreas.map((a: any) => a.name as string);

    console.log('Classifying with OpenAI...');
    const classifications = await classifyNovelAreas(openai, areaNames);

    const updateOps: any[] = [];
    let changedCount = 0;

    for (const area of agentAreas as any[]) {
      const classification = classifications.get(area.name);
      if (!classification) continue;

      const oldField = area.field;
      const newField = classification.field;
      const newColor = classification.colorKey;

      if (oldField !== newField || area.colorKey !== newColor) {
        changedCount++;
        console.log(`  "${area.name}": "${oldField}" -> "${newField}"`);
        updateOps.push({
          updateOne: {
            filter: { _id: area._id },
            update: { $set: { field: newField, colorKey: newColor } }
          }
        });
      } else {
        console.log(`  "${area.name}": "${oldField}" (no change)`);
      }
    }

    if (updateOps.length > 0) {
      console.log(`\nUpdating ${updateOps.length} areas...`);
      const result = await ResearchAreaModel.bulkWrite(updateOps);
      console.log(`Modified: ${result.modifiedCount}`);
    } else {
      console.log('\nAll areas already correctly classified.');
    }

    console.log(`\nSummary: ${changedCount} reclassified, ${agentAreas.length - changedCount} unchanged`);

    await prodConnection.close();
    console.log('Disconnected from database\n');

  } catch (error) {
    console.error('Fatal error:', error);
    if (prodConnection) await prodConnection.close();
    process.exit(1);
  }
}

// =============================================================================
// ENTRY POINT
// =============================================================================

const args = process.argv.slice(2);
const classifyOnly = args.includes('--classify');
const forceMode = args.includes('--live-force');
const dryRun = !args.includes('--live') && !forceMode && !classifyOnly;

if (classifyOnly) {
  classifyExistingAreas().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
} else {
  generateKeywords(dryRun, forceMode).catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
