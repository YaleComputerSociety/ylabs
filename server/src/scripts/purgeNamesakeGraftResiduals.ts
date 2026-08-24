/**
 * Drain the individually verified #1413 (wrong-person description narrative)
 * and #1407 (wrong-person researchAreas) namesake-graft residuals still live
 * on `student_ready` (and two pending `operator_review`) entities.
 *
 * Every prior purge in this graft family (#1256, #1290, #604) was scoped to a
 * hand-verified set of exact strings still present on a named entity, because a
 * broad "off-topic" filter over-purges genuine interdisciplinary scholars; this
 * follows the same pattern (`purgeNamesakeGraftResidualsCore.ts`) rather than
 * introducing a new heuristic classifier. Each entity below was read fresh from
 * Development immediately before this list was written, so entries already
 * self-corrected (`glahn-lab-dcg32`, `nih-pi-sarah-taylor` no longer cite their
 * reported wrong-person sourceUrls) are intentionally omitted rather than
 * re-verified against stale audit-comment snapshots.
 *
 * Round 3 (this batch) adds 10 more entries surfaced by a fresh #1407 audit
 * (FACULTY_RESEARCH_AREA humanities/social-science faculty carrying wrong-
 * domain biomedical or cross-language area chips) plus a CENTER and a
 * PROGRAM entity whose grafts trace to a different mechanism (research-area
 * extractor mis-scoping, not the identity-resolver namesake merge) - see the
 * per-entry comments below. `kraus-csk33`, flagged as borderline in the same
 * audit, is intentionally excluded: only one of its five areas ("Biblical
 * Studies and Interpretation") is even arguably off-field for a Latin
 * historiographer, which is not the unambiguous-graft bar this list holds to.
 *
 *   yarn --cwd server tsx src/scripts/purgeNamesakeGraftResiduals.ts               # dry-run
 *   yarn --cwd server tsx src/scripts/purgeNamesakeGraftResiduals.ts --apply \
 *     --confirm-namesake-graft-purge
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { Observation } from '../models/observation';
import { syncEntities } from '../services/meiliSyncService';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  planNamesakeGraftCleanup,
  summarizeNamesakeGraftPlans,
  type NamesakeGraftDirective,
} from './purgeNamesakeGraftResidualsCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const VERIFIED_GRAFTS: NamesakeGraftDirective[] = [
  {
    entityId: '6a058e29ba66f3c14bd8701b',
    slug: 'horwitz-lab-cmh6',
    removeAreas: [
      'Pneumonia and Respiratory Infections',
      'Bacterial Infections and Vaccines',
      'Influenza Virus Research Studies',
      'Vibrio bacteria research studies',
      'Vitamin C and Antioxidants Research',
    ],
  },
  {
    entityId: '6a0d17e83fa399fefb6e625b',
    slug: 'faculty-research-area-rex-ying',
    removeAreas: ['Neuroscience', 'Psychology', 'Developmental Biology', 'Immunotherapy'],
    clearFullDescriptionIfEquals:
      "Rex Ying's research focuses on immunotherapy and immune responses, particularly in the context of vaccines and immunoinformatics approaches. He also explores digital imaging techniques to study blood diseases, aiming to enhance understanding and treatment of these conditions.",
    clearShortDescriptionIfEquals:
      'Rex Ying studies immunotherapy, vaccines, and digital imaging for blood diseases.',
    clearStudentDecisionExplanationIfExplanationEquals:
      'Consider reaching out to explore potential opportunities in immunotherapy and related fields.',
  },
  {
    entityId: '6a057e2913fc60d57ec2b06f',
    slug: 'nih-pi-pei-yu-chen',
    clearFullDescriptionIfEquals:
      'The Pei-Yu Chen Lab focuses on research in semiconductor lasers and optical devices, as well as photonic and optical devices. Additionally, the lab explores conducting polymers and their various applications.',
    clearShortDescriptionIfEquals:
      'The Pei-Yu Chen Lab investigates semiconductor lasers, optical devices, and conducting polymers.',
  },
  {
    entityId: '6a056c9014107ca43f8a7491',
    slug: 'dept-statistics-p-m-aronow',
    removeAreas: ['Electrical Engineering', 'Biochemistry', 'Biophysics', 'Forestry'],
  },
  {
    entityId: '6a057e3b13fc60d57ec2b4c2',
    slug: 'nih-pi-r-constable',
    removeAreas: [
      'Social Work Education and Practice',
      'Diverse Education Studies and Reforms',
      'Family and Disability Support Research',
      'Counseling, Therapy, and Family Dynamics',
      'Early Childhood Education and Development',
    ],
  },
  {
    entityId: '6a057dd713fc60d57ec29db4',
    slug: 'nih-pi-margaret-lind',
    removeAreas: [
      'Jewish and Middle Eastern Studies',
      'Memory, Trauma, and Commemoration',
      'Italian Fascism and Post-war Society',
      'Photography and Visual Culture',
      'European history and politics',
      'Middle Eastern Studies',
    ],
  },
  {
    entityId: '6a057df813fc60d57ec2a501',
    slug: 'nih-pi-deepak-d-souza',
    removeAreas: [
      'Semantic Web and Ontologies',
      'Data Quality and Management',
      'Scientific Computing and Data Management',
      'Paranormal Experiences and Beliefs',
    ],
  },
  {
    entityId: '6a057e4e13fc60d57ec2b956',
    slug: 'nih-pi-daniel-o-neil',
    removeAreas: ['Japanese History and Culture'],
  },
  {
    entityId: '6a057e4813fc60d57ec2b778',
    slug: 'nih-pi-hanah-georges',
    removeAreas: ['Animal Disease Management and Epidemiology', 'Vector-Borne Animal Diseases'],
  },
  {
    entityId: '6a64724818a92957f5bec930',
    slug: 'nsf-pi-67d8926f50621bcef4349def',
    removeAreas: ['Fuel Cells'],
    clearFullDescriptionIfEquals:
      'The Junliang Shen Lab focuses on membrane-based ion separation techniques and membrane separation technologies, exploring their applications in fuel cells and related materials. The research investigates the efficiency and effectiveness of these methods in various contexts.',
    clearShortDescriptionIfEquals:
      'The Junliang Shen Lab studies membrane-based ion separation techniques and their applications in fuel cells.',
  },
  {
    // The document-only clear applied here previously (see git history) was
    // not durable: this entity has an active (superseded: false)
    // lab-microsite-description-llm observation for both fields, so the next
    // materialize re-derived the exact same wrong-person text from it and the
    // record round-tripped back to student_ready. Superseding the two
    // observation ids below alongside the clear stops materialize from
    // reintroducing it again.
    entityId: '6a058d55ba66f3c14bd857d5',
    slug: 'peters-jdp52',
    clearFullDescriptionIfEquals:
      'Dr. Peters studies disorders of the central nervous system, including Multiple Sclerosis, Neuromyelitis Optica, transverse myelitis, and autoimmune encephalitis. His research emphasizes patient-centered care and the development of individualized, comprehensive treatment plans for these conditions.',
    clearShortDescriptionIfEquals:
      'Dr. Peters studies central nervous system disorders and emphasizes patient-centered care.',
    supersedeObservationIds: ['6a8b053c03ef747fd68753ee', '6a8b053c03ef747fd68753ef'],
  },
  {
    entityId: '6a058d48ba66f3c14bd856e8',
    slug: 'lin-pl98',
    removeAreas: [
      'Hearing Loss and Rehabilitation',
      'Hearing, Cochlea, Tinnitus, Genetics',
      'Neuroscience and Neuropharmacology Research',
      'Stress Responses and Cortisol',
      'Neural dynamics and brain function',
    ],
  },
  {
    entityId: '6a057e3013fc60d57ec2b202',
    slug: 'nih-pi-carissa-chan',
    removeAreas: [
      'Artificial Intelligence in Healthcare and Education',
      'Gastrointestinal Bleeding Diagnosis and Treatment',
      'FinTech, Crowdfunding, Digital Finance',
      'Machine Learning in Healthcare',
      'Statistical Methods and Inference',
      'Artificial Intelligence',
    ],
  },
  {
    entityId: '6a058d1dba66f3c14bd853fa',
    slug: 'ramachandran-ar287',
    removeAreas: [
      'Neurobiology of Language and Bilingualism',
      'Pharmaceutical Practices and Patient Outcomes',
      'Interpreting and Communication in Healthcare',
    ],
  },
  {
    entityId: '6a54485ff3b13b89b5c532aa',
    slug: 'ysm-geibel-lab',
    removeAreas: ['Modernist Literature and Criticism'],
  },
  {
    entityId: '6a058d62ba66f3c14bd858d1',
    slug: 'geibel-lab-geibel',
    removeAreas: ['Modernist Literature and Criticism'],
  },
  {
    entityId: '6a058d08ba66f3c14bd85283',
    slug: 'foster-bfoster',
    removeAreas: [
      'Liver Disease and Transplantation',
      'Liver Disease Diagnosis and Treatment',
      'Pancreatitis Pathology and Treatment',
    ],
  },
  {
    entityId: '6a058e49ba66f3c14bd8725e',
    slug: 'fiss-omf2',
    removeAreas: ['Islamic Law and Civilization'],
    clearShortDescriptionIfEquals: 'Studies Islamic Law and Civilization.',
  },
  {
    // Grafted areas laundered into a fluent "The X Lab focuses on..."
    // description (soft-robotics PI served an Optics/Photonics/Semiconductor
    // Lasers narrative); the entity's own recentGrants (2024 Waterman Award,
    // granular metamaterials) are unambiguously soft robotics/materials science.
    entityId: '6a64722718a92957f5bec46d',
    slug: 'nsf-pi-67d8922b50621bcef4348f57',
    removeAreas: ['Optics', 'Photonics'],
    clearFullDescriptionIfEquals:
      'The Rebecca Kramer-Bottiglio Lab focuses on research in Optical Network Technologies, Photonic and Optical Devices, and Semiconductor Lasers and Optical Devices. The lab investigates the development and application of these technologies to advance the field of optics and photonics.',
    clearShortDescriptionIfEquals:
      'The lab studies Optical Network Technologies and Photonic Devices.',
  },
  {
    // Disease-ecology lab (Colin Carlson, VERENA host-virus network per its own
    // recentGrants/sourceUrls) carrying an unrelated geochemistry graft cluster.
    // fullDescription is already correct, so only the areas need stripping.
    entityId: '6a057f10fab31be25f983b2a',
    slug: 'nsf-pi-67d891de50621bcef4347f97',
    removeAreas: [
      'Geological and Geochemical Analysis',
      'Calibration and Measurement Techniques',
      'Geochemistry and Geologic Mapping',
    ],
  },
  {
    // Synthetic organic chemist (NIGMS C-H functionalization grants) fully
    // relabeled as a parasitic-disease/malaria lab in both areas and the
    // areas-derived "Research fields include..." description template.
    entityId: '6a057df113fc60d57ec2a3a3',
    slug: 'nih-pi-jonathan-ellman',
    removeAreas: [
      'Parasitic Diseases Research and Treatment',
      'Malaria Research and Control',
      'Parasites and Host Interactions',
    ],
    clearFullDescriptionIfEquals:
      'Research fields include Parasitic Diseases Research and Treatment, Malaria Research and Control, and Parasites and Host Interactions.',
    clearShortDescriptionIfEquals:
      'Research fields include Parasitic Diseases Research and Treatment, Malaria Research and Control, and Parasites and Host Interactions.',
  },
  {
    // Psychiatry PI whose sole NIH grant is psilocybin-in-OCD; entirely
    // relabeled as a liver-disease/pancreatitis lab in both areas and
    // description. Unbacked direct-write (no fieldProvenance/observation for
    // any of these fields) - the entity's own sourceUrls already correctly
    // name this PI, so this is stale pre-#585/#1256 residue, not a live
    // ingest-gate gap.
    entityId: '6a057e1c13fc60d57ec2add4',
    slug: 'nih-pi-benjamin-kelmendi',
    removeAreas: [
      'Liver Disease and Transplantation',
      'Liver Disease Diagnosis and Treatment',
      'Pancreatitis Pathology and Treatment',
      'Pathology',
    ],
    clearFullDescriptionIfEquals:
      'The Benjamin Kelmendi Lab focuses on liver disease and transplantation, exploring the diagnosis of liver diseases and the pathology of pancreatitis. The lab investigates the underlying mechanisms and diagnostic approaches related to these conditions.',
    clearShortDescriptionIfEquals:
      'The Benjamin Kelmendi Lab studies liver disease, transplantation, and pancreatitis pathology.',
  },
  {
    // Interstitial-lung-disease PI (NHLBI grants on idiopathic pulmonary
    // fibrosis) whose description/areas blend her own correct ILD content
    // with an unrelated meningioma/schwannoma/neurofibromatosis graft.
    entityId: '6a057dfd13fc60d57ec2a638',
    slug: 'nih-pi-amy-zhao',
    removeAreas: ['Meningioma and schwannoma management', 'Neurofibromatosis and Schwannoma Cases'],
    clearFullDescriptionIfEquals:
      'The Amy Zhao Lab focuses on the management of meningiomas and schwannomas, as well as the study of interstitial lung diseases, including idiopathic pulmonary fibrosis. Additionally, the lab investigates neurofibromatosis and various cases of schwannomas.',
    clearShortDescriptionIfEquals:
      'The lab studies meningiomas, schwannomas, interstitial lung diseases, and neurofibromatosis.',
  },
  {
    // Dermatology PI (NIAMS grants on discoid lupus erythematosus/T cells)
    // whose description/areas are dominated by an unrelated multi-topic
    // graft (clinician burnout, oral health, genital health). Kept
    // "Cancer and Skin Lesions" and "Lichen Sclerosus et Atrophicus" as
    // plausibly her own (autoimmune skin disease causes skin lesions).
    entityId: '6a057e4e13fc60d57ec2b8ef',
    slug: 'nih-pi-alicia-little',
    removeAreas: [
      'Healthcare professionals’ stress and burnout',
      'Oral Health Pathology and Treatment',
      'Genital Health and Disease',
      'Perfectionism, Procrastination, Anxiety Studies',
    ],
    clearFullDescriptionIfEquals:
      'Alicia Little Lab studies the impact of stress and burnout on healthcare professionals, as well as various health issues including oral health pathology, genital health and disease, and cancer and skin lesions. The lab focuses on understanding the relationships between these factors and their implications for health outcomes.',
    clearShortDescriptionIfEquals:
      "The lab investigates healthcare professionals' stress and burnout alongside various health conditions.",
  },
  {
    // Sleep-medicine PI (NHLBI CPAP/OSA grants). Description was freshly and
    // correctly re-scraped (backed by a lab-microsite-description-llm
    // observation); only researchAreas still carries an unrelated
    // Ukraine/global-health/diplomacy graft cluster with no such backing -
    // description is left untouched.
    entityId: '6a057e1b13fc60d57ec2ad8f',
    slug: 'nih-pi-andrey-zinchuk',
    removeAreas: [
      'Global Health and Surgery',
      'Ukraine: War, Education, Health',
      'International Science and Diplomacy',
    ],
  },
  {
    // Vascular biology PI (NHLBI grants on the Alk1/Eng pathway and HHT).
    // Description is already correct; areas carry an unrelated
    // hypertension-pharmacology graft cluster alongside her own legitimate
    // vascular/endothelium areas, which are left in place.
    entityId: '6a057e4c13fc60d57ec2b86a',
    slug: 'nih-pi-anne-eichmann',
    removeAreas: [
      'Ion Transport and Channel Regulation',
      'Hormonal Regulation and Hypertension',
      'Eicosanoids and Hypertension Pharmacology',
    ],
  },
  {
    // #1486: ribosome-biogenesis postdoc (Baserga lab; own NIGMS grant on
    // mitochondrial sulfite oxidase in nucleolar ribosome biogenesis) carrying
    // an unrelated analytical/bioanalytical-chemistry graft cluster (ferrocene
    // biosensors, DNA/nucleic-acid chemistry). Verified against her own Yale
    // Medicine profile, which confirms ribosome biogenesis and platinum-based
    // anticancer metal-complex chemistry, not ferrocene biosensing. The
    // laundered fullDescription/shortDescription are left alone here: both
    // already have a fresh, correct, unmaterialized active Observation, so
    // `research-entity:rematerialize --only-fields` restores them instead of
    // blanking a value that already exists.
    entityId: '6a057e3913fc60d57ec2b465',
    slug: 'nih-pi-emily-sutton',
    removeAreas: [
      'Metal complexes synthesis and properties',
      'DNA and Nucleic Acid Chemistry',
      'Advanced biosensing and bioanalysis techniques',
      'Ferrocene Chemistry and Applications',
      'Genomics and Chromatin Dynamics',
      'Biochemistry',
    ],
  },
  {
    // #1486: redox-toxicology PI (own NIAAA grants on O-GlcNAcylation signaling
    // in alcoholic fatty liver disease) carrying an unrelated population-
    // genomics/herpetology graft cluster. Verified against her own Yale School
    // of Public Health profile, which confirms redox biology and liver/
    // metabolic disease mechanisms, not amphibian/reptile biology or
    // environmental DNA. Same rematerialize-not-clear treatment as above: a
    // fresh, correct active Observation for fullDescription/shortDescription
    // already exists and just needs materializing.
    entityId: '6a057e5013fc60d57ec2b926',
    slug: 'nih-pi-ying-chen',
    removeAreas: [
      'Genetic diversity and population structure',
      'Genomics and Phylogenetic Studies',
      'Environmental DNA in Biodiversity Studies',
      'Amphibian and Reptile Biology',
      'Identification and Quantification in Food',
      'Genomics',
    ],
  },
  {
    // #1486: her own NSF grant (LightningBug, an insect-biodiversity-museum-
    // digitization pipeline) and her Yale Medicine profile title ("Head of
    // Biodiversity Informatics Research") carry an unrelated molecular/cell-
    // biology graft (glycosylation, cell adhesion molecules, secretion). No
    // active Observation exists to rematerialize from here, so the description
    // is cleared rather than fabricated, per the same pattern as
    // nsf-pi-67d8922b50621bcef4348f57 and nih-pi-jonathan-ellman above.
    entityId: '6a057f0efab31be25f983ab1',
    slug: 'nsf-pi-68b737b70b1fc878dace4b5d',
    removeAreas: [
      'Cellular transport and secretion',
      'Glycosylation and Glycoproteins Research',
      'Cell Adhesion Molecules Research',
      'Biochemical and Structural Characterization',
      'Developmental Biology and Gene Regulation',
    ],
    clearFullDescriptionIfEquals:
      'The Genevieve Rios Lab focuses on cellular transport and secretion processes, glycosylation and glycoproteins, as well as the study of cell adhesion molecules. The lab investigates the mechanisms and implications of these biological processes in various cellular contexts.',
    clearShortDescriptionIfEquals:
      'The Genevieve Rios Lab studies cellular transport, glycosylation, and cell adhesion molecules.',
  },
  {
    // #1407: a `medicine.yale.edu` namesake's `researchAreas` grafted onto a
    // Classics historian; his own fullDescription/shortDescription (Roman
    // cultural history and kingship) are already correct and untouched.
    entityId: '6a058d9dba66f3c14bd85cf4',
    slug: 'johnston-aj346',
    removeAreas: [
      'CRISPR and Genetic Engineering',
      'Hidradenitis Suppurativa and Treatments',
      'Epigenetics and DNA Methylation',
      'Cytomegalovirus and herpesvirus research',
      'Synthetic Organic Chemistry Methods',
    ],
  },
  {
    // #1407: Black Studies / performance-studies scholar carrying a fully
    // unrelated muscle-metabolism/nutrition area cluster.
    entityId: '6a058debba66f3c14bd86276',
    slug: 'vogel-spv9',
    removeAreas: [
      'Muscle metabolism and nutrition',
      'Eating Disorders and Behaviors',
      'Cardiovascular and exercise physiology',
      'Coffee research and impacts',
      'Adipose Tissue and Metabolism',
      'Nutrition',
    ],
  },
  {
    // #1407: poetry/literary-biography scholar carrying an unrelated
    // dental/head-and-neck-oncology area cluster.
    entityId: '6a058d76ba66f3c14bd85a2c',
    slug: 'hammer-lhammer',
    removeAreas: [
      'Oral and gingival health research',
      'Oral and Maxillofacial Pathology',
      'Medical and Biological Sciences',
      'Head and Neck Cancer Studies',
      'Craniofacial Disorders and Treatments',
    ],
  },
  {
    // #1407: macroeconomist (FAS Dean of Social Science) carrying an
    // unrelated breast-cancer/BRCA oncology area cluster.
    entityId: '6a058cf8ba66f3c14bd8516e',
    slug: 'smith-aas59',
    removeAreas: [
      'Breast Cancer Treatment Studies',
      'BRCA gene mutations in cancer',
      'Breast Lesions and Carcinomas',
      'DNA Repair Mechanisms',
      'Genomic variations and chromosomal abnormalities',
    ],
  },
  {
    // #1407: comparative-literature/modernism scholar carrying an unrelated
    // rabies/venomous-animal/microbial-infection area cluster.
    entityId: '6a058d29ba66f3c14bd854cf',
    slug: 'lewis-pl54',
    removeAreas: [
      'Rabies epidemiology and control',
      'Venomous Animal Envenomation and Studies',
      'Cellular transport and secretion',
      'Microbial infections and disease research',
      'Nicotinic Acetylcholine Receptors Study',
    ],
  },
  {
    // #1407: modern-Chinese-literature scholar whose first 5 (of 9) areas are
    // an unrelated single-cell/microscopy/biomedical-imaging cluster; the
    // trailing 4 (Intellectual History, Media Studies, Religious Studies,
    // Comparative Literature) are her own and are left in place.
    entityId: '6a058dcaba66f3c14bd8601b',
    slug: 'tsu-jyt5',
    removeAreas: [
      'Single-cell and spatial transcriptomics',
      'Cell Image Analysis Techniques',
      '3D Printing in Biomedical Research',
      'Microfluidic and Capillary Electrophoresis Applications',
      'Advanced Fluorescence Microscopy Techniques',
    ],
  },
  {
    // #1407: early-modern-Italian-literature scholar (Boccaccio, pastoral,
    // women's roles) carrying an unrelated Spanish-lit/political-movements
    // cluster. `Renaissance and Early Modern Studies` and `Poetry Analysis
    // and Criticism` are left in place as plausibly her own (both cover her
    // actual period and genre); only the language- and domain-mismatched
    // entries are removed.
    entityId: '6a058da7ba66f3c14bd85d9f',
    slug: 'lorenzini-sl675',
    removeAreas: [
      'Early Modern Spanish Literature',
      'Communism, Protests, Social Movements',
      'American Political and Social Dynamics',
    ],
  },
  {
    // #1407: premodern South Asian Buddhist philosophy scholar carrying a
    // single unrelated agricultural-economics area alongside two areas that
    // are clearly his own (Indian and Buddhist Studies; South Asian Studies
    // and Diaspora), which are left in place.
    entityId: '6a058e02ba66f3c14bd86d57',
    slug: 'kachru-sk2999',
    removeAreas: ['Agricultural Economics and Practices'],
  },
  {
    // #1407: sole NIH grant (5K99EY035344, Cardin/Higley labs) is visual-
    // cortex fear-learning / cortical-network systems neuroscience; areas and
    // both description fields were instead entirely a wrong-person
    // olfaction/insect-physiology/chemical-sensor narrative with no
    // observation backing any of the three fields (fieldProvenance has no
    // entry for researchAreas, fullDescription, or shortDescription), so no
    // supersede is needed - there is nothing to re-derive from.
    entityId: '6a057e3f13fc60d57ec2b5b1',
    slug: 'nih-pi-andrew-moberly',
    removeAreas: [
      'Olfactory and Sensory Function Studies',
      'Neurobiology and Insect Physiology Research',
      'Biochemical Analysis and Sensing Techniques',
      'Neural dynamics and brain function',
      'Advanced Chemical Sensor Technologies',
    ],
    clearFullDescriptionIfEquals:
      'The Andrew Moberly Lab focuses on olfactory and sensory function studies, exploring neurobiology and insect physiology. The lab employs biochemical analysis and sensing techniques to investigate these areas.',
    clearShortDescriptionIfEquals:
      'The Andrew Moberly Lab studies olfactory and sensory functions, neurobiology, and insect physiology using biochemical analysis.',
  },
  {
    // #1407 CENTER variant, a different mechanism than the person-namesake
    // grafts above: `research-area-source-extractor` scraped the shared
    // `research.yale.edu/cores` listing page (not the MRRC-specific page) and
    // wrote an aggregate-looking, imaging-unrelated area set (Genomics,
    // Proteomics, Bioinformatics, Catalysis, ...) onto this entity. A
    // correct, still-active `lab-microsite-description-llm` observation
    // sourced from the center director's own medicine.yale.edu profile
    // already carries the right imaging/cognitive-neuroscience areas, so
    // this uses `setAreas` to adopt that value directly and supersedes the
    // wrong extractor observation so it isn't re-picked. The extractor's
    // page-scoping bug itself (why it produced a cores-listing aggregate
    // rather than a per-core value) is a distinct follow-up, not fixed here.
    entityId: '6a6463da9817287a528b5828',
    slug: 'research-yale-magnetic-resonance-research-center-mrrc',
    setAreas: [
      'Functional Magnetic Resonance Imaging',
      'Cognitive Processes',
      'Language and Memory',
      'Brain Disorders',
      'Neuronal Processes',
      'MRI Device Development',
    ],
    supersedeObservationIds: ['6a8917d0c09917b33b26ecbb'],
  },
  {
    // #1407 PROGRAM variant, also a distinct mechanism from the person-
    // namesake grafts above: the sole `researchAreas` observation for this
    // general "explore 100+ neuroscience labs" undergrad-opportunities page
    // is a `lab-microsite-description-llm` extraction that narrowed to one
    // specific affiliated lab's clinical-psychiatry areas instead of the
    // program's own general scope; the page's own description text never
    // mentions psychiatry. No corroborated program-level replacement exists,
    // so this clears to empty and supersedes the sole backing observation
    // rather than setting a fabricated value.
    entityId: '6a24fccd9457f3cf6851fa4d',
    slug: 'department-undergrad-research-neuroscience',
    removeAreas: ['Clinical Psychiatry', 'Computational Psychiatry', 'Mood and Brain Development'],
    supersedeObservationIds: ['6a2a323896f26c9504b7d0e1'],
  },
  {
    // #1407 second mechanism (source-less synthesized cluster, no merged
    // sourceUrl to blame): Elizabeth Hinton (History, policing/incarceration)
    // carries five biomedical `researchAreas` with no backing observation.
    // Left out of the automated domain-coherence guard's reach because her
    // own `fullDescription`/`shortDescription` were independently corrupted
    // by the same graft (a trailing "palliative care, telemedicine... COVID-19"
    // clause), so the guard's own-text overlap check false-corroborates
    // against the polluted description instead of catching it. That
    // description contamination is #1394's territory (description text
    // derived from polluted areas), not this issue's - left untouched here.
    entityId: '6a058dfaba66f3c14bd86ccd',
    slug: 'hinton-ekh38',
    removeAreas: [
      'Palliative Care and End-of-Life Issues',
      'Telemedicine and Telehealth Implementation',
      'COVID-19 and healthcare impacts',
      'Palliative Care',
      'Telemedicine',
    ],
    clearStudentDecisionExplanationIfExplanationEquals:
      'Consider reaching out for exploratory discussions regarding research opportunities in palliative care and telehealth.',
  },
  {
    // #1407 second mechanism, worst-case shape: the namesake graft here drove
    // the ENTIRE `fullDescription`/`shortDescription`, not just a trailing
    // clause (contrast Hinton above, where only a clause was grafted and the
    // rest of her own description survived). The Yale Internal Medicine Li
    // Wen lab is a type-1-diabetes/gut-microbiome immunology group -
    // corroborated by the two native chips kept below - but a namesake
    // herpetologist/ecologist Li Wen was fused into every other chip and the
    // full description prose itself. Because the description is fluent,
    // self-consistent, and 100% the wrong identity, the automated domain-
    // coherence guard would keep the wrong-domain chips (they overlap the
    // wrong-identity description) and could drop a real one (`Diabetes
    // Mellitus, Type` shares no vocabulary with the wildlife-ecology prose) -
    // this entity must stay on the manual drain list, not the automated
    // guard. `fullDescription`/`shortDescription` are cleared outright
    // (rather than left, as with Hinton) because unlike Hinton's case there
    // is no surviving correct portion to preserve - the whole prose is the
    // wrong person.
    entityId: '6a057e0c13fc60d57ec2a9e3',
    slug: 'nih-pi-li-wen',
    removeAreas: [
      'Wildlife Ecology and Conservation',
      'Amphibian and Reptile Biology',
      'Helminth infection and control',
      'Animal Behavior and Reproduction',
    ],
    clearFullDescriptionIfEquals:
      'Li Wen Lab focuses on wildlife ecology and conservation, specifically studying amphibian and reptile biology, helminth infection and control, and the relationship between gut microbiota and health. The lab investigates the ecological impacts of these factors on wildlife populations and their habitats.',
    clearShortDescriptionIfEquals:
      'Li Wen Lab studies wildlife ecology, amphibian and reptile biology, and gut microbiota health.',
  },
  {
    // #1407 second mechanism, same worst-case shape as Li Wen above: the
    // namesake fusion drove the ENTIRE `fullDescription`/`shortDescription`.
    // The Yale Pharmacology Leonard Kaczmarek lab is an ion-channel
    // neurophysiologist (Slack/Slick K+ channels), corroborated by the one
    // native chip kept below, but a namesake parasitologist/entomologist was
    // fused into the other five chips and the full description prose. Both
    // description fields are cleared outright - the whole prose is the wrong
    // person, no correct portion to preserve.
    entityId: '6a057e1813fc60d57ec2ac71',
    slug: 'nih-pi-leonard-kaczmarek',
    removeAreas: [
      'Parasite Biology and Host Interactions',
      'Photoreceptor and optogenetics research',
      'Neuroscience and Neuropharmacology Research',
      'Mosquito-borne diseases and control',
      'Neurobiology and Insect Physiology Research',
    ],
    clearFullDescriptionIfEquals:
      'The Leonard Kaczmarek Lab focuses on parasite biology and host interactions, exploring the mechanisms of photoreception and the applications of optogenetics. Additionally, the lab investigates neuroscience, neuropharmacology, and the dynamics of mosquito-borne diseases and their control strategies.',
    clearShortDescriptionIfEquals:
      'The Leonard Kaczmarek Lab studies parasite biology, host interactions, and mosquito-borne diseases.',
  },
  {
    // #1407 second mechanism, weaker/partial variant (contrast Kaczmarek/Li
    // Wen above): the Yale Internal Medicine Kei-Hoi Cheung lab is a
    // biomedical-informatics/bioinformatics group - corroborated by 5 of 6
    // chips and most of the description - but one namesake (a psychosomatic-
    // medicine specialist) chip was fused in, and it also seeped into a
    // single trailing description sentence (same shape as Hinton). Only the
    // chip is removed; the description's mostly-correct prose is left as-is
    // since a partial-clause repair is #1394's territory, not this issue's.
    entityId: '6a057e2113fc60d57ec2aeb3',
    slug: 'nih-pi-kei-hoi-cheung',
    removeAreas: ['Psychosomatic Disorders and Their Treatments'],
  },
];

interface CliOptions {
  apply: boolean;
  confirm: boolean;
  output?: string;
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { apply: false, confirm: false };
  for (const arg of argv) {
    if (arg === '--apply') options.apply = true;
    else if (arg === '--confirm-namesake-graft-purge') options.confirm = true;
    else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.apply && !options.confirm) {
    throw new Error('--confirm-namesake-graft-purge is required when --apply is set.');
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: 'purgeNamesakeGraftResiduals',
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();

  const ids = VERIFIED_GRAFTS.map((g) => new mongoose.Types.ObjectId(g.entityId));
  const entities = await ResearchEntity.find({ _id: { $in: ids } })
    .select({
      slug: 1,
      researchAreas: 1,
      fullDescription: 1,
      shortDescription: 1,
      studentDecisionExplanation: 1,
    })
    .lean();
  const entityById = new Map(entities.map((e) => [String(e._id), e]));

  const missing: string[] = [];
  const plans = VERIFIED_GRAFTS.map((directive) => {
    const entity = entityById.get(directive.entityId);
    if (!entity) {
      missing.push(directive.slug);
      return null;
    }
    return planNamesakeGraftCleanup(
      {
        researchAreas: entity.researchAreas,
        fullDescription: entity.fullDescription,
        shortDescription: entity.shortDescription,
        studentDecisionExplanation: entity.studentDecisionExplanation,
      },
      directive,
    );
  }).filter((plan): plan is NonNullable<typeof plan> => plan !== null);

  const observationIdsToSupersede = Array.from(
    new Set(VERIFIED_GRAFTS.flatMap((g) => g.supersedeObservationIds || [])),
  );
  const activeObservationIds = observationIdsToSupersede.length
    ? (
        await Observation.find({
          _id: { $in: observationIdsToSupersede.map((id) => new mongoose.Types.ObjectId(id)) },
          superseded: false,
        })
          .select({ _id: 1 })
          .lean()
      ).map((o) => String(o._id))
    : [];

  const changedPlans = plans.filter((plan) => plan.changed);
  const summary = {
    mode: options.apply ? 'apply' : 'dry-run',
    environment: guard.environment,
    db: guard.dbLabel,
    verifiedGrafts: VERIFIED_GRAFTS.length,
    entitiesMissing: missing,
    ...summarizeNamesakeGraftPlans(plans),
    observationsToSupersede: activeObservationIds,
    observationsSuperseded: 0,
    reindexed: 0,
  };

  if (options.apply && changedPlans.length > 0) {
    const operations = changedPlans.map((plan) => {
      const set: Record<string, unknown> = {};
      const unset: Record<string, unknown> = {};
      if (!plan.areasAfter.every((area, index) => area === plan.areasBefore[index]) ||
        plan.areasAfter.length !== plan.areasBefore.length) {
        set.researchAreas = plan.areasAfter;
      }
      if (plan.fullDescriptionCleared) set.fullDescription = '';
      if (plan.shortDescriptionCleared) set.shortDescription = '';
      if (plan.studentDecisionExplanationCleared) unset.studentDecisionExplanation = '';
      const update: Record<string, unknown> = {};
      if (Object.keys(set).length > 0) update.$set = set;
      if (Object.keys(unset).length > 0) update.$unset = unset;
      return {
        updateOne: {
          filter: { _id: new mongoose.Types.ObjectId(plan.entityId) },
          update,
        },
      };
    });
    // `studentDecisionExplanation` is no longer declared on the ResearchEntity
    // Mongoose schema (retired #437/#440), so `ResearchEntity.bulkWrite` would
    // silently strip an $unset on it under strict-mode casting. Write through
    // the raw driver collection instead so the unset actually reaches Mongo.
    await ResearchEntity.collection.bulkWrite(operations, { ordered: false });

    const changedIds = changedPlans.map((plan) => new mongoose.Types.ObjectId(plan.entityId));
    const fresh = await ResearchEntity.find({ _id: { $in: changedIds } }).lean();
    await syncEntities('researchEntity', fresh);
    summary.reindexed = fresh.length;
  }

  if (options.apply && activeObservationIds.length > 0) {
    const result = await Observation.updateMany(
      { _id: { $in: activeObservationIds.map((id) => new mongoose.Types.ObjectId(id)) } },
      { $set: { superseded: true } },
    );
    summary.observationsSuperseded = result.modifiedCount;
  }

  const output = { summary, entries: plans };
  console.log(JSON.stringify(output, null, 2));
  if (options.output) {
    const safeOutput = resolveSafeJsonReportOutputPath(options.output);
    fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
    fs.writeFileSync(safeOutput, `${JSON.stringify(output, null, 2)}\n`);
  }
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error('Failed to purge namesake graft residuals:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
