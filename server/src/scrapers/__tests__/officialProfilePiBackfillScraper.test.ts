import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  entityResearchHomeToObservations,
  entityLeadDirectWebsiteToObservations,
  extractOfficialProfileIdentity,
  extractOfficialProfileResearchHomes,
  firstNonDuplicateLeadDirectWebsiteUrl,
  identityToResearchEntityDescriptionObservations,
  identityToResearchEntityPiKeyObservations,
  identityToResearchEntityPiObservations,
  identityToUserObservations,
  generatedOfficialProfileUrlCandidatesForPerson,
  leadDirectResearchHomeUrlsForEntity,
  leadDirectResearchHomeUrlsForUser,
  normalizeOfficialProfileUrl,
  OfficialProfilePiBackfillScraper,
  officialProfileUrlsForEntity,
  preferredOfficialProfileUrl,
  PROFILE_DESCRIPTION_SUPPRESSED_BY_PREFERRED_SOURCE_NAMES_FIELD,
  resolveExistingUserForIdentity,
  selectVisibleProfileBioTargets,
  shouldQueueEntityForPiBackfill,
  sourceUrlResearchHomeUrlsForEntity,
  websiteDuplicateLookupUrls,
} from '../sources/officialProfilePiBackfillScraper';
import type { ObservationInput, ScraperContext } from '../types';
import { ResearchEntity } from '../../models/researchEntity';
import { User } from '../../models/user';

const profileUrl = 'https://medicine.yale.edu/profile/joseph-w-kim/';
const departmentPersonPageUrl =
  'https://engineering.yale.edu/research-and-faculty/faculty-directory/dana-angluin/';

const profileHtml = `
  <html>
    <head>
      <link rel="canonical" href="${profileUrl}" />
      <meta name="description" content="Professor of Surgery (Oncology)" />
      <meta property="og:image" content="https://ysm-res.cloudinary.com/image/upload/example/joseph-kim" />
    </head>
    <body>
      <main>
        <h1>Joseph W. Kim</h1>
        <div class="title">Professor of Surgery (Oncology)</div>
        <a href="mailto:joseph.kim@yale.edu">joseph.kim@yale.edu</a>
        <div class="department">Surgery</div>
        <section class="biography">
          Joseph W. Kim studies translational cancer biology and develops clinical research
          programs for gastrointestinal oncology.
        </section>
        <div class="research-interests">Cancer biology; Translational oncology</div>
      </main>
    </body>
  </html>
`;

const emailLessProfileHtml = `
  <html>
    <head>
      <link rel="canonical" href="${profileUrl}" />
      <meta name="description" content="Professor of Surgery (Oncology)" />
    </head>
    <body>
      <main>
        <h1>Joseph W. Kim</h1>
        <div class="title">Professor of Surgery (Oncology)</div>
        <section class="biography">
          Joseph W. Kim studies translational cancer biology and develops clinical research
          programs for gastrointestinal oncology.
        </section>
      </main>
    </body>
  </html>
`;

const ysmJsonProfileHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://ysph.yale.edu/profile/caroline-johnson/" />
      <script type="application/ld+json">
        {
          "@type": "ProfilePage",
          "mainEntity": {
            "@type": "Person",
            "name": "Caroline H. Johnson",
            "email": "caroline.johnson@yale.edu",
            "jobTitle": "Associate Professor of Epidemiology"
          }
        }
      </script>
    </head>
    <body>
      <h1>Caroline H. Johnson</h1>
      <a href="mailto:ysm.editor@yale.edu">ysm.editor@yale.edu</a>
    </body>
  </html>
`;

const sinusasProfileHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://medicine.yale.edu/profile/albert-sinusas/" />
      <script type="application/ld+json" data-schema="ProfilePage">
        {
          "@type": "ProfilePage",
          "mainEntity": {
            "@type": "Person",
            "@id": "https://medicine.yale.edu/profile/albert-sinusas/",
            "name": "Albert Sinusas",
            "email": "albert.sinusas@yale.edu",
            "jobTitle": ["Professor of Medicine (Cardiology)"],
            "description": "Albert Sinusas is Director of the Yale Translational Research Imaging Center (Y-TRIC). His research is directed at development, validation and application of non-invasive cardiovascular imaging approaches.",
            "affiliation": [
              {
                "@type": "Organization",
                "@id": "https://medicine.yale.edu/internal-medicine/",
                "name": "Internal Medicine",
                "url": "https://medicine.yale.edu/internal-medicine/"
              },
              {
                "@type": "Organization",
                "@id": "https://medicine.yale.edu/internal-medicine/cardio/research/translational-imaging/",
                "name": "Yale Translational Research Imaging Center (Y-TRIC)",
                "url": "https://medicine.yale.edu/internal-medicine/cardio/research/translational-imaging/"
              }
            ]
          }
        }
      </script>
    </head>
    <body>
      <main>
        <h1>Albert Sinusas, MD</h1>
        <div class="title">Professor of Medicine (Cardiology)</div>
        <a href="mailto:albert.sinusas@yale.edu">albert.sinusas@yale.edu</a>
        <section class="biography">
          Albert Sinusas is Director of the Yale Translational Research Imaging Center (Y-TRIC).
          My research involves development, validation, and application of non-invasive imaging approaches.
        </section>
      </main>
    </body>
</html>
`;

const linkedResearchHomeProfileHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://medicine.yale.edu/profile/albert-sinusas/" />
      <script type="application/ld+json" data-schema="ProfilePage">
        {
          "@type": "ProfilePage",
          "mainEntity": {
            "@type": "Person",
            "name": "Albert Sinusas",
            "email": "albert.sinusas@yale.edu",
            "jobTitle": "Professor of Medicine (Cardiology)"
          }
        }
      </script>
    </head>
    <body>
      <main>
        <h1>Albert Sinusas, MD</h1>
        <p>
          Albert Sinusas is Director of the
          <a href="/internal-medicine/cardio/research/translational-imaging/">
            Yale Translational Research Imaging Center (Y-TRIC)
          </a>.
        </p>
      </main>
    </body>
  </html>
`;

const departmentPersonPageHtml = `
  <html>
    <head>
      <link rel="canonical" href="${departmentPersonPageUrl}" />
      <meta property="og:title" content="Dana Angluin | Professor Emeritus | Yale Engineering" />
    </head>
    <body>
      <main>
        <h1>Dana Angluin</h1>
        <div class="title">Professor Emeritus of Computer Science</div>
        <a href="mailto:dana.angluin@yale.edu">dana.angluin@yale.edu</a>
        <section class="biography">
          Dana Angluin received her PhD in Engineering Science from UC Berkeley and spent her
          career developing algorithmic approaches to learning, including query models, robot
          localization, formal languages, and learning with artificial neural networks.
        </section>
      </main>
    </body>
  </html>
`;

const redirectedDirectoryProfileHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://environment.yale.edu/directory/faculty/susan-g-clark" />
      <meta property="og:title" content="Susan G. Clark | Yale School of the Environment" />
    </head>
    <body>
      <main>
        <h1>Susan G. Clark</h1>
        <div class="title">
          Joseph F. Cullman 3rd Adjunct Professor Emeritus of Wildlife Ecology and Policy Sciences
        </div>
        <a href="mailto:susan.g.clark@yale.edu">susan.g.clark@yale.edu</a>
        <section class="biography">
          Professor Clark's primary goal in her research and teaching is to improve conservation
          of species and ecosystems at professional, scientific, organizational, and policy levels.
        </section>
      </main>
    </body>
  </html>
`;

const yseDirectoryProfileWithNewsTitleHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://environment.yale.edu/directory/faculty/michelle-bell/" />
      <meta property="og:title" content="Michelle L. Bell | Yale School of the Environment" />
    </head>
    <body>
      <main>
        <h1>Michelle L. Bell</h1>
        <article>
          <div class="views-field-title">
            Advancing heat-related mental health research: moving beyond epidemiological links
          </div>
        </article>
        <div class="profile-position">
          Senior Associate Dean of Research and Director of Doctoral Studies; Mary E. Pinchot Professor of Environmental Health
        </div>
        <a href="mailto:michelle.bell@yale.edu">michelle.bell@yale.edu</a>
        <h2>Research</h2>
        <p>
          Senior Associate Dean of Research and Director of Doctoral Studies; Mary E. Pinchot Professor of Environmental Health
        </p>
        <div class="field-of-study">Ph.D. Environmental Engineering, Johns Hopkins University</div>
      </main>
    </body>
  </html>
`;

const profileWithAddressInsteadOfBioHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://statistics.yale.edu/profile/anna-gilbert/" />
      <meta property="og:title" content="Anna Gilbert | Yale Statistics and Data Science" />
    </head>
    <body>
      <main>
        <h1>Anna Gilbert</h1>
        <div class="title">John C. Malone Professor of Electrical Engineering and of Statistics and Data Science</div>
        <a href="mailto:anna.gilbert@yale.edu">anna.gilbert@yale.edu</a>
        <p>Kline Tower Room 1247 219 Prospect Street New Haven, CT 06511</p>
        <div class="research-interests">
          Sparse and Compressive Sensing Techniques; Blind Source Separation Techniques; Image and Signal Denoising Methods
        </div>
      </main>
    </body>
  </html>
`;

const profileWithChromeInsteadOfBioHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://engineering.yale.edu/research-and-faculty/faculty-directory/anurag-khandelwal/" />
      <meta property="og:title" content="Anurag Khandelwal | Yale Engineering" />
    </head>
    <body>
      <main>
        <h1>Anurag Khandelwal</h1>
        <div class="title">Assistant Professor of Computer Science</div>
        <a href="mailto:anurag.khandelwal@yale.edu">anurag.khandelwal@yale.edu</a>
        <section class="biography">See my webpage for selected publications.</section>
        <div class="research-interests">
          Cloud Computing and Resource Management; Advanced Data Storage Technologies; Distributed systems and fault tolerance
        </div>
      </main>
    </body>
  </html>
`;

const profileWithCredentialsOnlyBioHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://english.yale.edu/people/kim-shirkhani/" />
      <meta property="og:title" content="Kim Shirkhani | Yale English" />
    </head>
    <body>
      <main>
        <h1>Kim Shirkhani</h1>
        <div class="title">Lecturer in English</div>
        <a href="mailto:kim.shirkhani@yale.edu">kim.shirkhani@yale.edu</a>
        <section class="biography">
          Ph.D., English, University of VirginiaM.A., English, McGill UniversityB.A.,
          English, University of California at Los Angeles
        </section>
      </main>
    </body>
  </html>
`;

const profileWithPublicationListBioHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://engineering.yale.edu/research-and-faculty/faculty-directory/lea-r-winter/" />
      <meta property="og:title" content="Lea R. Winter | Yale Engineering" />
    </head>
    <body>
      <main>
        <h1>Lea R. Winter</h1>
        <div class="title">Assistant Professor of Chemical & Environmental Engineering</div>
        <a href="mailto:lea.winter@yale.edu">lea.winter@yale.edu</a>
        <section class="biography">
          Yingzheng Fan, Yu Yan, Obinna Nwokonkwo, John Kim, Margaret Liu,
          Leo Chen, Lea R. Winter*. "Tuning membranes for selective separations."
          Nature Materials 2024.
        </section>
        <div class="research-interests">
          Sustainable chemical separations; membrane materials; water treatment
        </div>
      </main>
    </body>
  </html>
`;

const profileWithSingleCitationBioHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://engineering.yale.edu/research-and-faculty/faculty-directory/lea-r-winter/" />
      <meta property="og:title" content="Lea R. Winter | Yale Engineering" />
    </head>
    <body>
      <main>
        <h1>Lea R. Winter</h1>
        <div class="title">Assistant Professor of Chemical & Environmental Engineering</div>
        <a href="mailto:lea.winter@yale.edu">lea.winter@yale.edu</a>
        <section class="biography">
          Julia Simon, Lea R. Winter*. "Plasma-activated co-conversion of N2 and C1 gases
          towards value-added products." Current Opinion in Green & Sustainable Chemistry
          51: 100985 (2025).
        </section>
        <div class="research-interests">
          Sustainable chemical separations; plasma catalysis; decarbonization
        </div>
      </main>
    </body>
  </html>
`;

const profileWithLongAppointmentOnlyBioHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://ysph.yale.edu/profile/jason-l-schwartz/" />
      <meta property="og:title" content="Jason L. Schwartz | Yale School of Public Health" />
    </head>
    <body>
      <main>
        <h1>Jason L. Schwartz</h1>
        <div class="title">Associate Professor of Public Health (Health Policy)</div>
        <a href="mailto:jason.l.schwartz@yale.edu">jason.l.schwartz@yale.edu</a>
        <section class="biography">
          Associate Professor of Public Health (Health Policy); Associate Professor in the
          History of Medicine, and Associate Professor in the Institution for Social and
          Policy Studies
        </section>
      </main>
    </body>
  </html>
`;

const profileWithGrantProjectBioHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://medicine.yale.edu/profile/michael-nathanson/" />
      <meta property="og:title" content="Michael Nathanson | Yale Medicine" />
    </head>
    <body>
      <main>
        <h1>Michael H. Nathanson</h1>
        <div class="title">Professor of Medicine</div>
        <a href="mailto:michael.nathanson@yale.edu">michael.nathanson@yale.edu</a>
        <section class="biography">
          NIH P01 DK57751 (PI: M.H. Nathanson) 04/01/01-04/30/21 Title: Regulation
          of liver by nuclear calcium signaling Goals: The major goals of this project
          are to determine the mechanisms by which calcium is regulated in the nucleus
          of hepatocytes.
        </section>
        <div class="research-interests">
          Liver physiology; Calcium signaling; Digestive diseases
        </div>
      </main>
    </body>
  </html>
`;

const profileWithClinicalProfileChromeBioHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://medicine.yale.edu/profile/samir-gautam/" />
      <meta property="og:title" content="Samir Gautam | Yale Medicine" />
    </head>
    <body>
      <main>
        <h1>Samir Gautam</h1>
        <div class="title">Assistant Professor of Medicine</div>
        <a href="mailto:samir.gautam@yale.edu">samir.gautam@yale.edu</a>
        <section class="biography">
          View this doctor's clinical profile on the Yale Medicine website for information about
          the services we offer and making an appointment.
        </section>
      </main>
    </body>
  </html>
`;

const profileWithTerseInterestBioHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://physics.yale.edu/people/andrew-neitzke/" />
      <meta property="og:title" content="Andrew Neitzke | Yale Physics" />
    </head>
    <body>
      <main>
        <h1>Andrew Neitzke</h1>
        <div class="title">Professor of Mathematics and Physics</div>
        <a href="mailto:andrew.neitzke@yale.edu">andrew.neitzke@yale.edu</a>
        <section class="biography">Problems in string theory and supersymmetric field theory</section>
        <div class="research-interests">
          String theory; Supersymmetric field theory; Algebraic geometry.
        </div>
      </main>
    </body>
  </html>
`;

const profileWithOnlyTerseResearchBioHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://physics.yale.edu/people/andrew-neitzke/" />
      <meta property="og:title" content="Andrew Neitzke | Yale Physics" />
    </head>
    <body>
      <main>
        <h1>Andrew Neitzke</h1>
        <div class="title">Professor of Mathematics and Physics</div>
        <a href="mailto:andrew.neitzke@yale.edu">andrew.neitzke@yale.edu</a>
        <section class="biography">Problems in string theory and supersymmetric field theory</section>
      </main>
    </body>
  </html>
`;

const profileOverviewAfterContactHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://medicine.yale.edu/profile/susan-baserga/" />
      <meta property="og:image" content="https://ysm-res.cloudinary.com/image/upload/example/susan-baserga" />
    </head>
    <body>
      <main>
        <h1>Susan Baserga, MD, PhD</h1>
        <div class="title">
          William H. Fleming, M.D. Professor of Molecular Biophysics and Biochemistry
        </div>
        <a href="mailto:susan.baserga@yale.edu">susan.baserga@yale.edu</a>
        <p class="profile-details-mailing-address__name">Molecular Biophysics and Biochemistry</p>
        <p class="profile-details-mailing-address__street">PO Box 208024, 333 Cedar Street</p>
        <h3 class="profile-details-content-section__heading">Overview</h3>
        <p>
          Study of RNA helicases required for ribosome biogenesis and their cofactors,
          including investigations into the role of ribosome biogenesis in cell cycle regulation.
        </p>
      </main>
    </body>
  </html>
`;

const navigationResearchProgramProfileHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://medicine.yale.edu/profile/joseph-santos-sacchi/" />
      <script type="application/ld+json" data-schema="ProfilePage">
        {
          "@type": "ProfilePage",
          "mainEntity": {
            "@type": "Person",
            "name": "Joseph Santos-Sacchi",
            "email": "joseph.santos-sacchi@yale.edu",
            "jobTitle": "Professor of Surgery",
            "description": "Joseph Santos-Sacchi directs the Yale Ear Lab.",
            "affiliation": [
              {
                "@type": "Organization",
                "name": "Yale Ear Lab"
              },
              {
                "@type": "Organization",
                "name": "Interdepartmental Neuroscience Program",
                "url": "https://medicine.yale.edu/inp/"
              }
            ]
          }
        }
      </script>
    </head>
    <body>
      <main>
        <h1>Joseph Santos-Sacchi</h1>
        <p>Joseph Santos-Sacchi directs the Yale Ear Lab.</p>
      </main>
      <div class="navigation-panel">
        <a href="/research/investigator-resources/oher/signature-initiatives/community-research-fellows-program/">
          Community Research Fellows Program
        </a>
      </div>
      <div>
        <a href="/research/investigator-resources/oher/signature-initiatives/community-research-fellows-program/">
          Community Research Fellows Program
        </a>
      </div>
    </body>
  </html>
