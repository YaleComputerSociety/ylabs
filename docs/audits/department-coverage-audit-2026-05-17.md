# Department Coverage Audit

Date: 2026-05-17

## Scope

This audit checks active `research_entities` coverage by canonical `departments`, then compares visible gaps against official Yale public sources:

- Yale University Departments & Programs: https://www.yale.edu/academics/departments-programs
- Faculty of Arts and Sciences Departments and Programs: https://fas.yale.edu/about-fas/divisions-departments-programs
- Yale School of Medicine Departments & Centers: https://medicine.yale.edu/about/departments/
- Yale Research Centers & Institutes: https://research.yale.edu/centers-institutes
- Yale School of the Environment Centers, Programs, and Initiatives: https://environment.yale.edu/research/centers
- Yale Engineering Research Areas: https://engineering.yale.edu/research-and-faculty/research-areas

The DB audit matched entity department strings against active seeded `Department` rows by abbreviation, display name, name, and aliases.

## Executive Summary

- Active `research_entities`: 2,811.
- Entities with at least one department string: 2,707 / 2,811, 96.3%.
- Entities with no department string: 104 / 2,811, 3.7%.
- Active department taxonomy rows: 105.
- Department taxonomy rows with zero matched entities: 23.
- Department taxonomy rows with 1-4 matched entities: 15.
- Active access artifacts: 595 `entry_pathways`, 1,210 `access_signals`, 428 `contact_routes`, 0 `posted_opportunities`.

The main issue is not just missing departments. It is normalization leakage: many source-specific unit labels are sitting in `research_entities.departments` without resolving to canonical departments. These labels hide coverage that likely exists, especially for Internal Medicine, Public Health, Biochemistry/Molecular Biophysics, Microbiology/Immunology, Radiology/Therapeutic Radiology, School of Engineering, Yale School of the Environment, School of Art, Divinity, Jackson, and YSPH subdepartments.

## Coverage By Broad Category

Counts are unique entities tagged to at least one department in each category. Multi-category departments can count in more than one row.

| Category | Entities |
| --- | ---: |
| Health & Medicine | 851 |
| Humanities & Arts | 313 |
| Life Sciences | 259 |
| Physical Sciences & Engineering | 233 |
| Social Sciences | 184 |
| Economics | 149 |
| Environmental Sciences | 115 |
| Computing & AI | 114 |
| Mathematics | 63 |

Health and medicine coverage is the largest, but it is also where unresolved source labels are most concentrated.

## Strongest Department Coverage

| Department | Entities |
| --- | ---: |
| YSM - Yale School of Medicine | 261 |
| PSYT - Psychiatry | 167 |
| ECON - Economics | 135 |
| PHYS - Physics | 91 |
| NRLG - Neurology | 76 |
| INMD - Internal Medicine | 72 |
| GENE - Genetics | 70 |
| CPSC - Computer Science | 66 |
| PSYC - Psychology | 64 |
| PEDT - Pediatrics | 63 |
| PATH - Pathology | 62 |
| MCDB - Molecular, Cellular & Developmental Biology | 61 |
| ENGL - English Language & Literature | 60 |

## Zero-Coverage Departments

These active department rows matched no active `research_entities` after canonical matching:

ARCG Archaeological Studies; ART Art; BIOL Biological & Biomedical Sciences; CB&B Computational Biology & Biomedical Informatics; CGSC Cognitive Science; EAST East Asian Studies; EMST Early Modern Studies; ENAS Engineering & Applied Science; EPH Public Health; EVST Environment; EXPA Experimental Pathology; GLBL Global Affairs; HCM Health Care Management; HELN Hellenic Studies; IMED Investigative Medicine; LAST Latin American Studies; MBIO Microbiology; MDVL Medieval Studies; MMES Modern Middle East Studies; NURS Nursing; OPVS Ophthalmology & Visual Science; RSEE European & Russian Studies; SAST South Asian Studies.

Some of these are true missing coverage candidates. Others are present under unresolved raw strings or neighboring departments:

- `EPH Public Health` is likely hidden under `PUBLIC HEALTH & PREV MEDICINE`, `SPH School of Public Health`, `Yale School of Public Health`, and `SPHDPT ...` strings.
- `NURS Nursing` appears to be a real gap relative to Yale's official school list.
- `OPVS Ophthalmology & Visual Science` is likely hidden under `OPHTHALMOLOGY` and `Ophthalmology`.
- `MBIO Microbiology` may be hidden under `MICROBIOLOGY/IMMUN/VIROLOGY`.
- `ENAS Engineering & Applied Science` is likely a school-level taxonomy issue; Engineering has strong subdepartment coverage but the school-level row matched none.
- `ART Art`, `GLBL Global Affairs`, `SAST South Asian Studies`, `EAST East Asian Studies`, `LAST Latin American Studies`, `MMES Modern Middle East Studies`, and `MDVL Medieval Studies` look like real humanities/social-science coverage gaps.

## Low-Coverage Departments

Departments with 1-4 matched entities:

| Department | Entities | Example |
| --- | ---: | --- |
| AFST African Studies | 1 | Shore Lab |
| AMTH Applied Mathematics | 1 | Vu Lab |
| CDE Chronic Disease Epidemiology | 1 | Nutrition, Exercise and Weight Management Studies for Cancer Prevention and Survivorship |
| EHS Environmental Health Sciences | 1 | Pollitt Lab |
| EMD Epidemiology of Microbial Diseases | 1 | Pitzer Lab |
| TRAD Therapeutic Radiology/Radiation Oncology | 1 | Sweasy Lab |
| BIS Biostatistics | 2 | Townsend Lab |
| FILM Film & Media Studies | 2 | Aaron Gerow - Research |
| HPM Health Policy & Management | 2 | Jason L. Schwartz, Ph.D. |
| OPRH Orthopaedics & Rehabilitation | 2 | 3D Tumor Lab |
| HSHM History of Science & Medicine | 3 | Naomi Rogers - Research |
| HUMS Humanities | 3 | Katja Lindskog - Research |
| JDST Jewish Studies | 3 | David Sorkin - Research |
| BIDS Biomedical Informatics and Data Science | 4 | Clinical NLP Lab |
| GMAN German | 4 | Paul North - Research |

## Biggest Normalization Problems

Top unresolved department strings by active entity count:

| Raw string | Count | Likely canonical target |
| --- | ---: | --- |
| INTERNAL MEDICINE/MEDICINE | 180 | INMD Internal Medicine |
| PUBLIC HEALTH & PREV MEDICINE | 67 | EPH/YSPH, CDE, EHS, EMD, BIS, HPM depending subunit |
| BIOCHEMISTRY | 54 | MB&B / CB&B / Biology depending source |
| MICROBIOLOGY/IMMUN/VIROLOGY | 48 | MBIO / IBIO / EMD |
| RADIATION-DIAGNOSTIC/ONCOLOGY | 48 | R&BI / TRAD / YCC context |
| SPH School of Public Health | 45 | EPH Public Health |
| FAS Other FAS and Academic Departments | 42 | Needs source-specific resolver; not a department |
| MED School of Medicine | 39 | YSM fallback only, preferably resolve lower |
| NEUROSCIENCES | 34 | NSCI / NRLG / WTI depending entity |
| EAS School of Engineering and Applied Science | 31 | ENAS or SEAS subdepartment |
| ANATOMY/CELL BIOLOGY | 25 | CBIO |
| Yale School of Public Health | 20 | EPH Public Health |
| PHYSIOLOGY | 18 | C&MP |
| VETERINARY SCIENCES | 15 | CPMD / Comparative Medicine |
| SPHDPT Epidemiology of Microbial Diseases (EMD) | 14 | EMD |
| OBSTETRICS & GYNECOLOGY | 12 | OBGN |
| SPHDPT Biostatistics (BIS) | 11 | BIS |
| SPHDPT Environmental Health Sciences (EHS) | 11 | EHS |
| EASMEC MechE Faculty | 10 | MENG |
| ENV Yale School of the Environment | 10 | F&ES / EVST / YSE center context |
| ARTSCH School of Art - All School | 9 | ART |
| ART School of Art | 9 | ART |
| JAC Jackson School of Global Affairs | 8 | GLBL / Jackson school context |

This is the highest ROI fix: update department resolution aliases before running more scraping. It would convert hundreds of "missing" entities into canonical department coverage.

## Official-Source Missing Coverage Candidates

### Yale Research Centers & Institutes

The DB already contains YIBS, Yale Center for Geospatial Solutions, Yale Center for Natural Carbon Capture, and Yale Quantum Institute.

Likely missing from active `research_entities`:

- Institute of Biomolecular Design and Discovery (IBDD)
- Yale Cancer Biology Institute (YCBI)
- Data-Intensive Social Science Center (DISSC)
- Energy Sciences Institute (ESI)
- Yale Institute for Foundations of Data Science
- Microbial Sciences Institute
- Nanobiology Institute
- Yale Planetary Solutions Project
- Institute for the Preservation of Cultural Heritage
- Quantitative Biology Institute (QBio)

### Yale School of Medicine Research Programs, Centers & Organizations

The DB comparison found only Wu Tsai Institute and Yale Cancer Center as clear active matches from the YSM research-programs section. High-priority likely missing YSM centers/programs include:

- Adams Center for Parkinson's Disease Research at Yale
- Alzheimer's Disease Research Center
- Cancer Biology Institute
- Cancer Prevention & Control Research Programs
- Cellular Neuroscience, Neurodegeneration & Repair Center (CNNR)
- Center for Biomedical Data Science (CBDS)
- Center for Biomedical Innovation and Technology
- Center for Brain and Mind Health
- Center for Infection and Immunity
- Center for Methods in Implementation and Prevention Science (CMIPS)
- Center for Outcomes Research & Evaluation (CORE)
- Center for Perinatal, Pediatric & Environmental Epidemiology (Yale CPPEE)
- Center for RNA Science & Medicine
- Center for the Translational Neuroscience of Alcohol (CTNA)
- Diabetes Research Center
- Emerging Infections Program
- Equity Research & Innovation Center (ERIC)
- Kavli Institute for Neuroscience
- Liver Center
- NIDA Neuroproteomics Center
- PRIME Center
- Program for Recovery and Community Health
- SEICHE Center for Health and Justice
- Tobacco Center of Regulatory Science
- Vascular Biology & Therapeutics (VBT)
- Women's Health Research at Yale
- Yale Biomedical Imaging Institute (YBII)
- Yale Center for Analytical Sciences
- Yale Center for Clinical Investigation (YCCI)
- Yale Center for Dyslexia & Creativity
- Yale Center for Molecular and Systems Metabolism
- Yale Center for Obesity Research
- Yale Center for Research on Aging
- Yale Institute for Global Health (YIGH)
- Yale Program for Psychedelic Science
- Yale Stem Cell Center
- Yale Stress Center
- Yale Translational Research Imaging Center

These should not all become student-facing "pathways" automatically. Most should first become `ResearchEntity` rows with source-backed descriptions, departments, websites, and membership/contact routes where official pages support them.

### Yale School of the Environment

YSE center coverage is strong. The DB appears to contain the main YSE centers, programs, and initiatives listed on the YSE source page, including CBEY, URI, TRI, YPCCC, YCELP, Yale Forests, Yale Environment 360, and affiliated YIBS/geospatial/natural carbon capture rows.

The main YSE issue is department normalization (`ENV Yale School of the Environment`, `ENVOTH Other Units`) rather than missing center entities.

### Engineering

Yale Engineering publicly lists research by Applied & Computational Mathematics, Applied Physics, Biomedical Engineering, Chemical & Environmental Engineering, Computer Science, Electrical & Computer Engineering, Materials Science, and Mechanical Engineering.

The DB has meaningful coverage in CPSC, PHYS/APHY, BENG, CENG, ECE, MENG, and S&DS, but unresolved strings such as `EAS School of Engineering and Applied Science`, `EASMEC MechE Faculty`, `EASCEE CEE Faculty`, `EASECE ECE Faculty`, and `ENGINEERING (ALL TYPES)` should be canonicalized. Materials Science is under-modeled as a department/taxonomy row.

## Recommended Next Steps

1. Extend `departmentGroundTruth.ts` aliases/resolver inputs for the unresolved source strings above, especially YSM/YSPH/SEAS/YSE school-unit strings.
2. Backfill or re-materialize affected `research_entities.departments` so canonical department filters reflect existing coverage.
3. Add a source-backed scraper or seed source for Yale Research Centers & Institutes to cover missing cross-campus institutes.
4. Extend the YSM departments/centers source to materialize the research-program/center list, not just department rows.
5. Add targeted coverage tasks for true zero/low departments: Nursing, Art, Global Affairs/Jackson, area studies programs, Public Health subdepartments, Ophthalmology, Microbiology, Cognitive Science, and Archaeological Studies.
6. Treat center/program rows as `ResearchEntity` first; only create `EntryPathway`, `AccessSignal`, or `PostedOpportunity` when the source proves an undergraduate-access route.