`;

const researchCenterAffiliationWithoutLeadershipHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://medicine.yale.edu/profile/dana-small/" />
      <script type="application/ld+json" data-schema="ProfilePage">
        {
          "@type": "ProfilePage",
          "mainEntity": {
            "@type": "Person",
            "name": "Dana Small",
            "email": "dana.small@yale.edu",
            "jobTitle": "Professor",
            "description": "Dana Small studies nutrition and neural circuits.",
            "affiliation": [
              {
                "@type": "Organization",
                "name": "Center for Nicotine and Tobacco Use Research at Yale",
                "url": "https://medicine.yale.edu/psychiatry/research/clinics-and-programs/tobacco-research/century/"
              }
            ]
          }
        }
      </script>
    </head>
    <body>
      <main>
        <p>Dana Small studies nutrition and neural circuits.</p>
      </main>
    </body>
  </html>
`;

const centerPrefixProgramTitleHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://medicine.yale.edu/profile/wendy-silverman/" />
      <script type="application/ld+json" data-schema="ProfilePage">
        {
          "@type": "ProfilePage",
          "mainEntity": {
            "@type": "Person",
            "name": "Wendy Silverman",
            "email": "wendy.silverman@yale.edu",
            "jobTitle": "Professor",
            "description": "Wendy Silverman is Director, Yale Child Study Center Program for Anxiety Disorders. She is also Director of the Yale Child Study Center Anxiety and Mood Disorders Program.",
            "affiliation": [
              {
                "@type": "Organization",
                "name": "Child Study Center",
                "url": "https://medicine.yale.edu/childstudy/"
              }
            ]
          }
        }
      </script>
    </head>
    <body>
      <main>
        <p>
          Wendy Silverman is Director, Yale Child Study Center Program for Anxiety Disorders.
          She is also Director of the Yale Child Study Center Anxiety and Mood Disorders Program.
        </p>
      </main>
    </body>
  </html>
`;

const broadChildStudyCenterLeadershipHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://medicine.yale.edu/profile/linda-mayes/" />
      <script type="application/ld+json" data-schema="ProfilePage">
        {
          "@type": "ProfilePage",
          "mainEntity": {
            "@type": "Person",
            "name": "Linda Mayes",
            "email": "linda.mayes@yale.edu",
            "jobTitle": "Professor",
            "description": "Linda Mayes is Chair of the Child Study Center.",
            "affiliation": [
              {
                "@type": "Organization",
                "name": "Child Study Center",
                "url": "https://medicine.yale.edu/childstudy/"
              }
            ]
          }
        }
      </script>
    </head>
    <body>
      <main>
        <p>Linda Mayes is Chair of the Child Study Center.</p>
      </main>
    </body>
  </html>
`;

const associateDirectorSubareaProfileHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://medicine.yale.edu/profile/xenophon-papademetris/" />
      <script type="application/ld+json" data-schema="ProfilePage">
        {
          "@type": "ProfilePage",
          "mainEntity": {
            "@type": "Person",
            "name": "Xenophon Papademetris",
            "email": "xenophon.papademetris@yale.edu",
            "jobTitle": "Professor",
            "description": "Xenophon Papademetris is Associate Director of Biomedical Imaging Data Sciences, Yale Biomedical Imaging Institute.",
            "affiliation": [
              {
                "@type": "Organization",
                "name": "Yale Biomedical Imaging Institute",
                "url": "https://medicine.yale.edu/biomedical-imaging-institute/"
              }
            ]
          }
        }
      </script>
    </head>
    <body>
      <main>
        <p>
          Xenophon Papademetris is Associate Director of Biomedical Imaging Data Sciences,
          Yale Biomedical Imaging Institute.
        </p>
      </main>
    </body>
  </html>
`;

const yalePrefixedLeadershipProfileHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://medicine.yale.edu/profile/michael-nathanson/" />
      <script type="application/ld+json" data-schema="ProfilePage">
        {
          "@type": "ProfilePage",
          "mainEntity": {
            "@type": "Person",
            "name": "Michael Nathanson",
            "email": "michael.nathanson@yale.edu",
            "jobTitle": "Professor",
            "description": "Michael Nathanson is Co-Director, Yale Liver Center, Digestive Diseases.",
            "affiliation": [
              {
                "@type": "Organization",
                "name": "Liver Center",
                "url": "https://medicine.yale.edu/internal-medicine/livercenter/"
              }
            ]
          }
        }
      </script>
    </head>
    <body>
      <main>
        <p>Michael Nathanson is Co-Director, Yale Liver Center, Digestive Diseases.</p>
      </main>
    </body>
  </html>
`;

const contactInfoOnlyResearchHomeProfileHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://medicine.yale.edu/profile/dennis-moledina/" />
      <script type="application/ld+json" data-schema="ProfilePage">
        {
          "@type": "ProfilePage",
          "mainEntity": {
            "@type": "Person",
            "name": "Dennis G Moledina",
            "email": "dennis.moledina@yale.edu",
            "jobTitle": "Associate Professor",
            "description": "Dennis Moledina is Director, Research Fellowship, Nephrology; Vice Chief for Research (Clinical and translational), Nephrology; Director, Kidney BioBank, Nephrology.",
            "affiliation": [
              {
                "@type": "Organization",
                "name": "Clinical and Translational Research Accelerator",
                "url": "https://medicine.yale.edu/intmed/ctra/"
              }
            ]
          }
        }
      </script>
    </head>
    <body>
      <main>
        <section>
          <h2>Additional Titles</h2>
          <p>Director, Research Fellowship, Nephrology</p>
          <p>Vice Chief for Research (Clinical and translational), Nephrology</p>
          <p>Director, Kidney BioBank, Nephrology</p>
        </section>
        <article class="profile-details-lab">
          <h3 class="profile-details-lab__title">Clinical and Translational Research Accelerator</h3>
          <a href="https://medicine.yale.edu/intmed/ctra/"><span>View Lab Website</span></a>
        </article>
      </main>
    </body>
  </html>
`;

const profileLinkedWaxmanCenterWebsiteHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://medicine.yale.edu/profile/stephen-waxman/" />
      <script type="application/ld+json" data-schema="ProfilePage">
        {
          "@type": "ProfilePage",
          "mainEntity": {
            "@type": "Person",
            "name": "Stephen Waxman",
            "email": "stephen.waxman@yale.edu",
            "jobTitle": "Professor",
            "description": "Stephen Waxman founded the Neuroscience & Regeneration Research Center at Yale in 1988 and is its Director."
          }
        }
      </script>
    </head>
    <body>
      <main>
        <p>Stephen Waxman founded the Neuroscience & Regeneration Research Center at Yale in 1988 and is its Director.</p>
        <article class="profile-details-lab">
          <h3 class="profile-details-lab__title">Waxman Lab/Center for Neuroscience & Regeneration Research</h3>
          <a href="https://medicine.yale.edu/cnrr/index.aspx"><span>View Lab Website</span></a>
        </article>
      </main>
    </body>
  </html>
`;

const profileLinkedDaycareWebsiteHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://medicine.yale.edu/profile/carla-horwitz/" />
      <script type="application/ld+json" data-schema="ProfilePage">
        {
          "@type": "ProfilePage",
          "mainEntity": {
            "@type": "Person",
            "name": "Carla Horwitz",
            "email": "carla.horwitz@yale.edu",
            "jobTitle": "Associate Research Scientist",
            "description": "Carla Horwitz is affiliated with the Calvin Hill Day Care Center and Kitty Lustman-Findling Kindergarten."
          }
        }
      </script>
    </head>
    <body>
      <main>
        <article class="profile-details-lab">
          <h3 class="profile-details-lab__title">Calvin Hill Day Care Center and Kitty Lustman-Findling Kindergarten</h3>
          <a href="https://calvinhilldaycare.org/"><span>View Lab Website</span></a>
        </article>
      </main>
    </body>
  </html>
`;

const profileLinkedLeadershipProgramWebsiteHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://politicalscience.yale.edu/people/jacob-hacker/" />
    </head>
    <body>
      <main>
        <p>
          Jacob Hacker is Co-Director of the Ludwig Program in Public Sector Leadership
          at Yale Law School and a resident fellow of the Institution for Social and Policy Studies.
        </p>
        <article class="profile-details-lab">
          <h3 class="profile-details-lab__title">Ludwig Program in Public Sector Leadership at Yale Law School</h3>
          <a href="https://law.yale.edu/leadership/public-sector/"><span>View Lab Website</span></a>
        </article>
      </main>
    </body>
  </html>
`;

const profileLinkedAcademicProgramWebsiteHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://history.yale.edu/people/paul-freedman/" />
    </head>
    <body>
      <main>
        <p>Paul Freedman is associated with the Medieval Studies Program.</p>
        <article class="profile-details-lab">
          <h3 class="profile-details-lab__title">Medieval Studies Program</h3>
          <a href="http://www.yale.edu/medieval/"><span>View Lab Website</span></a>
        </article>
      </main>
    </body>
  </html>
`;

const profileLinkedDiagnosticServiceWebsiteHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://medicine.yale.edu/profile/allen-bale/" />
    </head>
    <body>
      <main>
        <p>Allen Bale is Director, DNA Diagnostic Lab.</p>
        <article class="profile-details-lab">
          <h3 class="profile-details-lab__title">Yale DNA Diagnostic Laboratory</h3>
          <a href="https://medicine.yale.edu/genetics/dna/"><span>View Lab Website</span></a>
        </article>
      </main>
    </body>
  </html>
`;

const profileLinkedBroadChildStudyResearchWebsiteHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://medicine.yale.edu/profile/sara-sanchez-alonso/" />
    </head>
    <body>
      <main>
        <p>Sara Sanchez-Alonso worked with Richard Aslin and Katarzyna Chawarska.</p>
        <article class="profile-details-lab">
          <h3 class="profile-details-lab__title">Aslin / Chawarska Labs</h3>
          <a href="https://medicine.yale.edu/childstudy/research/"><span>View Lab Website</span></a>
        </article>
      </main>
    </body>
  </html>
`;

const profileLinkedGoogleSiteLabWebsiteHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://medicine.yale.edu/profile/rajiv-radhakrishnan/" />
    </head>
    <body>
      <main>
        <p>Rajiv Radhakrishnan directs the Radhakrishnan Lab.</p>
        <article class="profile-details-lab">
          <h3 class="profile-details-lab__title">Radhakrishnan Lab</h3>
          <a href="https://sites.google.com/view/radhakrishnan-lab/home/"><span>View Lab Website</span></a>
        </article>
      </main>
    </body>
  </html>
`;

const profileLinkedEducationProgramWebsiteHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://medicine.yale.edu/profile/michael-cappello/" />
    </head>
    <body>
      <main>
        <p>Michael Cappello is involved with the MD-PhD Program.</p>
        <article class="profile-details-lab">
          <h3 class="profile-details-lab__title">MD-PhD Program</h3>
          <a href="https://medicine.yale.edu/mdphd/"><span>View Lab Website</span></a>
        </article>
      </main>
    </body>
  </html>
`;

const profileLinkedBroadDepartmentWebsiteHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://medicine.yale.edu/profile/kei-cheung/" />
    </head>
    <body>
      <main>
        <p>Kei Cheung works in Biomedical Informatics &amp; Data Science.</p>
        <article class="profile-details-lab">
          <h3 class="profile-details-lab__title">Biomedical Informatics &amp; Data Science</h3>
          <a href="https://medicine.yale.edu/biomedical-informatics-data-science/"><span>View Lab Website</span></a>
        </article>
      </main>
    </body>
  </html>
`;

const profileLinkedClinicalProgramWebsiteHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://medicine.yale.edu/profile/daniel-wiznia/" />
    </head>
    <body>
      <main>
        <p>Daniel Wiznia is affiliated with the Yale Avascular Necrosis Program.</p>
        <article class="profile-details-lab">
          <h3 class="profile-details-lab__title">Yale Avascular Necrosis Program</h3>
          <a href="https://www.yalemedicine.org/departments/avascular-necrosis-and-osteonecrosis-program/"><span>View Lab Website</span></a>
        </article>
      </main>
    </body>
  </html>
`;

const profileLinkedStaleResearchWebsiteHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://medicine.yale.edu/profile/annie-harper/" />
    </head>
    <body>
      <main>
        <p>Annie Harper directs the Recovery Finance Project.</p>
        <article class="profile-details-lab">
          <h3 class="profile-details-lab__title">Recovery Finance Project</h3>
          <a href="https://medicine.yale.edu/psychiatry/prch/research/recovery-finance-project/"><span>View Lab Website</span></a>
        </article>
      </main>
    </body>
  </html>
`;

const profileLinkedStaleExternalWebsiteHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://medicine.yale.edu/profile/berna-sozen/" />
    </head>
    <body>
      <main>
        <p>Berna Sozen leads the modelling development and disease lab.</p>
        <article class="profile-details-lab">
          <h3 class="profile-details-lab__title">modelling development &amp; disease</h3>
          <a href="https://www.sozenlab.org/"><span>View Lab Website</span></a>
        </article>
      </main>
    </body>
  </html>
`;

const profileLinkedThinExternalWebsiteHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://medicine.yale.edu/profile/elizabeth-connors/" />
    </head>
    <body>
      <main>
        <p>Elizabeth Connors works with Partnerships for Research and Implementation in School Mental Health.</p>
        <article class="profile-details-lab">
          <h3 class="profile-details-lab__title">Partnerships for Research and Implementation in School Mental Health</h3>
          <a href="https://partnershipsforschools.org/"><span>View Lab Website</span></a>
        </article>
      </main>
    </body>
  </html>
`;

const profileLinkedMrrcAliasWebsiteHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://medicine.yale.edu/profile/dana-peters/" />
    </head>
    <body>
      <main>
        <p>Dana Peters is affiliated with the Magnetic Resonance Research Center.</p>
        <article class="profile-details-lab">
          <h3 class="profile-details-lab__title">Magnetic Resonance Research Center</h3>
          <a href="https://mrrc.yale.edu/"><span>View Lab Website</span></a>
        </article>
      </main>
    </body>
  </html>
`;

const profileLinkedPainCollaboratoryWebsiteHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://medicine.yale.edu/profile/robert-kerns/" />
    </head>
    <body>
      <main>
        <p>Robert Kerns is affiliated with the Pain Management Collaboratory Coordinating Center.</p>
        <article class="profile-details-lab">
          <h3 class="profile-details-lab__title">Pain Management Collaboratory Coordinating Center</h3>
          <a href="https://www.painmanagementcollaboratory.org/"><span>View Lab Website</span></a>
        </article>
      </main>
    </body>
  </html>
`;

const profileLinkedYWeightWebsiteHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://medicine.yale.edu/profile/ania-jastreboff/" />
    </head>
    <body>
      <main>
        <p>Ania Jastreboff directs the Yale Obesity Research Center (Y-Weight).</p>
        <article class="profile-details-lab">
          <h3 class="profile-details-lab__title">Y-Weight: Yale Obesity Research Center Investigating novel pharmacological therapeutics for obesity treatment and probing the mechanisms of obesity in translational physiology studies</h3>
          <a href="https://medicine.yale.edu/y-weight/research/"><span>View Lab Website</span></a>
        </article>
      </main>
    </body>
  </html>
`;

const profileLinkedNourishTeamWebsiteHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://medicine.yale.edu/profile/catherine-buck/" />
    </head>
    <body>
      <main>
        <p>Catherine Buck is affiliated with the Yale Neonatal NOuRISH Team.</p>
        <article class="profile-details-lab">
          <h3 class="profile-details-lab__title">Yale Neonatal NOuRISH Team</h3>
          <a href="https://medicine.yale.edu/pediatrics/perinatal/research/nourish_program/"><span>View Lab Website</span></a>
        </article>
      </main>
    </body>
  </html>
`;

const profileLinkedCardsLabWebsiteHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://medicine.yale.edu/profile/rohan-khera/" />
    </head>
    <body>
      <main>
        <p>Rohan Khera leads the CarDS Lab.</p>
        <article class="profile-details-lab">
          <h3 class="profile-details-lab__title">CarDS Lab</h3>
          <a href="https://www.cards-lab.org/"><span>View Lab Website</span></a>
        </article>
      </main>
    </body>
  </html>
`;

const profileLinkedPersonPageWebsiteHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://medicine.yale.edu/profile/leonard-kaczmarek/" />
    </head>
    <body>
      <main>
        <p>Leonard Kaczmarek leads the Kaczmarek Lab.</p>
        <article class="profile-details-lab">
          <h3 class="profile-details-lab__title">Kaczmarek Lab</h3>
          <a href="https://pharmacology.yale.edu/people/leonard_kaczmarek.profile"><span>View Lab Website</span></a>
        </article>
      </main>
    </body>
  </html>
`;

const profileLinkedExternalLabWebsiteHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://medicine.yale.edu/profile/haifan-lin/" />
      <script type="application/ld+json" data-schema="ProfilePage">
        {
          "@type": "ProfilePage",
          "mainEntity": {
            "@type": "Person",
            "name": "Haifan Lin, PhD",
            "email": "haifan.lin@yale.edu",
            "jobTitle": "Professor",
            "description": "Haifan Lin is Director, Yale Stem Cell Center.",
            "affiliation": [
              {
                "@type": "Organization",
                "name": "Yale Stem Cell Center",
                "url": "https://medicine.yale.edu/stemcell/"
              }
            ]
          }
        }
      </script>
    </head>
    <body>
      <main>
        <p>Haifan Lin is Director, Yale Stem Cell Center.</p>
        <div>Haifan Lin Lab<a href="https://www.haifanlinlab.org/">View Lab Website</a></div>
      </main>
    </body>
  </html>
`;

const profileLinkedNamedLabWebsiteHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://medicine.yale.edu/profile/mark-lemmon/" />
      <script type="application/ld+json" data-schema="ProfilePage">
        {
          "@type": "ProfilePage",
          "mainEntity": {
            "@type": "Person",
            "name": "Mark A Lemmon",
            "email": "mark.lemmon@yale.edu",
            "jobTitle": "Professor",
            "description": "Mark Lemmon studies cell signaling.",
            "affiliation": [
              {
                "@type": "Organization",
                "name": "Yale Cancer Biology Institute",
                "url": "https://medicine.yale.edu/cancer-biology-institute/"
              }
            ]
          }
        }
      </script>
    </head>
    <body>
      <main>
        <h1>Mark A Lemmon</h1>
        <p>Mark Lemmon studies cell signaling.</p>
        <div>
          Lemmon and Ferguson Labs
          <a href="https://www.lemmonfergusonlabs.com/">View Lab Website</a>
        </div>
      </main>
    </body>
  </html>
`;

const profileLinkedIconLabWebsiteHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://medicine.yale.edu/profile/michelle-hampson/" />
      <script type="application/ld+json" data-schema="ProfilePage">
        {
          "@type": "ProfilePage",
          "mainEntity": {
            "@type": "Person",
            "name": "Michelle Hampson",
            "email": "michelle.hampson@yale.edu",
            "jobTitle": "Professor",
            "description": "Michelle Hampson studies fMRI neurofeedback."
          }
        }
      </script>
    </head>
    <body>
      <main>
        <h1>Michelle Hampson</h1>
        <div>
          <svg><title>Lab Whisk Cup Streamline Icon: https://streamlinehq.com</title></svg>Hampson labOur lab studies the human brain with a focus on clinical populations.
          <a href="https://campuspress.yale.edu/hampsonlab/">View Lab Website</a>
        </div>
      </main>
    </body>
  </html>
`;

const profileLinkedBioImageProjectWebsiteHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://medicine.yale.edu/profile/xenophon-papademetris/" />
      <script type="application/ld+json" data-schema="ProfilePage">
        {
          "@type": "ProfilePage",
          "mainEntity": {
            "@type": "Person",
            "name": "Xenophon Papademetris",
            "email": "xenophon.papademetris@yale.edu",
            "jobTitle": "Professor",
            "description": "Xenophon Papademetris develops medical image analysis software."
          }
        }
      </script>
    </head>
    <body>
      <main>
        <h1>Xenophon Papademetris</h1>
        <div>
          <svg><title>Lab Whisk Cup Streamline Icon: https://streamlinehq.com</title></svg>BioImage Suite Project
          <a href="https://bioimagesuiteweb.github.io/webapp/">View Lab Website</a>
        </div>
      </main>
    </body>
  </html>
`;

const profileLinkedSquirrelLabWebsiteHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://medicine.yale.edu/profile/elena-gracheva/" />
      <script type="application/ld+json" data-schema="ProfilePage">
        {
          "@type": "ProfilePage",
          "mainEntity": {
            "@type": "Person",
            "name": "Elena Gracheva",
            "email": "elena.gracheva@yale.edu",
            "jobTitle": "Professor",
            "description": "Elena Gracheva studies sensory physiology and hibernation biology."
          }
        }
      </script>
    </head>
    <body>
      <main>
        <h1>Elena Gracheva</h1>
        <div>
          Elena Lab
          <a href="https://squirrel.commons.yale.edu/">View Lab Website</a>
        </div>
      </main>
    </body>
  </html>
`;

const profileLinkedSlavLabWebsiteHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://medicine.yale.edu/profile/sviatoslav-bagriantsev/" />
      <script type="application/ld+json" data-schema="ProfilePage">
        {
          "@type": "ProfilePage",
          "mainEntity": {
            "@type": "Person",
            "name": "Slav Bagriantsev",
            "email": "slav.bagriantsev@yale.edu",
            "jobTitle": "Professor",
            "description": "Slav Bagriantsev studies sensory physiology and ion channels."
          }
        }
      </script>
    </head>
    <body>
      <main>
        <h1>Slav Bagriantsev</h1>
        <div>
          The Slav Lab
          <a href="https://slavlab.yale.edu">View Lab Website</a>
        </div>
      </main>
    </body>
  </html>
`;

const profileLinkedYcscLabWebsiteHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://medicine.yale.edu/profile/wan-ling-tseng/" />
      <script type="application/ld+json" data-schema="ProfilePage">
        {
          "@type": "ProfilePage",
          "mainEntity": {
            "@type": "Person",
            "name": "Wan-Ling Tseng",
            "email": "wan-ling.tseng@yale.edu",
            "jobTitle": "Professor",
            "description": "Wan-Ling Tseng studies youth affective development."
          }
        }
      </script>
    </head>
    <body>
      <main>
        <h1>Wan-Ling Tseng</h1>
        <div>
          <svg><title>Lab Whisk Cup Streamline Icon: https://streamlinehq.com</title></svg>
          The Ycsc Affective Youth (YAY) Lab
          <a href="https://medicine.yale.edu/childstudy/research/collaborative-labs/yay-lab/">View Lab Website</a>
        </div>
      </main>
    </body>
  </html>
`;

const profileLinkedLegacyChildStudyLabWebsiteHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://medicine.yale.edu/profile/linda-mayes/" />
      <script type="application/ld+json" data-schema="ProfilePage">
        {
          "@type": "ProfilePage",
          "mainEntity": {
            "@type": "Person",
            "name": "Linda Mayes",
            "email": "linda.mayes@yale.edu",
            "jobTitle": "Professor",
            "description": "Linda Mayes is Director of the Yale Developmental Electrophysiology Laboratory."
          }
        }
      </script>
    </head>
    <body>
      <main>
        <h1>Linda Mayes</h1>
        <div>
          Developmental Electrophysiology Laboratory
          <a href="https://childstudycenter.yale.edu/research/del/">View Lab Website</a>
        </div>
      </main>
    </body>
  </html>
`;

const profileLinkedParentheticalLabWebsiteHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://medicine.yale.edu/profile/carla-stover/" />
      <script type="application/ld+json" data-schema="ProfilePage">
        {
          "@type": "ProfilePage",
          "mainEntity": {
            "@type": "Person",
            "name": "Carla Stover",
            "email": "carla.stover@yale.edu",
            "jobTitle": "Professor",
            "description": "Carla Stover develops interventions for families impacted by violence and trauma."
          }
        }
      </script>
    </head>
    <body>
      <main>
        <h1>Carla Stover</h1>
        <div>
          <svg><title>Lab Whisk Cup Streamline Icon: https://streamlinehq.com</title></svg>
          Fathers for Change (Stover Lab)Our lab is focused on interventions for families impacted by violence and trauma.
          <a href="https://medicine.yale.edu/childstudy/research/community-and-implementation/fathers-for-change/">View Lab Website</a>
        </div>
      </main>
    </body>
  </html>
`;

const outsideYaleDeputyDirectorProfileHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://medicine.yale.edu/profile/andrew-tan/" />
      <script type="application/ld+json" data-schema="ProfilePage">
        {
          "@type": "ProfilePage",
          "mainEntity": {
            "@type": "Person",
            "name": "Andrew Tan",
            "email": "andrew.tan@yale.edu",
            "jobTitle": "Assistant Professor Adjunct",
            "description": "Andrew Tan is Deputy Director, Center for Neuroscience and Regeneration Research, US Department of Veteran Affairs.",
            "affiliation": [
              {
                "@type": "Organization",
                "name": "Center for Neuroscience and Regeneration Research",
                "url": "https://medicine.yale.edu/cnrr/"
              }
            ]
          }
        }
      </script>
    </head>
    <body>
      <main>
        <section>
          <h2>Positions outside Yale</h2>
          <p>
            Deputy Director, Center for Neuroscience and Regeneration Research,
            US Department of Veteran Affairs
          </p>
        </section>
      </main>
    </body>
  </html>
`;

const outsideYaleNoSeparatorDeputyProfileHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://medicine.yale.edu/profile/andrew-tan/" />
      <script type="application/ld+json" data-schema="ProfilePage">
        {
          "@type": "ProfilePage",
          "mainEntity": {
            "@type": "Person",
            "name": "Andrew Tan",
            "email": "andrew.tan@yale.edu",
            "jobTitle": "Assistant Professor Adjunct",
            "description": "Andrew Tan studies spinal cord injury.",
            "affiliation": [
              {
                "@type": "Organization",
                "name": "Center for Neuroscience and Regeneration Research",
                "url": "https://medicine.yale.edu/cnrr/"
              }
            ]
          }
        }
      </script>
    </head>
    <body>
      <main>
        <section><h2>Positions outside Yale</h2><p>Deputy Director, Center for Neuroscience and Regeneration Research, US Department of Veteran Affairs</p></section>
      </main>
    </body>
  </html>
`;

function contextFor(emitted: ObservationInput[]): ScraperContext {
  return {
    scrapeRunId: 'run-1',
    sourceId: 'source-1',
    sourceName: 'official-profile-pi-backfill',
    sourceWeight: 0.95,
    options: { dryRun: true, useCache: false, release: false, only: ['medicine-pi-backfill'] },
    emit: vi.fn(async (obs: ObservationInput | ObservationInput[]) => {
      emitted.push(...(Array.isArray(obs) ? obs : [obs]));
    }),
    log: vi.fn(),
  };
}

function visibleBioContextFor(emitted: ObservationInput[]): ScraperContext {
  return {
    ...contextFor(emitted),
    options: { dryRun: true, useCache: false, release: false, only: ['visible-profile-bio-backfill'] },
  };
}

function profileDescriptionContextFor(emitted: ObservationInput[]): ScraperContext {
  return {
    ...contextFor(emitted),
    options: { dryRun: true, useCache: false, release: false, only: ['profile-description-backfill'] },
  };
}

function profileResearchHomeContextFor(emitted: ObservationInput[]): ScraperContext {
  return {
    ...contextFor(emitted),
    options: {
      dryRun: true,
      useCache: false,
      release: false,
      only: ['profile-research-home-backfill'],
    },
  };
}

describe('officialProfilePiBackfillScraper', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('normalizes Yale Medicine section profile URLs to canonical profile URLs', () => {
    expect(
      normalizeOfficialProfileUrl('https://medicine.yale.edu/cancer/profile/joseph-w-kim'),
    ).toBe(profileUrl);
  });

  it('selects official profile URL candidates from trusted entity source fields', () => {
    expect(
      officialProfileUrlsForEntity({
        websiteUrl: 'https://medicine.yale.edu/cancer/profile/joseph-w-kim',
        sourceUrls: ['https://example.com/not-profile'],
      }),
    ).toEqual([profileUrl]);
  });

  it('selects matching official person URLs from observation source fields', () => {
    expect(
      officialProfileUrlsForEntity({
        name: 'David Cameron — Research',
        sourceObservationUrls: [
          'http://politicalscience.yale.edu/people/david-cameron',
          'https://politicalscience.yale.edu/people/faculty',
        ],
      }),
    ).toEqual(['http://politicalscience.yale.edu/people/david-cameron/']);
  });

  it('selects matching Yale Law direct profile URLs from observation source fields', () => {
    expect(
      officialProfileUrlsForEntity({
        name: 'Anthony Kronman — Research',
        sourceObservationUrls: [
          'https://law.yale.edu/anthony-t-kronman',
          'https://law.yale.edu/news',
        ],
      }),
    ).toEqual(['https://law.yale.edu/anthony-t-kronman/']);
  });

  it('rejects mismatched observation-sourced official person URLs', () => {
    expect(
      officialProfileUrlsForEntity({
        name: 'Nancy Brown — Research',
        sourceObservationUrls: ['https://history.yale.edu/people/joanne-brown/'],
      }),
    ).toEqual([]);
  });

  it('rejects lab and center homepages as official profile URL candidates', () => {
    expect(
      officialProfileUrlsForEntity({
        name: '3D Tumor Lab',
        websiteUrl: 'https://medicine.yale.edu/lab/3d-tumor-lab/',
        sourceUrls: ['https://medicine.yale.edu/lab/3d-tumor-lab/'],
      }),
    ).toEqual([]);
    expect(
      officialProfileUrlsForEntity({
        name: 'Johnson Center for the Study of American Diplomacy',
        websiteUrl:
          'https://jackson.yale.edu/centers-initiatives/johnson-center-study-american-diplomacy/',
      }),
    ).toEqual([]);
  });

  it('accepts validated non-Medicine Yale profile URLs for queued PI repair', () => {
    const entity = {
      websiteUrl: 'https://anthropology.yale.edu/profile/richard-bribiescas',
      sourceUrls: ['https://anthropology.yale.edu/people/faculty'],
    };

    expect(officialProfileUrlsForEntity(entity)).toEqual([
      'https://anthropology.yale.edu/profile/richard-bribiescas/',
    ]);
    expect(shouldQueueEntityForPiBackfill(entity)).toBe(true);
  });

  it('prefers Medicine profile URLs when multiple official profiles are available', () => {
    expect(
      preferredOfficialProfileUrl([
        'https://anthropology.yale.edu/profile/richard-bribiescas/',
        'https://medicine.yale.edu/profile/richard-bribiescas/',
      ]),
    ).toBe('https://medicine.yale.edu/profile/richard-bribiescas/');
  });

  it('selects direct lead research-home URLs while rejecting profile pages and documents', () => {
    expect(
      leadDirectResearchHomeUrlsForUser({
        websiteUrl: 'https://deckerlab.yale.edu',
        website: 'https://environment.yale.edu/directory/faculty/shimon-anisfeld/',
        profileUrls: {
          official: 'https://medicine.yale.edu/profile/example-person/',
          cv: 'https://law.yale.edu/sites/default/files/documents/biographical-statement.pdf',
          personal: 'https://pmaronow.github.io/',
        },
      }),
    ).toEqual(['https://deckerlab.yale.edu/', 'https://pmaronow.github.io/']);
  });

  it('selects observation-sourced direct research-home URLs for entity website repair', () => {
    expect(
      leadDirectResearchHomeUrlsForEntity({
        sourceUrls: [
          'https://medicine.yale.edu/profile/example-person/',
          'https://law.yale.edu/sites/default/files/documents/biographical-statement.pdf',
          'https://hmgibbs.com/',
        ],
        sourceObservationUrls: [
          'https://campuspress.yale.edu/seylabenhabib/',
          'https://history.yale.edu/people/joanne-brown/',
          'http://staverlab.yale.edu/',
        ],
      }),
    ).toEqual([
      'https://hmgibbs.com/',
      'https://campuspress.yale.edu/seylabenhabib/',
      'http://staverlab.yale.edu/',
    ]);
  });

  it('selects the first direct lead research-home URL not already used by another entity', () => {
    expect(
      firstNonDuplicateLeadDirectWebsiteUrl(
        ['http://cncl.yale.edu/', 'https://unique-research-home.example/'],
        new Set(['http://cncl.yale.edu/']),
      ),
    ).toBe('https://unique-research-home.example/');
    expect(
      firstNonDuplicateLeadDirectWebsiteUrl(
        ['http://cncl.yale.edu/'],
        new Set(['http://cncl.yale.edu/']),
      ),
    ).toBe('');
    expect(
      firstNonDuplicateLeadDirectWebsiteUrl(
        ['https://www.kalindivora.com/'],
        new Set(['http://www.kalindivora.com/']),
      ),
    ).toBe('');
  });

  it('builds protocol variants for website duplicate lookups', () => {
    expect(websiteDuplicateLookupUrls('https://www.kalindivora.com/')).toEqual([
      'https://www.kalindivora.com/',
      'http://www.kalindivora.com/',
    ]);
  });

  it('selects direct research-home source URLs while rejecting generic directories', () => {
    expect(
      sourceUrlResearchHomeUrlsForEntity({
        sourceUrls: [
          'https://medicine.yale.edu/cancer/research/membership/directory/',
          'http://psychology.yale.edu/diversity/research-opportunities-undergraduates/',
          'https://bartholomewlab.yale.edu',
          'https://posada.website/',
        ],
      }),
    ).toEqual(['https://bartholomewlab.yale.edu/', 'https://posada.website/']);
  });

  it('rejects source URLs that are broad pages, person profiles, or scholarly directories', () => {
    expect(
      sourceUrlResearchHomeUrlsForEntity({
        sourceUrls: [
          'http://art.yale.edu/SheilaLevrantDeBretteville/',
          'http://mba.yale.edu/story/2026/prof-song-ma-named-young-global-leader-world-economic-forum/',
          'http://russian-studies.yale.edu/node/3002491/reees-people/',
          'https://gsp.yale.edu/',
          'https://yale.academia.edu/JohnMacKay/',
          'http://astronomy.yale.edu/search/user/',
          'http://epilepsy.yale.edu/',
          'https://earth.yale.edu/opportunities-0/',
          'https://wti.yale.edu/humans/faculty',
          'http://www.ispu.org/scholars/hamada-hamid/',
          'https://sites.google.com/site/costasmeghir/home/',
          'https://alexandercoppock.com/',
          'http://www.yale.edu/macmillan/shapiro/index.htm',
          'https://rjohnwilliams.wordpress.com/',
          'http://www.yale.edu/pollard_lab/',
          'http://www.yale.edu/errington/',
          'https://hazarigroup.yale.edu/opportunities/',
          'https://bartholomewlab.yale.edu/',
        ],
      }),
    ).toEqual([
      'https://campuspress.yale.edu/rjohnwilliams/',
      'http://www.yale.edu/pollard_lab/',
      'http://www.yale.edu/errington/',
      'https://hazarigroup.yale.edu/opportunities/',
      'https://bartholomewlab.yale.edu/',
    ]);
  });

  it('extracts repair-grade identity only with canonical match, name match, and Yale email', () => {
    const identity = extractOfficialProfileIdentity(profileHtml, profileUrl, {
      name: 'Joseph Kim Research Area',
      slug: 'faculty-research-area-joseph-kim',
    });

    expect(identity).toMatchObject({
      canonicalUrl: profileUrl,
      fetchedUrl: profileUrl,
      displayName: 'Joseph W. Kim',
      email: 'joseph.kim@yale.edu',
      title: 'Professor of Surgery (Oncology)',
      imageUrl: 'https://ysm-res.cloudinary.com/image/upload/example/joseph-kim',
    });
    expect(identity?.researchInterests).toEqual(['Cancer biology', 'Translational oncology']);
  });

  it('accepts canonicalized department person pages when both URLs match the entity person', () => {
    const identity = extractOfficialProfileIdentity(
      departmentPersonPageHtml,
      departmentPersonPageUrl.replace(/^https:/, 'http:'),
      {
        name: 'Dana Angluin — Research',
        slug: 'angluin-da3',
      },
    );

    expect(identity).toMatchObject({
      canonicalUrl: departmentPersonPageUrl,
      fetchedUrl: departmentPersonPageUrl.replace(/^https:/, 'http:'),
      displayName: 'Dana Angluin',
      email: 'dana.angluin@yale.edu',
      title: 'Professor Emeritus of Computer Science',
    });
  });

  it('accepts redirected official profile pages when an attached lead user matches the canonical person page', () => {
    const identity = extractOfficialProfileIdentity(
      redirectedDirectoryProfileHtml,
      'http://environment.yale.edu/profile/clark/',
      {
        name: 'Clark Lab',
        slug: 'clark-lab-twc4',
        leadUsers: [
          {
            fname: 'Susan',
            lname: 'Clark',
            email: 'susan.g.clark@yale.edu',
          },
        ],
      },
      {
        requireEmail: false,
        expectedPeople: [
          {
            fname: 'Susan',
            lname: 'Clark',
            email: 'susan.g.clark@yale.edu',
          },
        ],
      },
    );

    expect(identity).toMatchObject({
      canonicalUrl: 'https://environment.yale.edu/directory/faculty/susan-g-clark/',
      fetchedUrl: 'http://environment.yale.edu/profile/clark/',
      displayName: 'Susan G. Clark',
      email: 'susan.g.clark@yale.edu',
      title: 'Joseph F. Cullman 3rd Adjunct Professor Emeritus of Wildlife Ecology and Policy Sciences',
    });
  });

  it('does not turn directory news titles or appointment lines into bios', () => {
    const identity = extractOfficialProfileIdentity(
      yseDirectoryProfileWithNewsTitleHtml,
      'https://environment.yale.edu/directory/faculty/michelle-bell/',
      {
        name: 'Michelle Bell Research',
        slug: 'faculty-research-area-michelle-bell',
      },
      {
        requireEmail: false,
        expectedPeople: [
          {
            fname: 'Michelle',
            lname: 'Bell',
            email: 'michelle.bell@yale.edu',
          },
        ],
      },
    );

    expect(identity).toMatchObject({
      title:
        'Senior Associate Dean of Research and Director of Doctoral Studies; Mary E. Pinchot Professor of Environmental Health',
      researchInterests: [],
    });

    const obs = identityToUserObservations(identity!, {
      netid: 'mlb69',
      email: 'michelle.bell@yale.edu',
    });

    expect(obs.find((o) => o.field === 'bio')).toBeUndefined();
    expect(obs.find((o) => o.field === 'researchInterests')).toBeUndefined();
    expect(obs.find((o) => o.field === 'topics')).toBeUndefined();
    expect(String(obs.find((o) => o.field === 'title')?.value || '')).not.toContain(
      'Advancing heat-related',
    );
  });

  it('does not attach another person contact email from an official profile page', () => {
    const contaminatedProfileHtml = profileHtml
      .replace(/Joseph W\. Kim/g, 'Joshua Gendron')
      .replace(/Joseph Kim/g, 'Joshua Gendron')
      .replace(/joseph\.kim@yale\.edu/g, 'susan.k.brady@yale.edu');
    const entity = {
      name: 'Joshua Gendron Research Area',
      slug: 'faculty-research-area-joshua-gendron',
    };

    expect(extractOfficialProfileIdentity(contaminatedProfileHtml, profileUrl, entity)).toBeNull();

    const identity = extractOfficialProfileIdentity(contaminatedProfileHtml, profileUrl, entity, {
      requireEmail: false,
    });
    expect(identity).toMatchObject({
      displayName: 'Joshua Gendron',
      email: '',
    });
  });

  it('skips profile chrome headings when extracting the appointment title', () => {
    const identity = extractOfficialProfileIdentity(
      profileHtml.replace(
        '<div class="title">Professor of Surgery (Oncology)</div>',
        '<div class="page-title">INFORMATION FOR</div><div class="title">Professor of Surgery (Oncology)</div>',
      ),
      profileUrl,
      {
        name: 'Joseph Kim Research Area',
        slug: 'faculty-research-area-joseph-kim',
      },
    );

    expect(identity?.title).toBe('Professor of Surgery (Oncology)');
  });

  it('skips profile chrome headings when extracting the display name', () => {
    const identity = extractOfficialProfileIdentity(
      profileHtml.replace(
        '<h1>Joseph W. Kim</h1>',
        '<h1>INFORMATION FOR</h1><h1>Joseph W. Kim, PhDResearch Scientist of Surgery</h1>',
      ),
      profileUrl,
      {
        name: 'Joseph Kim Research Area',
        slug: 'faculty-research-area-joseph-kim',
      },
    );

    expect(identity?.displayName).toBe('Joseph W. Kim');
  });

  it('rejects surname-only profile matches when the known lead person differs', () => {
    const identity = extractOfficialProfileIdentity(
      profileHtml
        .replace(/Joseph W\. Kim/g, 'Josephine Kim')
        .replace(/joseph\.kim@yale\.edu/g, 'josephine.kim@yale.edu'),
      profileUrl,
      {
        name: 'Kim Lab',
        slug: 'kim-lab-jwk42',
      },
      {
        expectedPeople: [{ fname: 'Joseph', lname: 'Kim', email: 'joseph.kim@yale.edu' }],
      },
    );

    expect(identity).toBeNull();
  });

  it('clips long official profile bios at a sentence boundary', () => {
    const longSentence =
      'Joseph W. Kim studies translational cancer biology and develops clinical research programs for gastrointestinal oncology. ';
    const identity = extractOfficialProfileIdentity(
      profileHtml.replace(
        /Joseph W\. Kim studies[\s\S]*?gastrointestinal oncology\./,
        longSentence.repeat(20),
      ),
      profileUrl,
      {
        name: 'Joseph Kim Research Area',
        slug: 'faculty-research-area-joseph-kim',
      },
    );

    expect(identity?.bio?.length).toBeLessThanOrEqual(1200);
    expect(identity?.bio).toMatch(/\.$/);
  });

  it('removes trailing official profile update metadata from extracted bios', () => {
    const identity = extractOfficialProfileIdentity(
      profileHtml.replace(
        /Joseph W\. Kim studies[\s\S]*?gastrointestinal oncology\./,
        'Joseph W. Kim studies translational cancer biology and develops clinical research programs for gastrointestinal oncology. Last Updated on December 01, 2024.',
      ),
      profileUrl,
      {
        name: 'Joseph Kim Research Area',
        slug: 'faculty-research-area-joseph-kim',
      },
    );

    expect(identity?.bio).toBe(
      'Joseph W. Kim studies translational cancer biology and develops clinical research programs for gastrointestinal oncology.',
    );
  });

  it('does not clip official profile bios at dangling honorific abbreviations', () => {
    const longBio =
      'Joseph Kim studies translational cancer biology and develops clinical research programs for gastrointestinal oncology '.repeat(
        11,
      ) + 'Dr. Kim also mentors students in clinical trial design and translational oncology. '.repeat(5);
    const identity = extractOfficialProfileIdentity(
      profileHtml.replace(/Joseph W\. Kim studies[\s\S]*?gastrointestinal oncology\./, longBio),
      profileUrl,
      {
        name: 'Joseph Kim Research Area',
        slug: 'faculty-research-area-joseph-kim',
      },
    );

    expect(identity?.bio?.length).toBeLessThanOrEqual(1200);
    expect(identity?.bio).toMatch(/[.!?]$/);
    expect(identity?.bio).not.toMatch(/\bDr\.$/);
  });

  it('derives a source-attributed bio from official interests instead of address chrome', () => {
    const identity = extractOfficialProfileIdentity(
      profileWithAddressInsteadOfBioHtml,
      'https://statistics.yale.edu/profile/anna-gilbert/',
      {
        name: 'Anna Gilbert Research',
        slug: 'faculty-research-area-anna-gilbert',
      },
    );

    const obs = identityToUserObservations(identity!, {
      netid: 'ag245',
      email: 'anna.gilbert@yale.edu',
    });
    const bio = String(obs.find((o) => o.field === 'bio')?.value || '');

    expect(bio).toContain('official Yale profile lists research interests');
    expect(bio).toContain('Sparse and Compressive Sensing Techniques');
    expect(bio).not.toContain('Kline Tower');
  });

  it('derives a source-attributed bio from official interests instead of page chrome', () => {
    const identity = extractOfficialProfileIdentity(
      profileWithChromeInsteadOfBioHtml,
      'https://engineering.yale.edu/research-and-faculty/faculty-directory/anurag-khandelwal/',
      {
        name: 'Anurag Khandelwal Research',
        slug: 'faculty-research-area-anurag-khandelwal',
      },
    );

    const obs = identityToUserObservations(identity!, {
      netid: 'ak2579',
      email: 'anurag.khandelwal@yale.edu',
    });
    const bio = String(obs.find((o) => o.field === 'bio')?.value || '');

    expect(bio).toContain('official Yale profile lists research interests');
    expect(bio).toContain('Cloud Computing and Resource Management');
    expect(bio).not.toContain('selected publications');
  });

  it('does not emit credential-only education blocks as official profile bios', () => {
    const identity = extractOfficialProfileIdentity(
      profileWithCredentialsOnlyBioHtml,
      'https://english.yale.edu/people/kim-shirkhani/',
      {
        name: 'Kim Shirkhani Research',
        slug: 'faculty-research-area-kim-shirkhani',
      },
    );

    const obs = identityToUserObservations(identity!, {
      netid: 'ks555',
      email: 'kim.shirkhani@yale.edu',
    });
    const bio = obs.find((o) => o.field === 'bio');

    expect(bio).toBeUndefined();
  });

  it('derives a source-attributed bio from official interests instead of publication-list text', () => {
    const identity = extractOfficialProfileIdentity(
      profileWithPublicationListBioHtml,
      'https://engineering.yale.edu/research-and-faculty/faculty-directory/lea-r-winter/',
      {
        name: 'Lea Winter Research',
        slug: 'faculty-research-area-lea-winter',
      },
    );

    const obs = identityToUserObservations(identity!, {
      netid: 'lw376',
      email: 'lea.winter@yale.edu',
    });
    const bio = String(obs.find((o) => o.field === 'bio')?.value || '');

    expect(bio).toContain('official Yale profile lists research interests');
    expect(bio).toContain('Sustainable chemical separations');
    expect(bio).not.toContain('Yingzheng Fan');
    expect(bio).not.toContain('Nature Materials 2024');
  });

  it('derives a source-attributed bio from official interests instead of single-citation text', () => {
    const identity = extractOfficialProfileIdentity(
      profileWithSingleCitationBioHtml,
      'https://engineering.yale.edu/research-and-faculty/faculty-directory/lea-r-winter/',
      {
        name: 'Lea Winter Research',
        slug: 'faculty-research-area-lea-winter',
      },
    );

    const obs = identityToUserObservations(identity!, {
      netid: 'lw376',
      email: 'lea.winter@yale.edu',
    });
    const bio = String(obs.find((o) => o.field === 'bio')?.value || '');

    expect(bio).toContain('official Yale profile lists research interests');
    expect(bio).toContain('Sustainable chemical separations');
    expect(bio).not.toContain('Julia Simon');
    expect(bio).not.toContain('Current Opinion in Green');
  });

  it('does not emit long appointment-only official profile blocks as bios', () => {
    const identity = extractOfficialProfileIdentity(
      profileWithLongAppointmentOnlyBioHtml,
      'https://ysph.yale.edu/profile/jason-l-schwartz/',
      {
        name: 'Jason L. Schwartz Research',
        slug: 'faculty-research-area-jason-l-schwartz',
      },
    );

    const obs = identityToUserObservations(identity!, {
      netid: 'jls289',
      email: 'jason.l.schwartz@yale.edu',
    });
    const bio = obs.find((o) => o.field === 'bio');

    expect(bio).toBeUndefined();
  });

  it('derives a source-attributed bio from official interests instead of grant metadata', () => {
    const identity = extractOfficialProfileIdentity(
      profileWithGrantProjectBioHtml,
      'https://medicine.yale.edu/profile/michael-nathanson/',
      {
        name: 'Michael Nathanson Lab',
        slug: 'lab-michael-nathanson',
      },
    );

    const obs = identityToUserObservations(identity!, {
      netid: 'mhn2',
      email: 'michael.nathanson@yale.edu',
    });
    const bio = String(obs.find((o) => o.field === 'bio')?.value || '');

    expect(bio).toContain('official Yale profile lists research interests');
    expect(bio).toContain('Calcium signaling');
    expect(bio).not.toContain('NIH P01');
    expect(bio).not.toContain('Goals:');
  });

  it('does not emit Yale Medicine clinical-profile call-to-action text as a bio', () => {
    const identity = extractOfficialProfileIdentity(
      profileWithClinicalProfileChromeBioHtml,
      'https://medicine.yale.edu/profile/samir-gautam/',
      {
        name: 'Samir Gautam Lab',
        slug: 'samir-gautam-lab',
      },
    );

    const obs = identityToUserObservations(identity!, {
      netid: 'sg448',
      email: 'samir.gautam@yale.edu',
    });
    const bio = obs.find((o) => o.field === 'bio');

    expect(bio).toBeUndefined();
  });

  it('does not emit generic voluntary faculty boilerplate as a bio', () => {
    const identity = extractOfficialProfileIdentity(
      profileHtml
        .replace(
          /Joseph W\. Kim studies translational cancer biology and develops clinical research\s+programs for gastrointestinal oncology\./,
          'Voluntary faculty are typically clinicians or others who are employed outside of the School but make significant contributions to department programs at the medical center or at affiliate institutions.',
        )
        .replace(
          '<div class="research-interests">Cancer biology; Translational oncology</div>',
          '',
        ),
      profileUrl,
      {
        name: 'Joseph Kim Research Area',
        slug: 'joseph-kim',
      },
    );

    const obs = identityToUserObservations(identity!, {
      netid: 'jwk42',
      email: 'joseph.kim@yale.edu',
    });

    expect(obs.find((o) => o.field === 'bio')).toBeUndefined();
  });

  it('does not emit single-study clinical trial abstracts as bios', () => {
    const abstractBios = [
      'Stimulating innate immunity can potentially enable us to overcome resistance to PD-(L)1 blockade. We previously conducted a phase 1 trial of cabiralizumab with sotigalimab and nivolumab in patients with melanoma.',
      'Background: Cancer testis (CT) genes are expressed in various types of cancer but otherwise restricted to normal tissues of testis and placenta. Several CT genes have shown to encode immunogenic proteins.',
    ];

    for (const bio of abstractBios) {
      const obs = identityToUserObservations(
        {
          canonicalUrl: profileUrl,
          fetchedUrl: profileUrl,
          displayName: 'Joseph Kim',
          email: 'joseph.kim@yale.edu',
          title: 'Assistant Professor of Medicine',
          departments: [],
          bio,
          researchInterests: [],
        },
        { netid: 'jwk42', email: 'joseph.kim@yale.edu' },
      );

      expect(obs.find((o) => o.field === 'bio')).toBeUndefined();
    }
  });

  it('does not emit official profile bios that include Google Scholar callouts', () => {
    const obs = identityToUserObservations(
      {
        canonicalUrl: profileUrl,
        fetchedUrl: profileUrl,
        displayName: 'Joseph Kim',
        email: 'joseph.kim@yale.edu',
        title: 'Assistant Professor of Medicine',
        departments: [],
        bio:
          'Joseph Kim studies translational cancer biology and develops clinical research programs for gastrointestinal oncology. For more on this research, refer to Dr. Kim complete Google Scholar profile.',
        researchInterests: [],
      },
      { netid: 'jwk42', email: 'joseph.kim@yale.edu' },
    );

    expect(obs.find((o) => o.field === 'bio')).toBeUndefined();
  });

  it('does not derive bios from profile title, publication-count, or external-link pseudo interests', () => {
    const pseudoInterestSets = [
      ['Research Associate 2, HSS (Psychometrician)'],
      ['More than 400 archival papers published'],
      ["For a full list, visit Prof. Hu's Google Scholar profile"],
      ['Chemicals and Drugs', 'Diseases', 'Health Care'],
    ];

    for (const researchInterests of pseudoInterestSets) {
      const obs = identityToUserObservations(
        {
          canonicalUrl: profileUrl,
          fetchedUrl: profileUrl,
          displayName: 'Joseph Kim',
          email: 'joseph.kim@yale.edu',
          title: String(researchInterests[0]),
          departments: [],
          researchInterests,
        },
        { netid: 'jwk42', email: 'joseph.kim@yale.edu' },
      );

      expect(obs.find((o) => o.field === 'bio')).toBeUndefined();
      expect(obs.find((o) => o.field === 'researchInterests')).toBeUndefined();
      expect(obs.find((o) => o.field === 'topics')).toBeUndefined();
    }
  });

  it('can emit profile bio enrichment without broad user identity fields', () => {
    const obs = identityToUserObservations(
      {
        canonicalUrl: profileUrl,
        fetchedUrl: profileUrl,
        displayName: 'Joseph Kim',
        email: 'joseph.kim@yale.edu',
        title: 'Professor of Surgery (Oncology)',
        departments: [],
        bio: 'Joseph Kim studies cancer biology and translational oncology, with a focus on identifying biomarkers and improving treatment strategies for patients with gastrointestinal malignancies.',
        imageUrl: 'https://ysm-res.cloudinary.com/image/upload/example/joseph-kim',
        researchInterests: ['Cancer biology', 'Translational oncology'],
        orcid: '0000-0001-2345-6789',
      },
      { netid: 'jwk42', email: 'joseph.kim@yale.edu' },
      {
        includeProfileEnrichment: true,
        includeIdentityEnrichment: false,
      },
    );

    expect(obs.map((o) => o.field).sort()).toEqual([
      'bio',
      'imageUrl',
      'orcid',
      'researchInterests',
      'topics',
    ]);
    expect(obs.every((o) => o.entityKey === 'netid:jwk42')).toBe(true);
  });

  it('strips inline email parentheticals before emitting official profile bios', () => {
    const obs = identityToUserObservations(
      {
        canonicalUrl: 'https://medicine.yale.edu/profile/xiaofeng-liu/',
        fetchedUrl: 'https://medicine.yale.edu/profile/xiaofeng-liu/',
        displayName: 'Xiaofeng Liu',
        email: 'xiaofeng.liu@yale.edu',
        title: 'Assistant Professor of Radiology and Biomedical Imaging',
        departments: [],
        bio:
          'Xiaofeng joined Yale in 03/2024 as an Assistant Professor (forward related email to: liuxiaof@broadinstitute.org). His research interests are centered around medical imaging, machine learning, and cancer detection.',
        researchInterests: ['medical imaging', 'machine learning', 'cancer detection'],
      },
      {
        netid: 'xl693',
        email: 'xiaofeng.liu@yale.edu',
      },
    );
    const bio = String(obs.find((o) => o.field === 'bio')?.value || '');

    expect(bio).toContain('Xiaofeng joined Yale');
    expect(bio).toContain('medical imaging');
    expect(bio).not.toContain('liuxiaof@broadinstitute.org');
    expect(bio).not.toContain('forward related email');
  });

  it('strips leading email and phone chrome before emitting official profile bios', () => {
    const obs = identityToUserObservations(
      {
        canonicalUrl: 'https://medicine.yale.edu/profile/sabrina-diano/',
        fetchedUrl: 'https://medicine.yale.edu/profile/sabrina-diano/',
        displayName: 'Sabrina Diano',
        email: 'sabrina.diano@yale.edu',
        title: 'Professor of Cellular and Molecular Physiology',
        departments: [],
        bio:
          'Sabrina Diano, Ph.D. Professor Email: sabrina.diano@yale.eduPhone: 737-1216 Dr. Sabrina Diano is a Tenure Professor in the Department of Cellular and Molecular Physiology. Her research focuses on mitochondria-endoplasmic reticulum interactions and metabolic regulation in the central nervous system.',
        researchInterests: ['mitochondria', 'metabolic regulation', 'central nervous system'],
      },
      {
        netid: 'sd69',
        email: 'sabrina.diano@yale.edu',
      },
    );
    const bio = String(obs.find((o) => o.field === 'bio')?.value || '');

    expect(bio).toMatch(/^Dr\. Sabrina Diano is/);
    expect(bio).toContain('metabolic regulation');
    expect(bio).not.toContain('Email:');
    expect(bio).not.toContain('737-1216');
    expect(bio).not.toContain('sabrina.diano@yale.edu');
  });

  it('expands a terse official research-interest bio into a readable source-attributed bio', () => {
    const identity = extractOfficialProfileIdentity(
      profileWithTerseInterestBioHtml,
      'https://physics.yale.edu/people/andrew-neitzke/',
      {
        name: 'Andrew Neitzke Research',
        slug: 'faculty-research-area-andrew-neitzke',
      },
    );

    const obs = identityToUserObservations(identity!, {
      netid: 'an123',
      email: 'andrew.neitzke@yale.edu',
    });
    const bioObservation = obs.find((o) => o.field === 'bio');
    const bio = String(bioObservation?.value || '');

    expect(bio.length).toBeGreaterThanOrEqual(120);
    expect(bio).toContain('official Yale profile lists research interests');
    expect(bio).toContain('String theory');
    expect(bio).not.toContain('..');
    expect(bio).not.toBe('Problems in string theory and supersymmetric field theory');
    expect(bioObservation?.confidenceOverride).toBe(0.86);
  });

  it('expands a clean terse official research bio even without a separate interests block', () => {
    const identity = extractOfficialProfileIdentity(
      profileWithOnlyTerseResearchBioHtml,
      'https://physics.yale.edu/people/andrew-neitzke/',
      {
        name: 'Andrew Neitzke Research',
        slug: 'faculty-research-area-andrew-neitzke',
      },
    );

    const obs = identityToUserObservations(identity!, {
      netid: 'an123',
      email: 'andrew.neitzke@yale.edu',
    });
    const bioObservation = obs.find((o) => o.field === 'bio');
    const bio = String(bioObservation?.value || '');

    expect(bio.length).toBeGreaterThanOrEqual(120);
    expect(bio).toContain('official Yale profile summarizes research in');
    expect(bio).toContain('string theory and supersymmetric field theory');
    expect(bioObservation?.confidenceOverride).toBe(0.86);
  });

  it('expands single official research-interest terms without label chrome', () => {
    const obs = identityToUserObservations(
      {
        canonicalUrl: 'https://economics.yale.edu/people/kevin-donovan/',
        fetchedUrl: 'https://economics.yale.edu/people/kevin-donovan/',
        displayName: 'Kevin Donovan',
        email: 'kevin.donovan@yale.edu',
        title: '',
        departments: [],
        researchInterests: ['Fields of Interest Development Economics'],
      },
      {
        netid: 'kd123',
        email: 'kevin.donovan@yale.edu',
      },
    );
    const bio = String(obs.find((o) => o.field === 'bio')?.value || '');

    expect(bio.length).toBeGreaterThanOrEqual(120);
    expect(bio).toContain('official Yale profile summarizes their research focus');
    expect(bio).toContain('Development Economics');
    expect(bio).not.toContain('Fields of Interest');
  });

  it('does not emit short topic fragments as visible profile bios', () => {
    const obs = identityToUserObservations(
      {
        canonicalUrl: 'https://sociology.yale.edu/profile/ramina-sotoudeh/',
        fetchedUrl: 'https://sociology.yale.edu/profile/ramina-sotoudeh/',
        displayName: 'Ramina Sotoudeh',
        email: 'ramina.sotoudeh@yale.edu',
        title: 'Assistant Professor of Sociology',
        departments: [],
        bio: 'The complex interaction between social and biological forces in shaping human behavior; sociogenomics; the sociology of culture.',
        researchInterests: [],
      },
      {
        netid: 'rs2852',
        email: 'ramina.sotoudeh@yale.edu',
      },
    );

    expect(obs.find((o) => o.field === 'bio')).toBeUndefined();
  });

  it('does not treat semicolon-delimited profile topic lists as narrative bios', () => {
    const listLikeBioHtml = `
      <html>
        <head>
          <link rel="canonical" href="https://sociology.yale.edu/profile/angel-escamilla-garcia/" />
        </head>
        <body>
          <main>
            <h1>Angel Escamilla Garcia</h1>
            <div class="title">Assistant Professor of Sociology</div>
            <a href="mailto:angel.escamillagarcia@yale.edu">angel.escamillagarcia@yale.edu</a>
            <section class="biography">
              Vulnerable populations experience the violence they face during migration journeys;
              historical revision of pioneer black sociologists scholarship on migration and a
              mixed-methods study of how gender, race, ethnicity and language shape international
              migration of Guatemalan indigenous minors; interested in intersection of ethics and
              qualitative methods in vulnerable communities
            </section>
          </main>
        </body>
      </html>
    `;
    const identity = extractOfficialProfileIdentity(
      listLikeBioHtml,
      'https://sociology.yale.edu/profile/angel-escamilla-garcia/',
      {
        name: 'Angel Escamilla Garcia — Research',
        slug: 'angel-escamilla-garcia-research',
      },
    );

    const obs = identityToUserObservations(identity!, {
      netid: 'ae533',
      email: 'angel.escamillagarcia@yale.edu',
    });

    expect(identity?.bio).toBeUndefined();
    expect(obs.find((o) => o.field === 'bio')).toBeUndefined();
  });

  it('skips Yale Medicine contact paragraphs and extracts the research overview as bio', () => {
    const identity = extractOfficialProfileIdentity(
      profileOverviewAfterContactHtml,
      'https://medicine.yale.edu/profile/susan-baserga/',
      {
        name: 'Susan Baserga Research Area',
        slug: 'faculty-research-area-susan-baserga',
      },
    );

    expect(identity?.bio).toContain('Study of RNA helicases');
    expect(identity?.bio).not.toContain('PO Box');
  });

  it('rejects official profiles when canonical URL does not match the queued entity URL', () => {
    expect(
      extractOfficialProfileIdentity(
        profileHtml.replace(profileUrl, 'https://medicine.yale.edu/profile/different-person/'),
        profileUrl,
        { name: 'Joseph Kim Research Area', slug: 'faculty-research-area-joseph-kim' },
      ),
    ).toBeNull();
  });

  it('emits user observations keyed by Yale netid and no research membership observations', () => {
    const identity = extractOfficialProfileIdentity(profileHtml, profileUrl, {
      name: 'Joseph Kim Research Area',
      slug: 'faculty-research-area-joseph-kim',
    });

    const obs = identityToUserObservations(identity!, { netid: 'jwk42', email: 'joseph.kim@yale.edu' });

    expect(obs.every((o) => o.entityType === 'user')).toBe(true);
    expect(obs.every((o) => o.entityKey === 'netid:jwk42')).toBe(true);
    expect(obs.map((o) => o.field)).toEqual(
      expect.arrayContaining(['netid', 'fname', 'lname', 'email', 'profileUrls', 'imageUrl']),
    );
    expect(obs.find((o) => o.field === 'profileUrls')?.value).toEqual({
      medicine: profileUrl,
      official: profileUrl,
    });
    expect(obs.find((o) => o.field === 'imageUrl')?.value).toBe(
      'https://ysm-res.cloudinary.com/image/upload/example/joseph-kim',
    );
  });

  it('emits research-entity description observations from official profile identity', () => {
    const identity = extractOfficialProfileIdentity(profileHtml, profileUrl, {
      _id: 'entity-1',
      name: 'Joseph Kim Research Area',
      slug: 'faculty-research-area-joseph-kim',
    });

    const obs = identityToResearchEntityDescriptionObservations(identity!, {
      _id: 'entity-1',
      name: 'Joseph Kim Research Area',
      slug: 'faculty-research-area-joseph-kim',
    });

    expect(obs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: 'researchEntity',
          entityId: 'entity-1',
          entityKey: 'faculty-research-area-joseph-kim',
          field: 'fullDescription',
          value: expect.stringContaining('translational cancer biology'),
          sourceUrl: profileUrl,
        }),
        expect.objectContaining({
          field: 'sourceUrls',
          value: [profileUrl],
          sourceUrl: profileUrl,
        }),
        expect.objectContaining({
          field: 'shortDescription',
          value: expect.stringContaining('translational cancer biology'),
          sourceUrl: profileUrl,
        }),
      ]),
    );
  });

  it('prefers official profile body prose over Yale Law news teaser paragraphs', () => {
    const lawProfileUrl = 'https://law.yale.edu/owen-m-fiss/';
    const identity = extractOfficialProfileIdentity(
      `
        <html>
          <head><link rel="canonical" href="${lawProfileUrl}" /></head>
          <body>
            <main>
              <h1>Owen M. Fiss</h1>
              <div class="title">Sterling Professor Emeritus of Law</div>
              <a href="mailto:owen.fiss@yale.edu">owen.fiss@yale.edu</a>
              <div class="field--name-body">
                <p>
                  Professor Fiss is the author of many articles and books on procedure, free speech,
                  civil rights, and comparative constitutional law.
                </p>
              </div>
              <div class="field--name-field-teaser-formatted">
                <p>
                  The Yale Law School faculty member declared the Supreme Court a deviant institution
                  in a news item about a past lecture.
                </p>
              </div>
            </main>
          </body>
        </html>
      `,
      lawProfileUrl,
      {
        _id: 'entity-law',
        name: 'Owen Fiss Research',
        slug: 'fiss-omf2',
      },
    );

    expect(identity?.bio).toContain('author of many articles and books');
    expect(identity?.bio).not.toContain('deviant institution');

    const obs = identityToResearchEntityDescriptionObservations(identity!, {
      _id: 'entity-law',
      name: 'Owen Fiss Research',
      slug: 'fiss-omf2',
    });

    expect(obs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'shortDescription',
          value:
            'Publishes on procedure, free speech, civil rights, and comparative constitutional law.',
        }),
      ]),
    );
  });

  it('derives card-safe short descriptions from author-of-topic profile prose', () => {
    const obs = identityToResearchEntityDescriptionObservations(
      {
        canonicalUrl: 'https://politicalscience.yale.edu/people/peter-swenson/',
        fetchedUrl: 'https://politicalscience.yale.edu/people/peter-swenson/',
        displayName: 'Peter Swenson',
        email: 'peter.swenson@yale.edu',
        title: 'Professor of Political Science',
        departments: [],
        bio: 'Swenson is an acclaimed author of articles and books on comparative political economy and the history of medical and health care politics.',
        researchInterests: [],
      },
      {
        _id: 'entity-swenson',
        name: 'Peter Swenson Research',
        slug: 'swenson-pas57',
      },
    );

    expect(obs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'shortDescription',
          value:
            'Publishes on comparative political economy and the history of medical and health care politics.',
        }),
      ]),
    );
  });

  it('emits inferred PI observations when official profile identity resolves to an existing user', () => {
    const identity = extractOfficialProfileIdentity(profileHtml, profileUrl, {
      _id: '64f000000000000000000010',
      name: 'Joseph Kim Research Area',
      slug: 'faculty-research-area-joseph-kim',
    });

    const obs = identityToResearchEntityPiObservations(
      identity!,
      { _id: '64f000000000000000000020', netid: 'jwk42', email: 'joseph.kim@yale.edu' },
      {
        _id: '64f000000000000000000010',
        name: 'Joseph Kim Research Area',
        slug: 'faculty-research-area-joseph-kim',
      },
    );

    expect(obs).toEqual([
      expect.objectContaining({
        entityType: 'researchEntity',
        entityId: '64f000000000000000000010',
        entityKey: 'faculty-research-area-joseph-kim',
        field: 'inferredPiUserId',
        value: '64f000000000000000000020',
        sourceUrl: profileUrl,
        confidenceOverride: 0.88,
      }),
    ]);
  });

  it('emits inferred PI key observations when an official Yale profile supplies a netid key', () => {
    const identity = extractOfficialProfileIdentity(profileHtml, profileUrl, {
      _id: '64f000000000000000000010',
      name: 'Joseph Kim Research Area',
      slug: 'faculty-research-area-joseph-kim',
    });

    const obs = identityToResearchEntityPiKeyObservations(identity!, 'joseph.kim', {
      _id: '64f000000000000000000010',
      name: 'Joseph Kim Research Area',
      slug: 'faculty-research-area-joseph-kim',
    });

    expect(obs).toEqual([
      expect.objectContaining({
        entityType: 'researchEntity',
        entityId: '64f000000000000000000010',
        entityKey: 'faculty-research-area-joseph-kim',
        field: 'inferredPiUserKey',
        value: 'joseph.kim',
        sourceUrl: profileUrl,
        confidenceOverride: 0.88,
      }),
    ]);
  });

  it('does not treat Yale Medicine organization headings as profile departments', () => {
    const identity = extractOfficialProfileIdentity(
      profileHtml.replace(
        '<div class="department">Surgery</div>',
        `
          <div class="profile-organization">Other Departments &amp; Organizations</div>
          <div class="profile-organization">Cancer Prevention and Control</div>
          <div class="profile-affiliation">COPPER Center</div>
        `,
      ),
      profileUrl,
      {
        name: 'Joseph Kim Research Area',
        slug: 'faculty-research-area-joseph-kim',
      },
    );

    const obs = identityToUserObservations(identity!, { netid: 'jwk42', email: 'joseph.kim@yale.edu' });

    expect(obs.some((o) => o.field === 'primaryDepartment')).toBe(false);
    expect(obs.some((o) => o.field === 'departments')).toBe(false);
  });

  it('runs only the targeted queued Medicine profile backfill', async () => {
    const emitted: ObservationInput[] = [];
    const scraper = new OfficialProfilePiBackfillScraper(
      vi.fn(async () => profileHtml),
      vi.fn(async () => [
        {
          _id: 'entity-1',
          name: 'Joseph Kim Research Area',
          slug: 'faculty-research-area-joseph-kim',
          websiteUrl: 'https://medicine.yale.edu/cancer/profile/joseph-w-kim',
        },
      ]),
      vi.fn(async () => ({
        _id: '64f000000000000000000020',
        netid: 'jwk42',
        email: 'joseph.kim@yale.edu',
      })),
      vi.fn(async () => [
        {
          _id: 'entity-1',
          name: 'Joseph Kim Research Area',
          slug: 'faculty-research-area-joseph-kim',
          websiteUrl: 'https://medicine.yale.edu/cancer/profile/joseph-w-kim',
        },
      ]),
    );

    const result = await scraper.run(contextFor(emitted));

    expect(result).toMatchObject({ observationCount: emitted.length, entitiesObserved: 1 });
    expect(emitted.find((o) => o.field === 'email')?.value).toBe('joseph.kim@yale.edu');
    expect(emitted.find((o) => o.field === 'inferredPiUserId')?.value).toBe(
      '64f000000000000000000020',
    );
    expect(emitted.some((o) => o.entityType === 'researchGroupMember')).toBe(false);
    expect(emitted.map((o) => o.field)).not.toEqual(
      expect.arrayContaining(['title', 'profileUrls', 'bio', 'researchInterests', 'topics']),
    );
  });

  it('rejects unsafe runtime limits before selecting profile targets', async () => {
    const emitted: ObservationInput[] = [];
    const fetcher = vi.fn(async () => profileHtml);
    const entitySelector = vi.fn(async () => [
      {
        _id: 'entity-1',
        name: 'Joseph Kim Research Area',
        slug: 'faculty-research-area-joseph-kim',
        websiteUrl: 'https://medicine.yale.edu/cancer/profile/joseph-w-kim',
      },
    ]);
    const scraper = new OfficialProfilePiBackfillScraper(
      fetcher,
      entitySelector,
      vi.fn(async () => ({
        _id: '64f000000000000000000020',
        netid: 'jwk42',
        email: 'joseph.kim@yale.edu',
      })),
    );
    const ctx = contextFor(emitted);
    ctx.options.limit = 9007199254740992;

    await expect(scraper.run(ctx)).rejects.toThrow(/--limit must be a safe positive integer/);

    expect(entitySelector).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('emits user creation and PI key observations when queued profile identity has no existing user', async () => {
    const emitted: ObservationInput[] = [];
    const scraper = new OfficialProfilePiBackfillScraper(
      vi.fn(async () => profileHtml),
      vi.fn(async () => [
        {
          _id: 'entity-1',
          name: 'Joseph Kim Research Area',
          slug: 'faculty-research-area-joseph-kim',
          websiteUrl: 'https://medicine.yale.edu/cancer/profile/joseph-w-kim',
        },
      ]),
      vi.fn(async () => null),
      vi.fn(async () => [
        {
          _id: 'entity-1',
          name: 'Joseph Kim Research Area',
          slug: 'faculty-research-area-joseph-kim',
          websiteUrl: 'https://medicine.yale.edu/cancer/profile/joseph-w-kim',
        },
      ]),
    );

    const result = await scraper.run(contextFor(emitted));

    expect(result).toMatchObject({ observationCount: emitted.length, entitiesObserved: 1 });
    expect(emitted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: 'user',
          entityKey: 'netid:joseph.kim',
          field: 'email',
          value: 'joseph.kim@yale.edu',
        }),
        expect.objectContaining({
          entityType: 'user',
          entityKey: 'netid:joseph.kim',
          field: 'profileUrls',
          value: {
            medicine: profileUrl,
            official: profileUrl,
          },
        }),
        expect.objectContaining({
          entityType: 'researchEntity',
          field: 'inferredPiUserKey',
          value: 'joseph.kim',
        }),
      ]),
    );
    expect(emitted.find((o) => o.field === 'inferredPiUserId')).toBeUndefined();
  });

  it('emits PI observations for queued email-less profiles that resolve to one existing user by URL', async () => {
    const emitted: ObservationInput[] = [];
    const scraper = new OfficialProfilePiBackfillScraper(
      vi.fn(async () => emailLessProfileHtml),
      vi.fn(async () => [
        {
          _id: 'entity-1',
          name: 'Joseph Kim Research Area',
          slug: 'faculty-research-area-joseph-kim',
          websiteUrl: 'https://medicine.yale.edu/cancer/profile/joseph-w-kim',
        },
      ]),
      vi.fn(async () => ({
        _id: '64f000000000000000000020',
        netid: 'jwk42',
        email: '',
      })),
      vi.fn(async () => []),
    );

    const result = await scraper.run(contextFor(emitted));

    expect(result).toMatchObject({ observationCount: emitted.length, entitiesObserved: 1 });
    expect(emitted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: 'researchEntity',
          field: 'inferredPiUserId',
          value: '64f000000000000000000020',
        }),
      ]),
    );
    expect(emitted.find((o) => o.field === 'email')).toBeUndefined();
  });

  it('resolves duplicate profile URL candidates when exactly one user matches the profile slug', async () => {
    vi.spyOn(User, 'find').mockReturnValue({
      select: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue([
        {
          _id: 'user-harold',
          netid: 'hs7',
          email: 'harold.sanchez@yale.edu',
          fname: 'Harold',
          lname: 'Sanchez',
          profileUrls: {
            medicine: 'https://medicine.yale.edu/profile/harold-sanchez/',
          },
        },
        {
          _id: 'user-hayde',
          netid: 'hs272',
          email: 'hayde.sanchez@yale.edu',
          fname: 'Hayde',
          lname: 'Sanchez',
          profileUrls: {
            medicine: 'https://medicine.yale.edu/profile/harold-sanchez/',
          },
        },
      ]),
    } as any);

    const match = await resolveExistingUserForIdentity({
      canonicalUrl: 'https://medicine.yale.edu/profile/harold-sanchez/',
      fetchedUrl: 'https://medicine.yale.edu/profile/harold-sanchez/',
      displayName: 'Harry Sanchez',
      email: '',
      title: 'Assistant Professor',
      departments: [],
      researchInterests: [],
    });

    expect(match).toEqual({
      _id: 'user-harold',
      netid: 'hs7',
      email: 'harold.sanchez@yale.edu',
    });
  });

  it('runs targeted bio backfill for already linked visible professor profiles', async () => {
    const emitted: ObservationInput[] = [];
    const scraper = new OfficialProfilePiBackfillScraper(
      vi.fn(async () => profileHtml),
      vi.fn(async () => [
        {
          _id: 'entity-1',
          name: 'Joseph Kim Research Area',
          slug: 'faculty-research-area-joseph-kim',
          websiteUrl: 'https://medicine.yale.edu/cancer/profile/joseph-w-kim',
        },
      ]),
      vi.fn(async () => ({ netid: 'jwk42', email: 'joseph.kim@yale.edu' })),
      vi.fn(async () => [
        {
          _id: 'entity-1',
          name: 'Joseph Kim Research Area',
          slug: 'faculty-research-area-joseph-kim',
          websiteUrl: 'https://medicine.yale.edu/cancer/profile/joseph-w-kim',
        },
      ]),
    );

    const result = await scraper.run(visibleBioContextFor(emitted));

    expect(result).toMatchObject({ observationCount: emitted.length, entitiesObserved: 1 });
    expect(emitted.find((o) => o.field === 'bio')?.value).toContain(
      'studies translational cancer biology',
    );
    expect(emitted.every((o) => o.entityKey === 'netid:jwk42')).toBe(true);
  });

  it('runs queued official profile description backfill for source-description entities', async () => {
    const emitted: ObservationInput[] = [];
    const scraper = new OfficialProfilePiBackfillScraper(
      vi.fn(async () => profileHtml),
      vi.fn(async () => []),
      vi.fn(async () => ({
        _id: '64f000000000000000000020',
        netid: 'jwk42',
        email: 'joseph.kim@yale.edu',
      })),
      vi.fn(async () => []),
      vi.fn(async () => []),
      vi.fn(async () => [
        {
          _id: 'entity-1',
          name: 'Joseph Kim Research Area',
          slug: 'faculty-research-area-joseph-kim',
          sourceUrls: ['https://medicine.yale.edu/cancer/profile/joseph-w-kim'],
        },
      ]),
    );

    const result = await scraper.run(profileDescriptionContextFor(emitted));

    expect(result).toMatchObject({ observationCount: emitted.length, entitiesObserved: 1 });
    expect(emitted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: 'researchEntity',
          field: 'sourceUrls',
          value: [
            'https://medicine.yale.edu/cancer/profile/joseph-w-kim',
            profileUrl,
          ],
        }),
        expect.objectContaining({
          entityType: 'researchEntity',
          field: 'fullDescription',
          value: expect.stringContaining('translational cancer biology'),
        }),
        expect.objectContaining({
          entityType: 'researchEntity',
          field: 'shortDescription',
          value: expect.stringContaining('translational cancer biology'),
        }),
        expect.objectContaining({
          entityType: 'researchEntity',
          field: 'inferredPiUserId',
          value: '64f000000000000000000020',
        }),
      ]),
    );
  });

  it('skips profile description backfill when preferred lab description evidence exists', async () => {
    const emitted: ObservationInput[] = [];
    const scraper = new OfficialProfilePiBackfillScraper(
      vi.fn(async () => profileHtml),
      vi.fn(async () => []),
      vi.fn(async () => ({
        _id: '64f000000000000000000020',
        netid: 'jwk42',
        email: 'joseph.kim@yale.edu',
      })),
      vi.fn(async () => []),
      vi.fn(async () => []),
      vi.fn(async () => [
        {
          _id: 'entity-1',
          name: 'Joseph Kim Research Area',
          slug: 'faculty-research-area-joseph-kim',
          sourceUrls: ['https://medicine.yale.edu/cancer/profile/joseph-w-kim'],
          [PROFILE_DESCRIPTION_SUPPRESSED_BY_PREFERRED_SOURCE_NAMES_FIELD]: [
            'lab-microsite-description-llm',
          ],
        },
      ]),
    );

    const result = await scraper.run(profileDescriptionContextFor(emitted));

    expect(result).toMatchObject({ observationCount: 1, entitiesObserved: 1 });
    expect(emitted.map((o) => o.field)).toEqual(['inferredPiUserId']);
    expect(emitted.find((o) => o.field === 'fullDescription')).toBeUndefined();
    expect(emitted.find((o) => o.field === 'shortDescription')).toBeUndefined();
  });

  it('runs targeted official profile description backfill when entity keys are supplied', async () => {
    const emitted: ObservationInput[] = [];
    const researchHomeSelector = vi.fn(async () => []);
    const profileDescriptionSelector = vi.fn(async () => [
      {
        _id: 'entity-1',
        name: 'Joseph Kim Research Area',
        slug: 'faculty-research-area-joseph-kim',
        sourceUrls: ['https://medicine.yale.edu/cancer/profile/joseph-w-kim'],
      },
    ]);
    const scraper = new OfficialProfilePiBackfillScraper(
      vi.fn(async () => profileHtml),
      vi.fn(async () => []),
      vi.fn(async () => ({
        _id: '64f000000000000000000020',
        netid: 'jwk42',
        email: 'joseph.kim@yale.edu',
      })),
      vi.fn(async () => []),
      researchHomeSelector,
      profileDescriptionSelector,
    );

    const result = await scraper.run({
      ...profileDescriptionContextFor(emitted),
      options: {
        dryRun: true,
        useCache: false,
        release: false,
        only: ['profile-description-backfill', 'faculty-research-area-joseph-kim'],
      },
    });

    expect(result).toMatchObject({ observationCount: emitted.length, entitiesObserved: 1 });
    expect(profileDescriptionSelector).toHaveBeenCalledWith(25, [
      'faculty-research-area-joseph-kim',
    ]);
    expect(researchHomeSelector).not.toHaveBeenCalled();
    expect(emitted.find((o) => o.field === 'fullDescription')?.value).toContain(
      'translational cancer biology',
    );
    expect(emitted.find((o) => o.field === 'inferredPiUserId')?.value).toBe(
      '64f000000000000000000020',
    );
  });

  it('generates bounded official profile candidates from Yale lead identity', () => {
    expect(
      generatedOfficialProfileUrlCandidatesForPerson({
        fname: 'Laura',
        lname: 'Forastiere',
        email: 'laura.forastiere@yale.edu',
      }),
    ).toEqual([
      'https://medicine.yale.edu/profile/laura-forastiere/',
      'https://ysph.yale.edu/profile/laura-forastiere/',
    ]);
    expect(
      generatedOfficialProfileUrlCandidatesForPerson({
        fname: 'External',
        lname: 'Person',
        email: 'external@example.edu',
      }),
    ).toEqual([]);
  });

  it('runs profile description backfill from a matching profile even when public email is absent', async () => {
    const emitted: ObservationInput[] = [];
    const noEmailProfileHtml = profileHtml.replace(
      '<a href="mailto:joseph.kim@yale.edu">joseph.kim@yale.edu</a>',
      '<span>contact unavailable</span>',
    );
    const scraper = new OfficialProfilePiBackfillScraper(
      vi.fn(async () => noEmailProfileHtml),
      vi.fn(async () => []),
      vi.fn(async () => null),
      vi.fn(async () => []),
      vi.fn(async () => []),
      vi.fn(async () => [
        {
          _id: 'entity-1',
          name: 'Joseph Kim Research Area',
          slug: 'faculty-research-area-joseph-kim',
          sourceUrls: ['https://medicine.yale.edu/cancer/profile/joseph-w-kim'],
        },
      ]),
    );

    const result = await scraper.run(profileDescriptionContextFor(emitted));

    expect(result).toMatchObject({ observationCount: 3, entitiesObserved: 1 });
    expect(emitted.map((o) => o.field).sort()).toEqual([
      'fullDescription',
      'shortDescription',
      'sourceUrls',
    ]);
  });

  it('uses the known linked netid for visible bio repair when the profile omits email', async () => {
    const emitted: ObservationInput[] = [];
    const noEmailProfileHtml = profileHtml.replace(
      '<a href="mailto:joseph.kim@yale.edu">joseph.kim@yale.edu</a>',
      '<span>contact unavailable</span>',
    );
    const scraper = new OfficialProfilePiBackfillScraper(
      vi.fn(async () => noEmailProfileHtml),
      vi.fn(async () => []),
      vi.fn(async () => null),
      vi.fn(async () => [
        {
          _id: 'user-1',
          netid: 'jwk42',
          email: 'joseph.kim@yale.edu',
          name: 'Joseph Kim',
          slug: 'joseph-kim',
          websiteUrl: 'https://medicine.yale.edu/cancer/profile/joseph-w-kim',
        },
      ]),
    );

    const result = await scraper.run(visibleBioContextFor(emitted));

    expect(result).toMatchObject({ observationCount: emitted.length, entitiesObserved: 1 });
    expect(emitted.find((o) => o.field === 'bio')?.value).toContain(
      'studies translational cancer biology',
    );
    expect(emitted.every((o) => o.entityKey === 'netid:jwk42')).toBe(true);
    expect(emitted.some((o) => o.field === 'email')).toBe(false);
  });

  it('uses official department person pages for already linked visible bio backfill', async () => {
    const emitted: ObservationInput[] = [];
    const scraper = new OfficialProfilePiBackfillScraper(
      vi.fn(async () => departmentPersonPageHtml),
      vi.fn(async () => []),
      vi.fn(async () => null),
      vi.fn(async () => [
        {
          _id: 'user-3',
          netid: 'da3',
          email: 'dana.angluin@yale.edu',
          fname: 'Dana',
          lname: 'Angluin',
          name: 'Dana Angluin',
          slug: 'dana-angluin',
          websiteUrl: departmentPersonPageUrl,
        },
      ]),
      vi.fn(async () => []),
      vi.fn(async () => []),
      0,
    );

    const result = await scraper.run(visibleBioContextFor(emitted));

    expect(result).toMatchObject({ observationCount: emitted.length, entitiesObserved: 1 });
    expect(emitted.find((o) => o.field === 'bio')?.value).toContain(
      'algorithmic approaches to learning',
    );
    expect(emitted.find((o) => o.field === 'profileUrls')).toBeUndefined();
    expect(emitted.find((o) => o.field === 'userType')).toBeUndefined();
    expect(emitted.find((o) => o.field === 'title')).toBeUndefined();
  });

  it('uses Yale /faculty/ person pages for already linked visible bio backfill', async () => {
    const emitted: ObservationInput[] = [];
    const facultyPageUrl = 'https://economics.yale.edu/faculty/dana-angluin/';
    const facultyPageHtml = departmentPersonPageHtml.replace(
      departmentPersonPageUrl,
      facultyPageUrl,
    );
    const htmlFetcher = vi.fn(async () => facultyPageHtml);
    const scraper = new OfficialProfilePiBackfillScraper(
      htmlFetcher,
      vi.fn(async () => []),
      vi.fn(async () => null),
      vi.fn(async () => [
        {
          _id: 'user-faculty-page',
          netid: 'da3',
          email: 'dana.angluin@yale.edu',
          fname: 'Dana',
          lname: 'Angluin',
          name: 'Dana Angluin',
          slug: 'dana-angluin',
          websiteUrl: facultyPageUrl,
        },
      ]),
      vi.fn(async () => []),
      vi.fn(async () => []),
      0,
    );

    const result = await scraper.run(visibleBioContextFor(emitted));

    expect(result).toMatchObject({ observationCount: emitted.length, entitiesObserved: 1 });
    expect(htmlFetcher).toHaveBeenCalledWith(
      facultyPageUrl,
      false,
      'official-profile-pi-backfill',
    );
    expect(emitted.find((o) => o.field === 'bio')?.sourceUrl).toBe(facultyPageUrl);
  });

  it('canonicalizes migrated Sociology people pages to profile pages for visible bio backfill', async () => {
    const emitted: ObservationInput[] = [];
    const oldSociologyUrl = 'https://sociology.yale.edu/people/dana-angluin';
    const currentSociologyUrl = 'https://sociology.yale.edu/profile/dana-angluin/';
    const sociologyProfileHtml = departmentPersonPageHtml.replace(
      new RegExp(departmentPersonPageUrl, 'g'),
      currentSociologyUrl,
    );
    const htmlFetcher = vi.fn(async () => sociologyProfileHtml);
    const scraper = new OfficialProfilePiBackfillScraper(
      htmlFetcher,
      vi.fn(async () => []),
      vi.fn(async () => null),
      vi.fn(async () => [
        {
          _id: 'user-sociology-page',
          netid: 'da3',
          email: 'dana.angluin@yale.edu',
          fname: 'Dana',
          lname: 'Angluin',
          name: 'Dana Angluin',
          slug: 'dana-angluin',
          profileUrls: {
            sociology: oldSociologyUrl,
          },
        },
      ]),
      vi.fn(async () => []),
      vi.fn(async () => []),
      0,
    );

    const result = await scraper.run(visibleBioContextFor(emitted));

    expect(result).toMatchObject({ observationCount: emitted.length, entitiesObserved: 1 });
    expect(htmlFetcher).toHaveBeenCalledWith(
      currentSociologyUrl,
      false,
      'official-profile-pi-backfill',
    );
    expect(emitted.find((o) => o.field === 'bio')?.sourceUrl).toBe(currentSociologyUrl);
  });

  it('uses attached research-home profile URLs for already linked visible bio backfill', async () => {
    const emitted: ObservationInput[] = [];
    const homeProfileUrl = 'https://medicine.yale.edu/cancer/profile/sarah-aitken/';
    const canonicalHomeProfileUrl = 'https://medicine.yale.edu/profile/sarah-aitken/';
    const homeProfileHtml = profileHtml
      .replace(new RegExp(profileUrl, 'g'), homeProfileUrl)
      .replace(/Joseph W\. Kim/g, 'Sarah Aitken')
      .replace(/Joseph Kim/g, 'Sarah Aitken')
      .replace(/joseph\.kim@yale\.edu/g, 'sarah.aitken@yale.edu')
      .replace(/Professor of Surgery \(Oncology\)/g, 'Assistant Professor of Medicine')
      .replace(
        /Sarah Aitken studies translational cancer biology and develops clinical research\s+programs for gastrointestinal oncology\./,
        'Sarah Aitken studies cancer outcomes, clinical epidemiology, and interventions that improve care delivery for patients with gastrointestinal malignancies.',
      );
    const htmlFetcher = vi.fn(async () => homeProfileHtml);
    const scraper = new OfficialProfilePiBackfillScraper(
      htmlFetcher,
      vi.fn(async () => []),
      vi.fn(async () => null),
      vi.fn(async () => [
        {
          _id: 'user-home-profile',
          netid: 'sja44',
          email: 'sarah.aitken@yale.edu',
          fname: 'Sarah',
          lname: 'Aitken',
          name: 'Sarah Aitken',
          slug: 'sarah-aitken',
          profileUrls: {
            orcid: 'https://orcid.org/0000-0002-1897-4140',
          },
          leadProfileUrls: [homeProfileUrl],
        },
      ]),
      vi.fn(async () => []),
      vi.fn(async () => []),
      0,
    );

    const result = await scraper.run(visibleBioContextFor(emitted));

    expect(result).toMatchObject({ observationCount: emitted.length, entitiesObserved: 1 });
    expect(htmlFetcher).toHaveBeenCalledWith(
      canonicalHomeProfileUrl,
      false,
      'official-profile-pi-backfill',
    );
    expect(emitted.find((o) => o.field === 'bio')?.value).toContain(
      'Sarah Aitken studies cancer outcomes',
    );
    expect(emitted.find((o) => o.field === 'profileUrls')).toBeUndefined();
    expect(emitted.find((o) => o.field === 'userType')).toBeUndefined();
    expect(emitted.find((o) => o.field === 'title')).toBeUndefined();
  });

  it('uses official profile slugs with multi-token given-name variants for visible bio backfill', async () => {
    const emitted: ObservationInput[] = [];
    const variantProfileUrl = 'https://medicine.yale.edu/profile/zeynep-erson/';
    const variantProfileHtml = `
      <html>
        <head>
          <link rel="canonical" href="${variantProfileUrl}" />
          <meta property="og:title" content="Zeynep Erson Omay | Yale" />
        </head>
        <body>
          <main>
            <h1>Zeynep Erson Omay</h1>
            <div class="title">Assistant Professor of Economics</div>
            <section class="biography">
              Dr. Erson Omay studies econometric theory, industrial organization, and market
              design, with work on matching mechanisms, strategic behavior, and policy-relevant
              empirical methods.
            </section>
          </main>
        </body>
      </html>
    `;
    const htmlFetcher = vi.fn(async () => variantProfileHtml);
    const scraper = new OfficialProfilePiBackfillScraper(
      htmlFetcher,
      vi.fn(async () => []),
      vi.fn(async () => null),
      vi.fn(async () => [
        {
          _id: 'user-variant',
          netid: 'zeo1',
          email: 'zeynep.omay@yale.edu',
          fname: 'Zeynep Erson',
          lname: 'Omay',
          name: 'Zeynep Erson Omay',
          slug: 'zeynep-erson-omay',
          websiteUrl: variantProfileUrl,
        },
      ]),
      vi.fn(async () => []),
      vi.fn(async () => []),
      0,
    );

    const result = await scraper.run(visibleBioContextFor(emitted));

    expect(result).toMatchObject({ observationCount: emitted.length, entitiesObserved: 1 });
    expect(htmlFetcher).toHaveBeenCalledWith(
      variantProfileUrl,
      false,
      'official-profile-pi-backfill',
    );
    expect(emitted.find((o) => o.field === 'bio')?.value).toContain(
      'Dr. Erson Omay studies econometric theory',
    );
  });

  it('selects weak faculty profile targets directly when no public research home is attached', async () => {
    vi.spyOn(ResearchEntity, 'find').mockReturnValue({
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue([]),
    } as any);
    vi.spyOn(User, 'find').mockReturnValue({
      select: vi.fn().mockReturnThis(),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue([
        {
          _id: 'user-soyoung-lee',
          netid: 'sl3248',
          email: 'soyoung.lee@yale.edu',
          fname: 'Soyoung',
          lname: 'Lee',
          userType: 'faculty',
          bio: '',
          profileUrls: {
            departmental: 'https://politicalscience.yale.edu/people/soyoung-lee/',
          },
        },
      ]),
    } as any);

    const targets = await selectVisibleProfileBioTargets(10);

    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({
      netid: 'sl3248',
      leadProfileUrls: ['https://politicalscience.yale.edu/people/soyoung-lee/'],
    });
  });

  it('rejects fetched given-name variant profile pages when the identity is another person', async () => {
    const emitted: ObservationInput[] = [];
    const variantProfileUrl = 'https://medicine.yale.edu/profile/mary-jane/';
    const wrongProfileHtml = `
      <html>
        <head>
          <link rel="canonical" href="${variantProfileUrl}" />
          <meta property="og:title" content="Sarah Taylor | Yale" />
        </head>
        <body>
          <main>
            <h1>Sarah Taylor</h1>
            <div class="title">Professor of History</div>
            <section class="biography">
              Sarah Taylor studies twentieth-century political history, public institutions,
              and archival methods in modern historical research.
            </section>
          </main>
        </body>
      </html>
    `;
    const scraper = new OfficialProfilePiBackfillScraper(
      vi.fn(async () => wrongProfileHtml),
      vi.fn(async () => []),
      vi.fn(async () => null),
      vi.fn(async () => [
        {
          _id: 'user-wrong-variant',
          netid: 'mjt1',
          email: 'mary.taylor@yale.edu',
          fname: 'Mary Jane',
          lname: 'Taylor',
          name: 'Mary Jane Taylor',
          slug: 'mary-jane-taylor',
          websiteUrl: variantProfileUrl,
        },
      ]),
      vi.fn(async () => []),
      vi.fn(async () => []),
      0,
    );

    const result = await scraper.run(visibleBioContextFor(emitted));

    expect(result).toMatchObject({ observationCount: 0, entitiesObserved: 0 });
    expect(emitted).toHaveLength(0);
  });

  it('rejects mismatched department person pages before visible bio fetch', async () => {
    const emitted: ObservationInput[] = [];
    const htmlFetcher = vi.fn(async () => departmentPersonPageHtml);
    const scraper = new OfficialProfilePiBackfillScraper(
      htmlFetcher,
      vi.fn(async () => []),
      vi.fn(async () => null),
      vi.fn(async () => [
        {
          _id: 'user-4',
          netid: 'nb653',
          email: 'nancy.brown@yale.edu',
          fname: 'Nancy',
          lname: 'Brown',
          name: 'Nancy Brown',
          slug: 'nancy-brown',
          websiteUrl: 'https://nelc.yale.edu/people/nicholas-brown/',
        },
        {
          _id: 'user-5',
          netid: 'ab123',
          email: 'ann.brown@yale.edu',
          fname: 'Ann',
          lname: 'Brown',
          name: 'Ann Brown',
          slug: 'ann-brown',
          websiteUrl: 'https://history.yale.edu/people/joanne-brown/',
        },
      ]),
      vi.fn(async () => []),
      vi.fn(async () => []),
      0,
    );

    const result = await scraper.run(visibleBioContextFor(emitted));

    expect(result).toMatchObject({ observationCount: 0, entitiesObserved: 0 });
    expect(htmlFetcher).not.toHaveBeenCalled();
  });

  it('uses a valid department page instead of a stale same-name Medicine profile URL', async () => {
    const emitted: ObservationInput[] = [];
    const staleMedicineUrl = 'https://medicine.yale.edu/profile/different-angluin/';
    const htmlFetcher = vi.fn(async (url: string) => {
      if (url === staleMedicineUrl) {
        return departmentPersonPageHtml
          .replace(/Dana Angluin/g, 'Different Angluin')
          .replace(/dana\.angluin@yale\.edu/g, 'different.angluin@yale.edu');
      }
      return departmentPersonPageHtml;
    });
    const scraper = new OfficialProfilePiBackfillScraper(
      htmlFetcher,
      vi.fn(async () => []),
      vi.fn(async () => null),
      vi.fn(async () => [
        {
          _id: 'user-6',
          netid: 'da3',
          email: 'dana.angluin@yale.edu',
          fname: 'Dana',
          lname: 'Angluin',
          name: 'Dana Angluin',
          slug: 'dana-angluin',
          profileUrls: {
            medicine: staleMedicineUrl,
            departmental: departmentPersonPageUrl,
          },
        },
      ]),
      vi.fn(async () => []),
      vi.fn(async () => []),
      0,
    );

    const result = await scraper.run(visibleBioContextFor(emitted));

    expect(result).toMatchObject({ observationCount: emitted.length, entitiesObserved: 1 });
    expect(htmlFetcher).toHaveBeenCalledWith(
      departmentPersonPageUrl,
      false,
      'official-profile-pi-backfill',
    );
    expect(emitted.find((o) => o.field === 'bio')?.sourceUrl).toBe(departmentPersonPageUrl);
  });

  it('tries the next visible profile URL when the preferred profile fetch fails', async () => {
    const emitted: ObservationInput[] = [];
    const staleMedicineUrl = 'https://medicine.yale.edu/profile/dana-angluin/';
    const htmlFetcher = vi.fn(async (url: string) => {
      if (url === staleMedicineUrl) {
        throw new Error('Request failed with status code 404');
      }
      return departmentPersonPageHtml;
    });
    const scraper = new OfficialProfilePiBackfillScraper(
      htmlFetcher,
      vi.fn(async () => []),
      vi.fn(async () => null),
      vi.fn(async () => [
        {
          _id: 'user-fetch-fallback',
          netid: 'da3',
          email: 'dana.angluin@yale.edu',
          fname: 'Dana',
          lname: 'Angluin',
          name: 'Dana Angluin',
          slug: 'dana-angluin',
          profileUrls: {
            medicine: staleMedicineUrl,
            departmental: departmentPersonPageUrl,
          },
        },
      ]),
      vi.fn(async () => []),
      vi.fn(async () => []),
      0,
    );

    const result = await scraper.run(visibleBioContextFor(emitted));

    expect(result).toMatchObject({ observationCount: emitted.length, entitiesObserved: 1 });
    expect(htmlFetcher).toHaveBeenNthCalledWith(
      1,
      staleMedicineUrl,
      false,
      'official-profile-pi-backfill',
    );
    expect(htmlFetcher).toHaveBeenNthCalledWith(
      2,
      departmentPersonPageUrl,
      false,
      'official-profile-pi-backfill',
    );
    expect(emitted.find((o) => o.field === 'bio')?.sourceUrl).toBe(departmentPersonPageUrl);
  });

  it('throttles repeated profile fetches in large visible bio batches', async () => {
    const emitted: ObservationInput[] = [];
    const htmlFetcher = vi.fn(async (url: string) =>
      url.includes('second-person')
        ? profileHtml
            .replace(/Joseph W\. Kim/g, 'Second Person')
            .replace(/joseph\.kim@yale\.edu/g, 'second.person@yale.edu')
            .replace(/joseph-w-kim/g, 'second-person')
        : profileHtml,
    );
    const delay = vi.fn(async () => undefined);
    const scraper = new OfficialProfilePiBackfillScraper(
      htmlFetcher,
      vi.fn(async () => []),
      vi.fn(async () => null),
      vi.fn(async () => [
        {
          _id: 'user-1',
          netid: 'jwk42',
          email: 'joseph.kim@yale.edu',
          name: 'Joseph Kim',
          slug: 'joseph-kim',
          websiteUrl: 'https://medicine.yale.edu/profile/joseph-w-kim/',
        },
        {
          _id: 'user-2',
          netid: 'sp123',
          email: 'second.person@yale.edu',
          name: 'Second Person',
          slug: 'second-person',
          websiteUrl: 'https://medicine.yale.edu/profile/second-person/',
        },
      ]),
      vi.fn(async () => []),
      vi.fn(async () => []),
      25,
      delay,
    );

    const result = await scraper.run(visibleBioContextFor(emitted));

    expect(result.entitiesObserved).toBe(2);
    expect(htmlFetcher).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledTimes(1);
    expect(delay).toHaveBeenCalledWith(25);
  });

  it('bridges profile identity only through an existing user email and keeps the real netid', async () => {
    const emitted: ObservationInput[] = [];
    const scraper = new OfficialProfilePiBackfillScraper(
      vi.fn(async () => ysmJsonProfileHtml),
      vi.fn(async () => [
        {
          _id: 'entity-2',
          name: 'Caroline H. Johnson Research',
          slug: 'faculty-research-area-caroline-h-johnson',
          websiteUrl: 'https://medicine.yale.edu/profile/caroline-johnson/',
        },
      ]),
      vi.fn(async () => ({
        netid: 'chj9',
        email: 'caroline.johnson@yale.edu',
      })),
    );

    const result = await scraper.run(contextFor(emitted));

    expect(result).toMatchObject({ entitiesObserved: 1 });
    expect(emitted.every((o) => o.entityKey === 'netid:chj9')).toBe(true);
    expect(emitted.find((o) => o.field === 'netid')?.value).toBe('chj9');
    expect(emitted.some((o) => o.field === 'profileUrls')).toBe(false);
  });

  it('extracts a profile-linked research home from Yale profile affiliations and director text', () => {
    const homes = extractOfficialProfileResearchHomes(
      sinusasProfileHtml,
      'https://medicine.yale.edu/profile/albert-sinusas/',
    );

    expect(homes[0]).toMatchObject({
      name: 'Yale Translational Research Imaging Center',
      url: 'https://medicine.yale.edu/internal-medicine/cardio/research/translational-imaging/',
      kind: 'center',
      entityType: 'CENTER',
    });
    expect(homes.map((home) => home.name)).not.toContain('Internal Medicine');
  });

  it('extracts a leadership-backed research home from official profile body links', () => {
    const homes = extractOfficialProfileResearchHomes(
      linkedResearchHomeProfileHtml,
      'https://medicine.yale.edu/profile/albert-sinusas/',
    );

    expect(homes[0]).toMatchObject({
      name: 'Yale Translational Research Imaging Center',
      url: 'https://medicine.yale.edu/internal-medicine/cardio/research/translational-imaging/',
      kind: 'center',
      entityType: 'CENTER',
    });
  });

  it('does not emit profile research-home observations when the profile does not match the lead user', async () => {
    const emitted: ObservationInput[] = [];
    const scraper = new OfficialProfilePiBackfillScraper(
      vi.fn(async () =>
        linkedResearchHomeProfileHtml
          .replace(/Albert Sinusas/g, 'Albert Simon')
          .replace(/albert\.sinusas@yale\.edu/g, 'albert.simon@yale.edu')
          .replace(/\/profile\/albert-sinusas\//g, '/profile/albert-simon/'),
      ),
      vi.fn(async () => []),
      vi.fn(async () => null),
      vi.fn(async () => []),
      vi.fn(async () => [
        {
          _id: 'entity-1',
          name: 'Sinusas Lab',
          slug: 'sinusas-lab-as123',
          sourceUrls: ['https://medicine.yale.edu/profile/albert-simon/'],
          leadUserProfileUrls: ['https://medicine.yale.edu/profile/albert-simon/'],
          leadUsers: [{ fname: 'Albert', lname: 'Sinusas', email: 'albert.sinusas@yale.edu' }],
        },
      ]),
    );

    const result = await scraper.run(profileResearchHomeContextFor(emitted));

    expect(result).toMatchObject({ observationCount: 0, entitiesObserved: 0 });
    expect(emitted).toHaveLength(0);
  });

  it('does not promote navigation programs when the profile only names an unlinked lab', () => {
    const homes = extractOfficialProfileResearchHomes(
      navigationResearchProgramProfileHtml,
      'https://medicine.yale.edu/profile/joseph-santos-sacchi/',
    );

    expect(homes).toEqual([]);
  });

  it('does not promote research-center affiliations without leadership evidence', () => {
    const homes = extractOfficialProfileResearchHomes(
      researchCenterAffiliationWithoutLeadershipHtml,
      'https://medicine.yale.edu/profile/dana-small/',
    );

    expect(homes).toEqual([]);
  });

  it('does not treat a broad center as led when it is only the prefix of a program title', () => {
    const homes = extractOfficialProfileResearchHomes(
      centerPrefixProgramTitleHtml,
      'https://medicine.yale.edu/profile/wendy-silverman/',
    );

    expect(homes).toEqual([]);
  });

  it('does not promote broad institutional centers as individual lab replacements', () => {
    const homes = extractOfficialProfileResearchHomes(
      broadChildStudyCenterLeadershipHtml,
      'https://medicine.yale.edu/profile/linda-mayes/',
    );

    expect(homes).toEqual([]);
  });

  it('does not treat associate director of a subarea as director of the parent institute', () => {
    const homes = extractOfficialProfileResearchHomes(
      associateDirectorSubareaProfileHtml,
      'https://medicine.yale.edu/profile/xenophon-papademetris/',
    );

    expect(homes).toEqual([]);
  });

  it('accepts direct leadership when profile text prefixes a short affiliation with Yale', () => {
    const homes = extractOfficialProfileResearchHomes(
      yalePrefixedLeadershipProfileHtml,
      'https://medicine.yale.edu/profile/michael-nathanson/',
    );

    expect(homes[0]).toMatchObject({
      name: 'Liver Center',
      url: 'https://medicine.yale.edu/internal-medicine/livercenter/',
      kind: 'center',
      entityType: 'CENTER',
    });
  });

  it('does not promote contact-info organizations without direct leadership evidence', () => {
    const homes = extractOfficialProfileResearchHomes(
      contactInfoOnlyResearchHomeProfileHtml,
      'https://medicine.yale.edu/profile/dennis-moledina/',
    );

    expect(homes).toEqual([]);
  });

  it('uses the canonical center name for profile cards that include a PI lab prefix', () => {
    const homes = extractOfficialProfileResearchHomes(
      profileLinkedWaxmanCenterWebsiteHtml,
      'https://medicine.yale.edu/profile/stephen-waxman/',
    );

    expect(homes[0]).toMatchObject({
      name: 'Center for Neuroscience & Regeneration Research',
      url: 'https://medicine.yale.edu/cnrr/',
      kind: 'center',
      entityType: 'CENTER',
    });
  });

  it('does not promote daycare or kindergarten profile cards as research homes', () => {
    const homes = extractOfficialProfileResearchHomes(
      profileLinkedDaycareWebsiteHtml,
      'https://medicine.yale.edu/profile/carla-horwitz/',
    );

    expect(homes).toEqual([]);
  });

  it('does not promote student leadership programs as research-home replacements', () => {
    const homes = extractOfficialProfileResearchHomes(
      profileLinkedLeadershipProgramWebsiteHtml,
      'https://politicalscience.yale.edu/people/jacob-hacker/',
    );

    expect(homes).toEqual([]);
  });

  it('does not promote academic programs as lab website replacements', () => {
    const homes = extractOfficialProfileResearchHomes(
      profileLinkedAcademicProgramWebsiteHtml,
      'https://history.yale.edu/people/paul-freedman/',
    );

    expect(homes).toEqual([]);
  });

  it('does not promote diagnostic service pages as research homes', () => {
    const homes = extractOfficialProfileResearchHomes(
      profileLinkedDiagnosticServiceWebsiteHtml,
      'https://medicine.yale.edu/profile/allen-bale/',
    );

    expect(homes).toEqual([]);
  });

  it('does not promote broad department research directories as specific lab homes', () => {
    const homes = extractOfficialProfileResearchHomes(
      profileLinkedBroadChildStudyResearchWebsiteHtml,
      'https://medicine.yale.edu/profile/sara-sanchez-alonso/',
    );

    expect(homes).toEqual([]);
  });

  it('does not promote Google Sites profile-card links as official lab homes', () => {
    const homes = extractOfficialProfileResearchHomes(
      profileLinkedGoogleSiteLabWebsiteHtml,
      'https://medicine.yale.edu/profile/rajiv-radhakrishnan/',
    );

    expect(homes).toEqual([]);
  });

  it('does not promote medical education programs as lab website replacements', () => {
    const homes = extractOfficialProfileResearchHomes(
      profileLinkedEducationProgramWebsiteHtml,
      'https://medicine.yale.edu/profile/michael-cappello/',
    );

    expect(homes).toEqual([]);
  });

  it('does not promote broad departments as lab website replacements', () => {
    const homes = extractOfficialProfileResearchHomes(
      profileLinkedBroadDepartmentWebsiteHtml,
      'https://medicine.yale.edu/profile/kei-cheung/',
    );

    expect(homes).toEqual([]);
  });

  it('does not promote Yale Medicine clinical program pages as research homes', () => {
    const homes = extractOfficialProfileResearchHomes(
      profileLinkedClinicalProgramWebsiteHtml,
      'https://medicine.yale.edu/profile/daniel-wiznia/',
    );

    expect(homes).toEqual([]);
  });

  it('does not promote known stale Yale Medicine research pages as profile-linked homes', () => {
    const homes = extractOfficialProfileResearchHomes(
      profileLinkedStaleResearchWebsiteHtml,
      'https://medicine.yale.edu/profile/annie-harper/',
    );

    expect(homes).toEqual([]);
  });

  it('does not promote known stale or placeholder external lab shells', () => {
    const homes = extractOfficialProfileResearchHomes(
      profileLinkedStaleExternalWebsiteHtml,
      'https://medicine.yale.edu/profile/berna-sozen/',
    );

    expect(homes).toEqual([]);
  });

  it('does not promote thin external JavaScript shells as research homes', () => {
    const homes = extractOfficialProfileResearchHomes(
      profileLinkedThinExternalWebsiteHtml,
      'https://medicine.yale.edu/profile/elizabeth-connors/',
    );

    expect(homes).toEqual([]);
  });

  it('canonicalizes the MRRC hostname alias to the current Magnetic Resonance Core URL', () => {
    const homes = extractOfficialProfileResearchHomes(
      profileLinkedMrrcAliasWebsiteHtml,
      'https://medicine.yale.edu/profile/dana-peters/',
    );

    expect(homes[0]).toMatchObject({
      name: 'Magnetic Resonance Research Center',
      url: 'https://medicine.yale.edu/biomedical-imaging-institute/core-facilities/mr-core/',
    });
  });

  it('does not promote unreachable external collaboratory websites', () => {
    const homes = extractOfficialProfileResearchHomes(
      profileLinkedPainCollaboratoryWebsiteHtml,
      'https://medicine.yale.edu/profile/robert-kerns/',
    );

    expect(homes).toEqual([]);
  });

  it('cleans overlong Y-Weight profile-card labels to the center name', () => {
    const homes = extractOfficialProfileResearchHomes(
      profileLinkedYWeightWebsiteHtml,
      'https://medicine.yale.edu/profile/ania-jastreboff/',
    );

    expect(homes[0]).toMatchObject({
      name: 'Yale Obesity Research Center (Y-Weight)',
      url: 'https://medicine.yale.edu/y-weight/research/',
      kind: 'center',
      entityType: 'CENTER',
    });
  });

  it('preserves NOURISH acronym casing in profile-linked lab labels', () => {
    const homes = extractOfficialProfileResearchHomes(
      profileLinkedNourishTeamWebsiteHtml,
      'https://medicine.yale.edu/profile/catherine-buck/',
    );

    expect(homes[0]).toMatchObject({
      name: 'Yale Neonatal NOURISH Team',
      url: 'https://medicine.yale.edu/pediatrics/perinatal/research/nourish_program/',
    });
  });

  it('preserves CarDS acronym casing in profile-linked lab labels', () => {
    const homes = extractOfficialProfileResearchHomes(
      profileLinkedCardsLabWebsiteHtml,
      'https://medicine.yale.edu/profile/rohan-khera/',
    );

    expect(homes[0]).toMatchObject({
      name: 'CarDS Lab',
      url: 'https://www.cards-lab.org/',
    });
  });

  it('does not promote person profile pages as lab website replacements', () => {
    const homes = extractOfficialProfileResearchHomes(
      profileLinkedPersonPageWebsiteHtml,
      'https://medicine.yale.edu/profile/leonard-kaczmarek/',
    );

    expect(homes).toEqual([]);
  });

  it('prioritizes an explicit profile-linked lab website over a broader center affiliation', () => {
    const homes = extractOfficialProfileResearchHomes(
      profileLinkedExternalLabWebsiteHtml,
      'https://medicine.yale.edu/profile/haifan-lin/',
    );

    expect(homes[0]).toMatchObject({
      name: 'Haifan Lin Lab',
      url: 'https://www.haifanlinlab.org/',
      kind: 'lab',
      entityType: 'LAB',
    });
  });

  it('uses the profile card label for explicit lab website links instead of inventing a PI lab name', () => {
    const homes = extractOfficialProfileResearchHomes(
      profileLinkedNamedLabWebsiteHtml,
      'https://medicine.yale.edu/profile/mark-lemmon/',
    );

    expect(homes[0]).toMatchObject({
      name: 'Lemmon and Ferguson Labs',
      url: 'https://www.lemmonfergusonlabs.com/',
      kind: 'lab',
      entityType: 'LAB',
    });
    expect(homes.map((home) => home.name)).not.toContain('Mark A Lemmon Lab');
  });

  it('strips profile card icon text and prose from explicit lab website labels', () => {
    const homes = extractOfficialProfileResearchHomes(
      profileLinkedIconLabWebsiteHtml,
      'https://medicine.yale.edu/profile/michelle-hampson/',
    );

    expect(homes[0]).toMatchObject({
      name: 'Hampson Lab',
      url: 'https://campuspress.yale.edu/hampsonlab/',
      kind: 'lab',
      entityType: 'LAB',
    });
  });

  it('preserves brand-style words in explicit lab website labels', () => {
    const homes = extractOfficialProfileResearchHomes(
      profileLinkedBioImageProjectWebsiteHtml,
      'https://medicine.yale.edu/profile/xenophon-papademetris/',
    );

    expect(homes[0]).toMatchObject({
      name: 'BioImage Suite Project',
      url: 'https://bioimagesuiteweb.github.io/webapp/',
      kind: 'lab',
      entityType: 'LAB',
    });
  });

  it('canonicalizes the Gracheva lab profile-card alias to the direct lab page', () => {
    const homes = extractOfficialProfileResearchHomes(
      profileLinkedSquirrelLabWebsiteHtml,
      'https://medicine.yale.edu/profile/elena-gracheva/',
    );

    expect(homes[0]).toMatchObject({
      name: 'Elena Gracheva Lab',
      url: 'https://campuspress.yale.edu/squirrel/people/elena-gracheva-lab/',
      kind: 'lab',
      entityType: 'LAB',
    });
  });

  it('canonicalizes the Bagriantsev lab profile-card alias to the direct lab page', () => {
    const homes = extractOfficialProfileResearchHomes(
      profileLinkedSlavLabWebsiteHtml,
      'https://medicine.yale.edu/profile/sviatoslav-bagriantsev/',
    );

    expect(homes[0]).toMatchObject({
      name: 'Slav Bagriantsev Lab',
      url: 'https://campuspress.yale.edu/squirrel/people/the-bagriantsev-lab/',
      kind: 'lab',
      entityType: 'LAB',
    });
  });

  it('expands YCSC profile-card shorthand in explicit lab website labels', () => {
    const homes = extractOfficialProfileResearchHomes(
      profileLinkedYcscLabWebsiteHtml,
      'https://medicine.yale.edu/profile/wan-ling-tseng/',
    );

    expect(homes[0]).toMatchObject({
      name: 'Yale Child Study Center Affective Youth (YAY) Lab',
      url: 'https://medicine.yale.edu/childstudy/research/collaborative-labs/yay-lab/',
      kind: 'lab',
      entityType: 'LAB',
    });
  });

  it('canonicalizes legacy Child Study Center lab website links from profile cards', () => {
    const homes = extractOfficialProfileResearchHomes(
      profileLinkedLegacyChildStudyLabWebsiteHtml,
      'https://medicine.yale.edu/profile/linda-mayes/',
    );

    expect(homes[0]).toMatchObject({
      name: 'Developmental Electrophysiology Laboratory',
      url: 'https://medicine.yale.edu/childstudy/research/collaborative-labs/developmental-electrophysiology-lab/',
      kind: 'lab',
      entityType: 'LAB',
    });
  });

  it('strips prose after parenthetical lab names in explicit lab website labels', () => {
    const homes = extractOfficialProfileResearchHomes(
      profileLinkedParentheticalLabWebsiteHtml,
      'https://medicine.yale.edu/profile/carla-stover/',
    );

    expect(homes[0]).toMatchObject({
      name: 'Fathers for Change (Stover Lab)',
      url: 'https://medicine.yale.edu/childstudy/research/community-and-implementation/fathers-for-change/',
      kind: 'lab',
      entityType: 'LAB',
    });
  });

  it('does not promote outside-Yale deputy director positions as lab replacements', () => {
    const homes = extractOfficialProfileResearchHomes(
      outsideYaleDeputyDirectorProfileHtml,
      'https://medicine.yale.edu/profile/andrew-tan/',
    );

    expect(homes).toEqual([]);
  });

  it('does not promote outside-Yale deputy director text when profile sections collapse together', () => {
    const homes = extractOfficialProfileResearchHomes(
      outsideYaleNoSeparatorDeputyProfileHtml,
      'https://medicine.yale.edu/profile/andrew-tan/',
    );

    expect(homes).toEqual([]);
  });

  it('emits same-entity research home observations that can replace NIH PI fallback identity', () => {
    const [home] = extractOfficialProfileResearchHomes(
      sinusasProfileHtml,
      'https://medicine.yale.edu/profile/albert-sinusas/',
    );

    const obs = entityResearchHomeToObservations(
      {
        _id: '6a057df913fc60d57ec2a571',
        slug: 'nih-pi-albert-sinusas',
        name: 'Albert Sinusas Lab',
        sourceUrls: ['https://reporter.nih.gov/project-details/11168153'],
      },
      home,
      'https://medicine.yale.edu/profile/albert-sinusas/',
    );

    expect(obs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: 'researchEntity',
          entityId: '6a057df913fc60d57ec2a571',
          entityKey: 'nih-pi-albert-sinusas',
          field: 'name',
          value: 'Yale Translational Research Imaging Center',
          confidenceOverride: 0.96,
        }),
        expect.objectContaining({
          field: 'websiteUrl',
          value: 'https://medicine.yale.edu/internal-medicine/cardio/research/translational-imaging/',
        }),
        expect.objectContaining({
          field: 'sourceUrls',
          value: [
            'https://reporter.nih.gov/project-details/11168153',
            'https://medicine.yale.edu/profile/albert-sinusas/',
            'https://medicine.yale.edu/internal-medicine/cardio/research/translational-imaging/',
          ],
        }),
      ]),
    );
  });

  it('emits direct lead website observations without inventing a research-home name', () => {
    const obs = entityLeadDirectWebsiteToObservations(
      {
        _id: 'entity-caccone',
        slug: 'caccone-lab-ac3',
        name: 'Caccone Lab',
        sourceUrls: ['https://eeb.yale.edu/people/faculty-research-scientists-lecturer/adalgisa-caccone/'],
      },
      'http://caccone.yale.edu/',
    );

    expect(obs).toEqual([
      expect.objectContaining({
        entityType: 'researchEntity',
        entityId: 'entity-caccone',
        entityKey: 'caccone-lab-ac3',
        field: 'website',
        value: 'http://caccone.yale.edu/',
        sourceUrl: 'http://caccone.yale.edu/',
        confidenceOverride: 0.88,
      }),
      expect.objectContaining({
        field: 'websiteUrl',
        value: 'http://caccone.yale.edu/',
      }),
      expect.objectContaining({
        field: 'sourceUrls',
        value: [
          'https://eeb.yale.edu/people/faculty-research-scientists-lecturer/adalgisa-caccone/',
          'http://caccone.yale.edu/',
        ],
      }),
    ]);
    expect(obs.map((item) => item.field)).not.toContain('name');
  });

  it('emits guarded fallback identity observations when no existing user email bridge exists', async () => {
    const emitted: ObservationInput[] = [];
    const scraper = new OfficialProfilePiBackfillScraper(
      vi.fn(async () => ysmJsonProfileHtml),
      vi.fn(async () => [
        {
          _id: 'entity-2',
          name: 'Caroline H. Johnson Research',
          slug: 'faculty-research-area-caroline-h-johnson',
          websiteUrl: 'https://medicine.yale.edu/profile/caroline-johnson/',
        },
      ]),
      vi.fn(async () => null),
    );

    const result = await scraper.run(contextFor(emitted));

    expect(result).toMatchObject({ observationCount: emitted.length, entitiesObserved: 1 });
    expect(emitted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: 'user',
          entityKey: 'netid:caroline.johnson',
          field: 'email',
          value: 'caroline.johnson@yale.edu',
        }),
        expect.objectContaining({
          entityType: 'researchEntity',
          entityKey: 'faculty-research-area-caroline-h-johnson',
          field: 'inferredPiUserKey',
          value: 'caroline.johnson',
        }),
      ]),
    );
  });
});
