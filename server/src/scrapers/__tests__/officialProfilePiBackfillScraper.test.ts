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

const profileUrl = 'https://medicine.yale.edu/profile/jules-fixture/';
const departmentPersonPageUrl =
  'https://engineering.yale.edu/research-and-faculty/faculty-directory/drew-fixture/';

const profileHtml = `
  <html>
    <head>
      <link rel="canonical" href="${profileUrl}" />
      <meta name="description" content="Professor of Surgery (Oncology)" />
      <meta property="og:image" content="https://ysm-res.cloudinary.com/image/upload/example/jules-fixture" />
    </head>
    <body>
      <main>
        <h1>Jules Fixture</h1>
        <div class="title">Professor of Surgery (Oncology)</div>
        <a href="mailto:jules.fixture@yale.edu">jules.fixture@yale.edu</a>
        <div class="department">Surgery</div>
        <section class="biography">
          Jules Fixture studies translational cancer biology and develops clinical research
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
        <h1>Jules Fixture</h1>
        <div class="title">Professor of Surgery (Oncology)</div>
        <section class="biography">
          Jules Fixture studies translational cancer biology and develops clinical research
          programs for gastrointestinal oncology.
        </section>
      </main>
    </body>
  </html>
`;

const ysmJsonProfileHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://ysph.yale.edu/profile/cameron-profile/" />
      <script type="application/ld+json">
        {
          "@type": "ProfilePage",
          "mainEntity": {
            "@type": "Person",
            "name": "Cameron Profile",
            "email": "cameron.profile@yale.edu",
            "jobTitle": "Associate Professor of Epidemiology"
          }
        }
      </script>
    </head>
    <body>
      <h1>Cameron Profile</h1>
      <a href="mailto:ysm.editor@yale.edu">ysm.editor@yale.edu</a>
    </body>
  </html>
`;

const sinusasProfileHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://medicine.yale.edu/profile/taylor-profile/" />
      <script type="application/ld+json" data-schema="ProfilePage">
        {
          "@type": "ProfilePage",
          "mainEntity": {
            "@type": "Person",
            "@id": "https://medicine.yale.edu/profile/taylor-profile/",
            "name": "Taylor Sinusas",
            "email": "taylor.profile@yale.edu",
            "jobTitle": ["Professor of Medicine (Cardiology)"],
            "description": "Taylor Sinusas is Director of the Yale Translational Research Imaging Center (Y-TRIC). His research is directed at development, validation and application of non-invasive cardiovascular imaging approaches.",
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
        <h1>Taylor Sinusas, MD</h1>
        <div class="title">Professor of Medicine (Cardiology)</div>
        <a href="mailto:taylor.profile@yale.edu">taylor.profile@yale.edu</a>
        <section class="biography">
          Taylor Sinusas is Director of the Yale Translational Research Imaging Center (Y-TRIC).
          My research involves development, validation, and application of non-invasive imaging approaches.
        </section>
      </main>
    </body>
</html>
`;

const linkedResearchHomeProfileHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://medicine.yale.edu/profile/taylor-profile/" />
      <script type="application/ld+json" data-schema="ProfilePage">
        {
          "@type": "ProfilePage",
          "mainEntity": {
            "@type": "Person",
            "name": "Taylor Sinusas",
            "email": "taylor.profile@yale.edu",
            "jobTitle": "Professor of Medicine (Cardiology)"
          }
        }
      </script>
    </head>
    <body>
      <main>
        <h1>Taylor Sinusas, MD</h1>
        <p>
          Taylor Sinusas is Director of the
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
      <meta property="og:title" content="Drew Fixture | Professor Emeritus | Yale Engineering" />
    </head>
    <body>
      <main>
        <h1>Drew Fixture</h1>
        <div class="title">Professor Emeritus of Computer Science</div>
        <a href="mailto:drew.fixture@yale.edu">drew.fixture@yale.edu</a>
        <section class="biography">
          Drew Fixture received her PhD in Engineering Science from UC Berkeley and spent her
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
      <link rel="canonical" href="https://environment.yale.edu/directory/faculty/sage-fixture" />
      <meta property="og:title" content="Sage Fixture | Yale School of the Environment" />
    </head>
    <body>
      <main>
        <h1>Sage Fixture</h1>
        <div class="title">
          Jules F. Cullman 3rd Adjunct Professor Emeritus of Wildlife Ecology and Policy Sciences
        </div>
        <a href="mailto:sage.fixture@yale.edu">sage.fixture@yale.edu</a>
        <section class="biography">
          Professor Fixture's primary goal in her research and teaching is to improve conservation
          of species and ecosystems at professional, scientific, organizational, and policy levels.
        </section>
      </main>
    </body>
  </html>
`;

const yseDirectoryProfileWithNewsTitleHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://environment.yale.edu/directory/faculty/mika-fixture/" />
      <meta property="og:title" content="Mika L. Fixture | Yale School of the Environment" />
    </head>
    <body>
      <main>
        <h1>Mika L. Fixture</h1>
        <article>
          <div class="views-field-title">
            Advancing heat-related mental health research: moving beyond epidemiological links
          </div>
        </article>
        <div class="profile-position">
          Senior Associate Dean of Research and Director of Doctoral Studies; Mary E. Pinchot Professor of Environmental Health
        </div>
        <a href="mailto:mika.fixture@yale.edu">mika.fixture@yale.edu</a>
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
      <link rel="canonical" href="https://statistics.yale.edu/profile/ari-fixture/" />
      <meta property="og:title" content="Ari Fixture | Yale Statistics and Data Science" />
    </head>
    <body>
      <main>
        <h1>Ari Fixture</h1>
        <div class="title">John C. Malone Professor of Electrical Engineering and of Statistics and Data Science</div>
        <a href="mailto:ari.fixture@yale.edu">ari.fixture@yale.edu</a>
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
      <link rel="canonical" href="https://engineering.yale.edu/research-and-faculty/faculty-directory/ash-fixture/" />
      <meta property="og:title" content="Ash Fixture | Yale Engineering" />
    </head>
    <body>
      <main>
        <h1>Ash Fixture</h1>
        <div class="title">Assistant Professor of Computer Science</div>
        <a href="mailto:ash.fixture@yale.edu">ash.fixture@yale.edu</a>
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
      <link rel="canonical" href="https://english.yale.edu/people/kai-fixture/" />
      <meta property="og:title" content="Kai Fixture | Yale English" />
    </head>
    <body>
      <main>
        <h1>Kai Fixture</h1>
        <div class="title">Lecturer in English</div>
        <a href="mailto:kai.fixture@yale.edu">kai.fixture@yale.edu</a>
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
      <link rel="canonical" href="https://engineering.yale.edu/research-and-faculty/faculty-directory/lee-fixture/" />
      <meta property="og:title" content="Lee Fixture | Yale Engineering" />
    </head>
    <body>
      <main>
        <h1>Lee Fixture</h1>
        <div class="title">Assistant Professor of Chemical & Environmental Engineering</div>
        <a href="mailto:lee.fixture@yale.edu">lee.fixture@yale.edu</a>
        <section class="biography">
          Yingzheng Fan, Yu Yan, Obinna Nwokonkwo, John Fixture, Margaret Liu,
          Leo Chen, Lee Fixture*. "Tuning membranes for selective separations."
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
      <link rel="canonical" href="https://engineering.yale.edu/research-and-faculty/faculty-directory/lee-fixture/" />
      <meta property="og:title" content="Lee Fixture | Yale Engineering" />
    </head>
    <body>
      <main>
        <h1>Lee Fixture</h1>
        <div class="title">Assistant Professor of Chemical & Environmental Engineering</div>
        <a href="mailto:lee.fixture@yale.edu">lee.fixture@yale.edu</a>
        <section class="biography">
          Julia Simon, Lee Fixture*. "Plasma-activated co-conversion of N2 and C1 gases
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
      <link rel="canonical" href="https://ysph.yale.edu/profile/jesse-fixture/" />
      <meta property="og:title" content="Jesse Fixture | Yale School of Public Health" />
    </head>
    <body>
      <main>
        <h1>Jesse Fixture</h1>
        <div class="title">Associate Professor of Public Health (Health Policy)</div>
        <a href="mailto:jesse.fixture@yale.edu">jesse.fixture@yale.edu</a>
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
      <link rel="canonical" href="https://medicine.yale.edu/profile/morgan-fixture/" />
      <meta property="og:title" content="Morgan Fixture | Yale Medicine" />
    </head>
    <body>
      <main>
        <h1>Morgan Fixture</h1>
        <div class="title">Professor of Medicine</div>
        <a href="mailto:morgan.fixture@yale.edu">morgan.fixture@yale.edu</a>
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
      <link rel="canonical" href="https://medicine.yale.edu/profile/sam-fixture/" />
      <meta property="og:title" content="Sam Fixture | Yale Medicine" />
    </head>
    <body>
      <main>
        <h1>Sam Fixture</h1>
        <div class="title">Assistant Professor of Medicine</div>
        <a href="mailto:sam.fixture@yale.edu">sam.fixture@yale.edu</a>
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
      <link rel="canonical" href="https://physics.yale.edu/people/avery-fixture/" />
      <meta property="og:title" content="Avery Fixture | Yale Physics" />
    </head>
    <body>
      <main>
        <h1>Avery Fixture</h1>
        <div class="title">Professor of Mathematics and Physics</div>
        <a href="mailto:avery.fixture@yale.edu">avery.fixture@yale.edu</a>
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
      <link rel="canonical" href="https://physics.yale.edu/people/avery-fixture/" />
      <meta property="og:title" content="Avery Fixture | Yale Physics" />
    </head>
    <body>
      <main>
        <h1>Avery Fixture</h1>
        <div class="title">Professor of Mathematics and Physics</div>
        <a href="mailto:avery.fixture@yale.edu">avery.fixture@yale.edu</a>
        <section class="biography">Problems in string theory and supersymmetric field theory</section>
      </main>
    </body>
  </html>
`;

const profileOverviewAfterContactHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://medicine.yale.edu/profile/sky-fixture/" />
      <meta property="og:image" content="https://ysm-res.cloudinary.com/image/upload/example/sky-fixture" />
    </head>
    <body>
      <main>
        <h1>Sky Fixture, MD, PhD</h1>
        <div class="title">
          William H. Fleming, M.D. Professor of Molecular Biophysics and Biochemistry
        </div>
        <a href="mailto:sky.fixture@yale.edu">sky.fixture@yale.edu</a>
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
      <link rel="canonical" href="https://medicine.yale.edu/profile/jules-audio-fixture/" />
      <script type="application/ld+json" data-schema="ProfilePage">
        {
          "@type": "ProfilePage",
          "mainEntity": {
            "@type": "Person",
            "name": "Jules Hearing",
            "email": "jules.hearing@yale.edu",
            "jobTitle": "Professor of Surgery",
            "description": "Jules Hearing directs the Yale Ear Lab.",
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
        <h1>Jules Hearing</h1>
        <p>Jules Hearing directs the Yale Ear Lab.</p>
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
      <link rel="canonical" href="https://medicine.yale.edu/profile/riley-nutrition-fixture/" />
      <script type="application/ld+json" data-schema="ProfilePage">
        {
          "@type": "ProfilePage",
          "mainEntity": {
            "@type": "Person",
            "name": "Riley Nutrition",
            "email": "drew.small@yale.edu",
            "jobTitle": "Professor",
            "description": "Riley Nutrition studies nutrition and neural circuits.",
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
        <p>Riley Nutrition studies nutrition and neural circuits.</p>
      </main>
    </body>
  </html>
`;

const centerPrefixProgramTitleHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://medicine.yale.edu/profile/wren-fixture/" />
      <script type="application/ld+json" data-schema="ProfilePage">
        {
          "@type": "ProfilePage",
          "mainEntity": {
            "@type": "Person",
            "name": "Wren Fixture",
            "email": "wren.fixture@yale.edu",
            "jobTitle": "Professor",
            "description": "Wren Fixture is Director, Yale Child Study Center Program for Anxiety Disorders. She is also Director of the Yale Child Study Center Anxiety and Mood Disorders Program.",
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
          Wren Fixture is Director, Yale Child Study Center Program for Anxiety Disorders.
          She is also Director of the Yale Child Study Center Anxiety and Mood Disorders Program.
        </p>
      </main>
    </body>
  </html>
`;

const broadChildStudyCenterLeadershipHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://medicine.yale.edu/profile/lane-fixture/" />
      <script type="application/ld+json" data-schema="ProfilePage">
        {
          "@type": "ProfilePage",
          "mainEntity": {
            "@type": "Person",
            "name": "Lane Fixture",
            "email": "lane.fixture@yale.edu",
            "jobTitle": "Professor",
            "description": "Lane Fixture is Chair of the Child Study Center.",
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
        <p>Lane Fixture is Chair of the Child Study Center.</p>
      </main>
    </body>
  </html>
`;

const associateDirectorSubareaProfileHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://medicine.yale.edu/profile/xen-fixture/" />
      <script type="application/ld+json" data-schema="ProfilePage">
        {
          "@type": "ProfilePage",
          "mainEntity": {
            "@type": "Person",
            "name": "Xen Fixture",
            "email": "xen.fixture@yale.edu",
            "jobTitle": "Professor",
            "description": "Xen Fixture is Associate Director of Biomedical Imaging Data Sciences, Yale Biomedical Imaging Institute.",
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
          Xen Fixture is Associate Director of Biomedical Imaging Data Sciences,
          Yale Biomedical Imaging Institute.
        </p>
      </main>
    </body>
  </html>
`;

const yalePrefixedLeadershipProfileHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://medicine.yale.edu/profile/morgan-fixture/" />
      <script type="application/ld+json" data-schema="ProfilePage">
        {
          "@type": "ProfilePage",
          "mainEntity": {
            "@type": "Person",
            "name": "Morgan Fixture",
            "email": "morgan.fixture@yale.edu",
            "jobTitle": "Professor",
            "description": "Morgan Fixture is Co-Director, Yale Liver Center, Digestive Diseases.",
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
        <p>Morgan Fixture is Co-Director, Yale Liver Center, Digestive Diseases.</p>
      </main>
    </body>
  </html>
`;

const contactInfoOnlyResearchHomeProfileHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://medicine.yale.edu/profile/devon-fixture/" />
      <script type="application/ld+json" data-schema="ProfilePage">
        {
          "@type": "ProfilePage",
          "mainEntity": {
            "@type": "Person",
            "name": "Dennis G Moledina",
            "email": "devon.fixture@yale.edu",
            "jobTitle": "Associate Professor",
            "description": "Devon Fixture is Director, Research Fellowship, Nephrology; Vice Chief for Research (Clinical and translational), Nephrology; Director, Kidney BioBank, Nephrology.",
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
      <link rel="canonical" href="https://medicine.yale.edu/profile/sawyer-fixture/" />
      <script type="application/ld+json" data-schema="ProfilePage">
        {
          "@type": "ProfilePage",
          "mainEntity": {
            "@type": "Person",
            "name": "Sawyer Fixture",
            "email": "sawyer.fixture@yale.edu",
            "jobTitle": "Professor",
            "description": "Sawyer Fixture founded the Neuroscience & Regeneration Research Center at Yale in 1988 and is its Director."
          }
        }
      </script>
    </head>
    <body>
      <main>
        <p>Sawyer Fixture founded the Neuroscience & Regeneration Research Center at Yale in 1988 and is its Director.</p>
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
      <link rel="canonical" href="https://medicine.yale.edu/profile/casey-fixture/" />
      <script type="application/ld+json" data-schema="ProfilePage">
        {
          "@type": "ProfilePage",
          "mainEntity": {
            "@type": "Person",
            "name": "Casey Fixture",
            "email": "casey.fixture@yale.edu",
            "jobTitle": "Associate Research Scientist",
            "description": "Casey Fixture is affiliated with the Calvin Hill Day Care Center and Kitty Lustman-Findling Kindergarten."
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
      <link rel="canonical" href="https://politicalscience.yale.edu/people/jordan-policy-fixture/" />
    </head>
    <body>
      <main>
        <p>
          Jordan Policy is Co-Director of the Ludwig Program in Public Sector Leadership
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
      <link rel="canonical" href="https://history.yale.edu/people/parker-history-fixture/" />
    </head>
    <body>
      <main>
        <p>Parker History is associated with the Medieval Studies Program.</p>
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
      <link rel="canonical" href="https://medicine.yale.edu/profile/alex-diagnostics-fixture/" />
    </head>
    <body>
      <main>
        <p>Alex Diagnostics is Director, DNA Diagnostic Lab.</p>
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
      <link rel="canonical" href="https://medicine.yale.edu/profile/sasha-modeler-fixture/" />
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
      <link rel="canonical" href="https://medicine.yale.edu/profile/remy-neuro-fixture/" />
    </head>
    <body>
      <main>
        <p>Remy Neuro directs the Radhakrishnan Lab.</p>
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
      <link rel="canonical" href="https://medicine.yale.edu/profile/morgan-global-fixture/" />
    </head>
    <body>
      <main>
        <p>Morgan Global is involved with the MD-PhD Program.</p>
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
      <link rel="canonical" href="https://medicine.yale.edu/profile/kai-informatics-fixture/" />
    </head>
    <body>
      <main>
        <p>Kai Informatics works in Biomedical Informatics &amp; Data Science.</p>
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
      <link rel="canonical" href="https://medicine.yale.edu/profile/devon-orthopedics-fixture/" />
    </head>
    <body>
      <main>
        <p>Devon Orthopedics is affiliated with the Yale Avascular Necrosis Program.</p>
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
      <link rel="canonical" href="https://medicine.yale.edu/profile/avery-finance-fixture/" />
    </head>
    <body>
      <main>
        <p>Avery Finance directs the Recovery Finance Project.</p>
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
      <link rel="canonical" href="https://medicine.yale.edu/profile/blair-development-fixture/" />
    </head>
    <body>
      <main>
        <p>Blair Development leads the modelling development and disease lab.</p>
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
      <link rel="canonical" href="https://medicine.yale.edu/profile/ellis-schoolhealth-fixture/" />
    </head>
    <body>
      <main>
        <p>Ellis Schoolhealth works with Partnerships for Research and Implementation in School Mental Health.</p>
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
      <link rel="canonical" href="https://medicine.yale.edu/profile/drew-imaging-fixture/" />
    </head>
    <body>
      <main>
        <p>Drew Imaging is affiliated with the Magnetic Resonance Research Center.</p>
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
      <link rel="canonical" href="https://medicine.yale.edu/profile/robin-pain-fixture/" />
    </head>
    <body>
      <main>
        <p>Robin Pain is affiliated with the Pain Management Collaboratory Coordinating Center.</p>
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
      <link rel="canonical" href="https://medicine.yale.edu/profile/ari-obesity-fixture/" />
    </head>
    <body>
      <main>
        <p>Ari Obesity directs the Yale Obesity Research Center (Y-Weight).</p>
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
      <link rel="canonical" href="https://medicine.yale.edu/profile/cameron-neonatal-fixture/" />
    </head>
    <body>
      <main>
        <p>Cameron Neonatal is affiliated with the Yale Neonatal NOuRISH Team.</p>
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
      <link rel="canonical" href="https://medicine.yale.edu/profile/rory-cards-fixture/" />
    </head>
    <body>
      <main>
        <p>Rory Cards leads the CarDS Lab.</p>
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
      <link rel="canonical" href="https://medicine.yale.edu/profile/logan-channels-fixture/" />
    </head>
    <body>
      <main>
        <p>Logan Channels leads the Kaczmarek Lab.</p>
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
      <link rel="canonical" href="https://medicine.yale.edu/profile/hayden-fixture/" />
      <script type="application/ld+json" data-schema="ProfilePage">
        {
          "@type": "ProfilePage",
          "mainEntity": {
            "@type": "Person",
            "name": "Hayden Fixture, PhD",
            "email": "hayden.fixture@yale.edu",
            "jobTitle": "Professor",
            "description": "Hayden Fixture is Director, Yale Stem Cell Center.",
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
        <p>Hayden Fixture is Director, Yale Stem Cell Center.</p>
        <div>Hayden Fixture Lab<a href="https://www.haifanlinlab.org/">View Lab Website</a></div>
      </main>
    </body>
  </html>
`;

const profileLinkedNamedLabWebsiteHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://medicine.yale.edu/profile/morgan-cell-fixture/" />
      <script type="application/ld+json" data-schema="ProfilePage">
        {
          "@type": "ProfilePage",
          "mainEntity": {
            "@type": "Person",
            "name": "Mark A Lemmon",
            "email": "morgan.lemma@yale.edu",
            "jobTitle": "Professor",
            "description": "Morgan Cell studies cell signaling.",
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
        <p>Morgan Cell studies cell signaling.</p>
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
      <link rel="canonical" href="https://medicine.yale.edu/profile/mika-neurofeedback-fixture/" />
      <script type="application/ld+json" data-schema="ProfilePage">
        {
          "@type": "ProfilePage",
          "mainEntity": {
            "@type": "Person",
            "name": "Mika Neurofeedback",
            "email": "mika.hampson@yale.edu",
            "jobTitle": "Professor",
            "description": "Mika Neurofeedback studies fMRI neurofeedback."
          }
        }
      </script>
    </head>
    <body>
      <main>
        <h1>Mika Neurofeedback</h1>
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
      <link rel="canonical" href="https://medicine.yale.edu/profile/xen-fixture/" />
      <script type="application/ld+json" data-schema="ProfilePage">
        {
          "@type": "ProfilePage",
          "mainEntity": {
            "@type": "Person",
            "name": "Xen Fixture",
            "email": "xen.fixture@yale.edu",
            "jobTitle": "Professor",
            "description": "Xen Fixture develops medical image analysis software."
          }
        }
      </script>
    </head>
    <body>
      <main>
        <h1>Xen Fixture</h1>
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
      <link rel="canonical" href="https://medicine.yale.edu/profile/emery-fixture/" />
      <script type="application/ld+json" data-schema="ProfilePage">
        {
          "@type": "ProfilePage",
          "mainEntity": {
            "@type": "Person",
            "name": "Emery Fixture",
            "email": "emery.fixture@yale.edu",
            "jobTitle": "Professor",
            "description": "Emery Fixture studies sensory physiology and hibernation biology."
          }
        }
      </script>
    </head>
    <body>
      <main>
        <h1>Emery Fixture</h1>
        <div>
          Emery Lab
          <a href="https://squirrel.commons.yale.edu/">View Lab Website</a>
        </div>
      </main>
    </body>
  </html>
`;

const profileLinkedSlavLabWebsiteHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://medicine.yale.edu/profile/sviatosloan-fixture/" />
      <script type="application/ld+json" data-schema="ProfilePage">
        {
          "@type": "ProfilePage",
          "mainEntity": {
            "@type": "Person",
            "name": "Sloan Fixture",
            "email": "sloan.fixture@yale.edu",
            "jobTitle": "Professor",
            "description": "Sloan Fixture studies sensory physiology and ion channels."
          }
        }
      </script>
    </head>
    <body>
      <main>
        <h1>Sloan Fixture</h1>
        <div>
          The Sloan Lab
          <a href="https://slavlab.yale.edu">View Lab Website</a>
        </div>
      </main>
    </body>
  </html>
`;

const profileLinkedYcscLabWebsiteHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://medicine.yale.edu/profile/wynn-fixture/" />
      <script type="application/ld+json" data-schema="ProfilePage">
        {
          "@type": "ProfilePage",
          "mainEntity": {
            "@type": "Person",
            "name": "Wynn Fixture",
            "email": "wynn.fixture@yale.edu",
            "jobTitle": "Professor",
            "description": "Wynn Fixture studies youth affective development."
          }
        }
      </script>
    </head>
    <body>
      <main>
        <h1>Wynn Fixture</h1>
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
      <link rel="canonical" href="https://medicine.yale.edu/profile/lane-fixture/" />
      <script type="application/ld+json" data-schema="ProfilePage">
        {
          "@type": "ProfilePage",
          "mainEntity": {
            "@type": "Person",
            "name": "Lane Fixture",
            "email": "lane.fixture@yale.edu",
            "jobTitle": "Professor",
            "description": "Lane Fixture is Director of the Yale Developmental Electrophysiology Laboratory."
          }
        }
      </script>
    </head>
    <body>
      <main>
        <h1>Lane Fixture</h1>
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
      <link rel="canonical" href="https://medicine.yale.edu/profile/carter-fixture/" />
      <script type="application/ld+json" data-schema="ProfilePage">
        {
          "@type": "ProfilePage",
          "mainEntity": {
            "@type": "Person",
            "name": "Carter Fixture",
            "email": "carter.fixture@yale.edu",
            "jobTitle": "Professor",
            "description": "Carter Fixture develops interventions for families impacted by violence and trauma."
          }
        }
      </script>
    </head>
    <body>
      <main>
        <h1>Carter Fixture</h1>
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
      <link rel="canonical" href="https://medicine.yale.edu/profile/avery-tan/" />
      <script type="application/ld+json" data-schema="ProfilePage">
        {
          "@type": "ProfilePage",
          "mainEntity": {
            "@type": "Person",
            "name": "Avery Tan",
            "email": "avery.tan@yale.edu",
            "jobTitle": "Assistant Professor Adjunct",
            "description": "Avery Tan is Deputy Director, Center for Neuroscience and Regeneration Research, US Department of Veteran Affairs.",
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
      <link rel="canonical" href="https://medicine.yale.edu/profile/avery-tan/" />
      <script type="application/ld+json" data-schema="ProfilePage">
        {
          "@type": "ProfilePage",
          "mainEntity": {
            "@type": "Person",
            "name": "Avery Tan",
            "email": "avery.tan@yale.edu",
            "jobTitle": "Assistant Professor Adjunct",
            "description": "Avery Tan studies spinal cord injury.",
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
      normalizeOfficialProfileUrl('https://medicine.yale.edu/cancer/profile/jules-fixture'),
    ).toBe(profileUrl);
  });

  it('selects official profile URL candidates from trusted entity source fields', () => {
    expect(
      officialProfileUrlsForEntity({
        websiteUrl: 'https://medicine.yale.edu/cancer/profile/jules-fixture',
        sourceUrls: ['https://example.com/not-profile'],
      }),
    ).toEqual([profileUrl]);
  });

  it('selects matching official person URLs from observation source fields', () => {
    expect(
      officialProfileUrlsForEntity({
        name: 'Devon Politics Fixture — Research',
        sourceObservationUrls: [
          'http://politicalscience.yale.edu/people/devon-politics-fixture',
          'https://politicalscience.yale.edu/people/faculty',
        ],
      }),
    ).toEqual(['http://politicalscience.yale.edu/people/devon-politics-fixture/']);
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
        name: 'Nico Brown — Research',
        sourceObservationUrls: ['https://history.yale.edu/people/jordan-history-fixture/'],
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
      websiteUrl: 'https://anthropology.yale.edu/profile/riley-anthropology-fixture',
      sourceUrls: ['https://anthropology.yale.edu/people/faculty'],
    };

    expect(officialProfileUrlsForEntity(entity)).toEqual([
      'https://anthropology.yale.edu/profile/riley-anthropology-fixture/',
    ]);
    expect(shouldQueueEntityForPiBackfill(entity)).toBe(true);
  });

  it('prefers Medicine profile URLs when multiple official profiles are available', () => {
    expect(
      preferredOfficialProfileUrl([
        'https://anthropology.yale.edu/profile/riley-anthropology-fixture/',
        'https://medicine.yale.edu/profile/riley-anthropology-fixture/',
      ]),
    ).toBe('https://medicine.yale.edu/profile/riley-anthropology-fixture/');
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
          'https://history.yale.edu/people/jordan-history-fixture/',
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
      name: 'Jules Fixture Research Area',
      slug: 'faculty-research-area-jules-fixture',
    });

    expect(identity).toMatchObject({
      canonicalUrl: profileUrl,
      fetchedUrl: profileUrl,
      displayName: 'Jules Fixture',
      email: 'jules.fixture@yale.edu',
      title: 'Professor of Surgery (Oncology)',
      imageUrl: 'https://ysm-res.cloudinary.com/image/upload/example/jules-fixture',
    });
    expect(identity?.researchInterests).toEqual(['Cancer biology', 'Translational oncology']);
  });

  it('accepts canonicalized department person pages when both URLs match the entity person', () => {
    const identity = extractOfficialProfileIdentity(
      departmentPersonPageHtml,
      departmentPersonPageUrl.replace(/^https:/, 'http:'),
      {
        name: 'Drew Fixture — Research',
        slug: 'angluin-da3',
      },
    );

    expect(identity).toMatchObject({
      canonicalUrl: departmentPersonPageUrl,
      fetchedUrl: departmentPersonPageUrl.replace(/^https:/, 'http:'),
      displayName: 'Drew Fixture',
      email: 'drew.fixture@yale.edu',
      title: 'Professor Emeritus of Computer Science',
    });
  });

  it('accepts redirected official profile pages when an attached lead user matches the canonical person page', () => {
    const identity = extractOfficialProfileIdentity(
      redirectedDirectoryProfileHtml,
      'http://environment.yale.edu/profile/clark/',
      {
        name: 'Fixture Lab',
        slug: 'clark-lab-twc4',
        leadUsers: [
          {
            fname: 'Sage',
            lname: 'Fixture',
            email: 'sage.fixture@yale.edu',
          },
        ],
      },
      {
        requireEmail: false,
        expectedPeople: [
          {
            fname: 'Sage',
            lname: 'Fixture',
            email: 'sage.fixture@yale.edu',
          },
        ],
      },
    );

    expect(identity).toMatchObject({
      canonicalUrl: 'https://environment.yale.edu/directory/faculty/sage-fixture/',
      fetchedUrl: 'http://environment.yale.edu/profile/clark/',
      displayName: 'Sage Fixture',
      email: 'sage.fixture@yale.edu',
      title: 'Jules F. Cullman 3rd Adjunct Professor Emeritus of Wildlife Ecology and Policy Sciences',
    });
  });

  it('does not turn directory news titles or appointment lines into bios', () => {
    const identity = extractOfficialProfileIdentity(
      yseDirectoryProfileWithNewsTitleHtml,
      'https://environment.yale.edu/directory/faculty/mika-fixture/',
      {
        name: 'Mika Fixture Research',
        slug: 'faculty-research-area-mika-fixture',
      },
      {
        requireEmail: false,
        expectedPeople: [
          {
            fname: 'Mika',
            lname: 'Fixture',
            email: 'mika.fixture@yale.edu',
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
      email: 'mika.fixture@yale.edu',
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
      .replace(/Jules Fixture/g, 'Jordan Mismatch')
      .replace(/Jules Fixture/g, 'Jordan Mismatch')
      .replace(/jules\.fixture@yale\.edu/g, 'sage.mismatch@yale.edu');
    const entity = {
      name: 'Jordan Mismatch Research Area',
      slug: 'faculty-research-area-jordan-mismatch',
    };

    expect(extractOfficialProfileIdentity(contaminatedProfileHtml, profileUrl, entity)).toBeNull();

    const identity = extractOfficialProfileIdentity(contaminatedProfileHtml, profileUrl, entity, {
      requireEmail: false,
    });
    expect(identity).toMatchObject({
      displayName: 'Jordan Mismatch',
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
        name: 'Jules Fixture Research Area',
        slug: 'faculty-research-area-jules-fixture',
      },
    );

    expect(identity?.title).toBe('Professor of Surgery (Oncology)');
  });

  it('skips profile chrome headings when extracting the display name', () => {
    const identity = extractOfficialProfileIdentity(
      profileHtml.replace(
        '<h1>Jules Fixture</h1>',
        '<h1>INFORMATION FOR</h1><h1>Jules Fixture, PhDResearch Scientist of Surgery</h1>',
      ),
      profileUrl,
      {
        name: 'Jules Fixture Research Area',
        slug: 'faculty-research-area-jules-fixture',
      },
    );

    expect(identity?.displayName).toBe('Jules Fixture');
  });

  it('rejects surname-only profile matches when the known lead person differs', () => {
    const identity = extractOfficialProfileIdentity(
      profileHtml
        .replace(/Jules Fixture/g, 'June Fixture')
        .replace(/jules\.fixture@yale\.edu/g, 'june.fixture@yale.edu'),
      profileUrl,
      {
        name: 'Fixture Lab',
        slug: 'kim-lab-fixture106',
      },
      {
        expectedPeople: [{ fname: 'Jules', lname: 'Fixture', email: 'jules.fixture@yale.edu' }],
      },
    );

    expect(identity).toBeNull();
  });

  it('clips long official profile bios at a sentence boundary', () => {
    const longSentence =
      'Jules Fixture studies translational cancer biology and develops clinical research programs for gastrointestinal oncology. ';
    const identity = extractOfficialProfileIdentity(
      profileHtml.replace(
        /Jules Fixture studies[\s\S]*?gastrointestinal oncology\./,
        longSentence.repeat(20),
      ),
      profileUrl,
      {
        name: 'Jules Fixture Research Area',
        slug: 'faculty-research-area-jules-fixture',
      },
    );

    expect(identity?.bio?.length).toBeLessThanOrEqual(1200);
    expect(identity?.bio).toMatch(/\.$/);
  });

  it('removes trailing official profile update metadata from extracted bios', () => {
    const identity = extractOfficialProfileIdentity(
      profileHtml.replace(
        /Jules Fixture studies[\s\S]*?gastrointestinal oncology\./,
        'Jules Fixture studies translational cancer biology and develops clinical research programs for gastrointestinal oncology. Last Updated on December 01, 2024.',
      ),
      profileUrl,
      {
        name: 'Jules Fixture Research Area',
        slug: 'faculty-research-area-jules-fixture',
      },
    );

    expect(identity?.bio).toBe(
      'Jules Fixture studies translational cancer biology and develops clinical research programs for gastrointestinal oncology.',
    );
  });

  it('does not clip official profile bios at dangling honorific abbreviations', () => {
    const longBio =
      'Jules Fixture studies translational cancer biology and develops clinical research programs for gastrointestinal oncology '.repeat(
        11,
      ) + 'Dr. Fixture also mentors students in clinical trial design and translational oncology. '.repeat(5);
    const identity = extractOfficialProfileIdentity(
      profileHtml.replace(/Jules Fixture studies[\s\S]*?gastrointestinal oncology\./, longBio),
      profileUrl,
      {
        name: 'Jules Fixture Research Area',
        slug: 'faculty-research-area-jules-fixture',
      },
    );

    expect(identity?.bio?.length).toBeLessThanOrEqual(1200);
    expect(identity?.bio).toMatch(/[.!?]$/);
    expect(identity?.bio).not.toMatch(/\bDr\.$/);
  });

  it('does not derive a user bio from official interests when the profile bio is address chrome', () => {
    const identity = extractOfficialProfileIdentity(
      profileWithAddressInsteadOfBioHtml,
      'https://statistics.yale.edu/profile/ari-fixture/',
      {
        name: 'Ari Fixture Research',
        slug: 'faculty-research-area-ari-fixture',
      },
    );

    const obs = identityToUserObservations(identity!, {
      netid: 'ag245',
      email: 'ari.fixture@yale.edu',
    });
    const bio = obs.find((o) => o.field === 'bio');
    const researchInterests = obs.find((o) => o.field === 'researchInterests');

    expect(bio).toBeUndefined();
    expect(researchInterests?.value).toEqual(
      expect.arrayContaining(['Sparse and Compressive Sensing Techniques']),
    );
  });

  it('does not derive a user bio from official interests when the profile bio is page chrome', () => {
    const identity = extractOfficialProfileIdentity(
      profileWithChromeInsteadOfBioHtml,
      'https://engineering.yale.edu/research-and-faculty/faculty-directory/ash-fixture/',
      {
        name: 'Ash Fixture Research',
        slug: 'faculty-research-area-ash-fixture',
      },
    );

    const obs = identityToUserObservations(identity!, {
      netid: 'ak2579',
      email: 'ash.fixture@yale.edu',
    });
    const bio = obs.find((o) => o.field === 'bio');
    const researchInterests = obs.find((o) => o.field === 'researchInterests');

    expect(bio).toBeUndefined();
    expect(researchInterests?.value).toEqual(
      expect.arrayContaining(['Cloud Computing and Resource Management']),
    );
  });

  it('does not emit credential-only education blocks as official profile bios', () => {
    const identity = extractOfficialProfileIdentity(
      profileWithCredentialsOnlyBioHtml,
      'https://english.yale.edu/people/kai-fixture/',
      {
        name: 'Kai Fixture Research',
        slug: 'faculty-research-area-kai-fixture',
      },
    );

    const obs = identityToUserObservations(identity!, {
      netid: 'ks555',
      email: 'kai.fixture@yale.edu',
    });
    const bio = obs.find((o) => o.field === 'bio');

    expect(bio).toBeUndefined();
  });

  it('does not derive a user bio from official interests when the profile bio is publication-list text', () => {
    const identity = extractOfficialProfileIdentity(
      profileWithPublicationListBioHtml,
      'https://engineering.yale.edu/research-and-faculty/faculty-directory/lee-fixture/',
      {
        name: 'Lee Fixture Research',
        slug: 'faculty-research-area-lee-fixture',
      },
    );

    const obs = identityToUserObservations(identity!, {
      netid: 'lw376',
      email: 'lee.fixture@yale.edu',
    });
    const bio = obs.find((o) => o.field === 'bio');
    const researchInterests = obs.find((o) => o.field === 'researchInterests');

    expect(bio).toBeUndefined();
    expect(researchInterests?.value).toEqual(expect.arrayContaining(['Sustainable chemical separations']));
  });

  it('does not derive a user bio from official interests when the profile bio is single-citation text', () => {
    const identity = extractOfficialProfileIdentity(
      profileWithSingleCitationBioHtml,
      'https://engineering.yale.edu/research-and-faculty/faculty-directory/lee-fixture/',
      {
        name: 'Lee Fixture Research',
        slug: 'faculty-research-area-lee-fixture',
      },
    );

    const obs = identityToUserObservations(identity!, {
      netid: 'lw376',
      email: 'lee.fixture@yale.edu',
    });
    const bio = obs.find((o) => o.field === 'bio');
    const researchInterests = obs.find((o) => o.field === 'researchInterests');

    expect(bio).toBeUndefined();
    expect(researchInterests?.value).toEqual(expect.arrayContaining(['Sustainable chemical separations']));
  });

  it('does not emit long appointment-only official profile blocks as bios', () => {
    const identity = extractOfficialProfileIdentity(
      profileWithLongAppointmentOnlyBioHtml,
      'https://ysph.yale.edu/profile/jesse-fixture/',
      {
        name: 'Jesse Fixture Research',
        slug: 'faculty-research-area-jesse-fixture',
      },
    );

    const obs = identityToUserObservations(identity!, {
      netid: 'jls289',
      email: 'jesse.fixture@yale.edu',
    });
    const bio = obs.find((o) => o.field === 'bio');

    expect(bio).toBeUndefined();
  });

  it('does not derive a user bio from official interests when the profile bio is grant metadata', () => {
    const identity = extractOfficialProfileIdentity(
      profileWithGrantProjectBioHtml,
      'https://medicine.yale.edu/profile/morgan-fixture/',
      {
        name: 'Morgan Fixture Lab',
        slug: 'lab-morgan-fixture',
      },
    );

    const obs = identityToUserObservations(identity!, {
      netid: 'mhn2',
      email: 'morgan.fixture@yale.edu',
    });
    const bio = obs.find((o) => o.field === 'bio');
    const researchInterests = obs.find((o) => o.field === 'researchInterests');

    expect(bio).toBeUndefined();
    expect(researchInterests?.value).toEqual(expect.arrayContaining(['Calcium signaling']));
  });

  it('does not emit Yale Medicine clinical-profile call-to-action text as a bio', () => {
    const identity = extractOfficialProfileIdentity(
      profileWithClinicalProfileChromeBioHtml,
      'https://medicine.yale.edu/profile/sam-fixture/',
      {
        name: 'Sam Fixture Lab',
        slug: 'sam-fixture-lab',
      },
    );

    const obs = identityToUserObservations(identity!, {
      netid: 'sg448',
      email: 'sam.fixture@yale.edu',
    });
    const bio = obs.find((o) => o.field === 'bio');

    expect(bio).toBeUndefined();
  });

  it('does not emit generic voluntary faculty boilerplate as a bio', () => {
    const identity = extractOfficialProfileIdentity(
      profileHtml
        .replace(
          /Jules Fixture studies translational cancer biology and develops clinical research\s+programs for gastrointestinal oncology\./,
          'Voluntary faculty are typically clinicians or others who are employed outside of the School but make significant contributions to department programs at the medical center or at affiliate institutions.',
        )
        .replace(
          '<div class="research-interests">Cancer biology; Translational oncology</div>',
          '',
        ),
      profileUrl,
      {
        name: 'Jules Fixture Research Area',
        slug: 'jules-fixture',
      },
    );

    const obs = identityToUserObservations(identity!, {
      netid: 'fixture106',
      email: 'jules.fixture@yale.edu',
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
          displayName: 'Jules Fixture',
          email: 'jules.fixture@yale.edu',
          title: 'Assistant Professor of Medicine',
          departments: [],
          bio,
          researchInterests: [],
        },
        { netid: 'fixture106', email: 'jules.fixture@yale.edu' },
      );

      expect(obs.find((o) => o.field === 'bio')).toBeUndefined();
    }
  });

  it('does not emit official profile bios that include Google Scholar callouts', () => {
    const obs = identityToUserObservations(
      {
        canonicalUrl: profileUrl,
        fetchedUrl: profileUrl,
        displayName: 'Jules Fixture',
        email: 'jules.fixture@yale.edu',
        title: 'Assistant Professor of Medicine',
        departments: [],
        bio:
          'Jules Fixture studies translational cancer biology and develops clinical research programs for gastrointestinal oncology. For more on this research, refer to Dr. Fixture complete Google Scholar profile.',
        researchInterests: [],
      },
      { netid: 'fixture106', email: 'jules.fixture@yale.edu' },
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
          displayName: 'Jules Fixture',
          email: 'jules.fixture@yale.edu',
          title: String(researchInterests[0]),
          departments: [],
          researchInterests,
        },
        { netid: 'fixture106', email: 'jules.fixture@yale.edu' },
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
        displayName: 'Jules Fixture',
        email: 'jules.fixture@yale.edu',
        title: 'Professor of Surgery (Oncology)',
        departments: [],
        bio: 'Jules Fixture studies cancer biology and translational oncology, with a focus on identifying biomarkers and improving treatment strategies for patients with gastrointestinal malignancies.',
        imageUrl: 'https://ysm-res.cloudinary.com/image/upload/example/jules-fixture',
        researchInterests: ['Cancer biology', 'Translational oncology'],
        orcid: '0000-0001-2345-6789',
      },
      { netid: 'fixture106', email: 'jules.fixture@yale.edu' },
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
    expect(obs.every((o) => o.entityKey === 'netid:fixture106')).toBe(true);
  });

  it('strips inline email parentheticals before emitting official profile bios', () => {
    const obs = identityToUserObservations(
      {
        canonicalUrl: 'https://medicine.yale.edu/profile/xylo-fixture/',
        fetchedUrl: 'https://medicine.yale.edu/profile/xylo-fixture/',
        displayName: 'Xylo Fixture',
        email: 'xylo.fixture@yale.edu',
        title: 'Assistant Professor of Radiology and Biomedical Imaging',
        departments: [],
        bio:
          'Xiaofeng joined Yale in 03/2024 as an Assistant Professor (forward related email to: liuxiaof@broadinstitute.org). His research interests are centered around medical imaging, machine learning, and cancer detection.',
        researchInterests: ['medical imaging', 'machine learning', 'cancer detection'],
      },
      {
        netid: 'xl693',
        email: 'xylo.fixture@yale.edu',
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
        canonicalUrl: 'https://medicine.yale.edu/profile/riley-metabolic/',
        fetchedUrl: 'https://medicine.yale.edu/profile/riley-metabolic/',
        displayName: 'Riley Metabolic',
        email: 'riley.metabolic@yale.edu',
        title: 'Professor of Cellular and Molecular Physiology',
        departments: [],
        bio:
          'Riley Metabolic, Ph.D. Professor Email: riley.metabolic@yale.eduPhone: 737-1216 Dr. Riley Metabolic is a Tenure Professor in the Department of Cellular and Molecular Physiology. Her research focuses on mitochondria-endoplasmic reticulum interactions and metabolic regulation in the central nervous system.',
        researchInterests: ['mitochondria', 'metabolic regulation', 'central nervous system'],
      },
      {
        netid: 'sd69',
        email: 'riley.metabolic@yale.edu',
      },
    );
    const bio = String(obs.find((o) => o.field === 'bio')?.value || '');

    expect(bio).toMatch(/^Dr\. Riley Metabolic is/);
    expect(bio).toContain('metabolic regulation');
    expect(bio).not.toContain('Email:');
    expect(bio).not.toContain('737-1216');
    expect(bio).not.toContain('riley.metabolic@yale.edu');
  });

  it('does not expand a terse official research-interest fragment into a user bio', () => {
    const identity = extractOfficialProfileIdentity(
      profileWithTerseInterestBioHtml,
      'https://physics.yale.edu/people/avery-fixture/',
      {
        name: 'Avery Fixture Research',
        slug: 'faculty-research-area-avery-fixture',
      },
    );

    const obs = identityToUserObservations(identity!, {
      netid: 'an123',
      email: 'avery.fixture@yale.edu',
    });
    const bioObservation = obs.find((o) => o.field === 'bio');
    const researchInterests = obs.find((o) => o.field === 'researchInterests');

    expect(bioObservation).toBeUndefined();
    expect(researchInterests?.value).toEqual(expect.arrayContaining(['String theory']));
  });

  it('does not expand a clean terse official research topic into a user bio', () => {
    const identity = extractOfficialProfileIdentity(
      profileWithOnlyTerseResearchBioHtml,
      'https://physics.yale.edu/people/avery-fixture/',
      {
        name: 'Avery Fixture Research',
        slug: 'faculty-research-area-avery-fixture',
      },
    );

    const obs = identityToUserObservations(identity!, {
      netid: 'an123',
      email: 'avery.fixture@yale.edu',
    });
    const bioObservation = obs.find((o) => o.field === 'bio');

    expect(identity?.bio).toContain('string theory and supersymmetric field theory');
    expect(bioObservation).toBeUndefined();
  });

  it('does not expand single official research-interest terms into a user bio', () => {
    const obs = identityToUserObservations(
      {
        canonicalUrl: 'https://economics.yale.edu/people/kai-donovan/',
        fetchedUrl: 'https://economics.yale.edu/people/kai-donovan/',
        displayName: 'Kai Donovan',
        email: 'kai.donovan@yale.edu',
        title: '',
        departments: [],
        researchInterests: ['Fields of Interest Development Economics'],
      },
      {
        netid: 'kd123',
        email: 'kai.donovan@yale.edu',
      },
    );
    const bio = obs.find((o) => o.field === 'bio');
    const researchInterests = obs.find((o) => o.field === 'researchInterests');

    expect(bio).toBeUndefined();
    expect(researchInterests?.value).toEqual(expect.arrayContaining(['Development Economics']));
  });

  it('does not emit short topic fragments as visible profile bios', () => {
    const obs = identityToUserObservations(
      {
        canonicalUrl: 'https://sociology.yale.edu/profile/remy-fixture/',
        fetchedUrl: 'https://sociology.yale.edu/profile/remy-fixture/',
        displayName: 'Remy Fixture',
        email: 'remy.fixture@yale.edu',
        title: 'Assistant Professor of Sociology',
        departments: [],
        bio: 'The complex interaction between social and biological forces in shaping human behavior; sociogenomics; the sociology of culture.',
        researchInterests: [],
      },
      {
        netid: 'rs2852',
        email: 'remy.fixture@yale.edu',
      },
    );

    expect(obs.find((o) => o.field === 'bio')).toBeUndefined();
  });

  it('does not treat semicolon-delimited profile topic lists as narrative bios', () => {
    const listLikeBioHtml = `
      <html>
        <head>
          <link rel="canonical" href="https://sociology.yale.edu/profile/ari-sociology-fixture/" />
        </head>
        <body>
          <main>
            <h1>Ari Sociology Fixture</h1>
            <div class="title">Assistant Professor of Sociology</div>
            <a href="mailto:ari.sociology.fixture@yale.edu">ari.sociology.fixture@yale.edu</a>
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
      'https://sociology.yale.edu/profile/ari-sociology-fixture/',
      {
        name: 'Ari Sociology Fixture — Research',
        slug: 'ari-sociology-fixture-research',
      },
    );

    const obs = identityToUserObservations(identity!, {
      netid: 'ae533',
      email: 'ari.sociology.fixture@yale.edu',
    });

    expect(identity?.bio).toBeUndefined();
    expect(obs.find((o) => o.field === 'bio')).toBeUndefined();
  });

  it('skips Yale Medicine contact paragraphs and extracts the research overview as bio', () => {
    const identity = extractOfficialProfileIdentity(
      profileOverviewAfterContactHtml,
      'https://medicine.yale.edu/profile/sky-fixture/',
      {
        name: 'Sky Fixture Research Area',
        slug: 'faculty-research-area-sky-fixture',
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
        { name: 'Jules Fixture Research Area', slug: 'faculty-research-area-jules-fixture' },
      ),
    ).toBeNull();
  });

  it('emits user observations keyed by Yale netid and no research membership observations', () => {
    const identity = extractOfficialProfileIdentity(profileHtml, profileUrl, {
      name: 'Jules Fixture Research Area',
      slug: 'faculty-research-area-jules-fixture',
    });

    const obs = identityToUserObservations(identity!, { netid: 'fixture106', email: 'jules.fixture@yale.edu' });

    expect(obs.every((o) => o.entityType === 'user')).toBe(true);
    expect(obs.every((o) => o.entityKey === 'netid:fixture106')).toBe(true);
    expect(obs.map((o) => o.field)).toEqual(
      expect.arrayContaining(['netid', 'fname', 'lname', 'email', 'profileUrls', 'imageUrl']),
    );
    expect(obs.find((o) => o.field === 'profileUrls')?.value).toEqual({
      medicine: profileUrl,
      official: profileUrl,
    });
    expect(obs.find((o) => o.field === 'imageUrl')?.value).toBe(
      'https://ysm-res.cloudinary.com/image/upload/example/jules-fixture',
    );
  });

  it('emits research-entity description observations from official profile identity', () => {
    const identity = extractOfficialProfileIdentity(profileHtml, profileUrl, {
      _id: 'entity-1',
      name: 'Jules Fixture Research Area',
      slug: 'faculty-research-area-jules-fixture',
    });

    const obs = identityToResearchEntityDescriptionObservations(identity!, {
      _id: 'entity-1',
      name: 'Jules Fixture Research Area',
      slug: 'faculty-research-area-jules-fixture',
    });

    expect(obs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: 'researchEntity',
          entityId: 'entity-1',
          entityKey: 'faculty-research-area-jules-fixture',
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
    const lawProfileUrl = 'https://law.yale.edu/oakley-fixture/';
    const identity = extractOfficialProfileIdentity(
      `
        <html>
          <head><link rel="canonical" href="${lawProfileUrl}" /></head>
          <body>
            <main>
              <h1>Oakley Fixture</h1>
              <div class="title">Sterling Professor Emeritus of Law</div>
              <a href="mailto:oakley.fixture@yale.edu">oakley.fixture@yale.edu</a>
              <div class="field--name-body">
                <p>
                  Professor Fixture is the author of many articles and books on procedure, free speech,
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
        name: 'Oakley Fixture Research',
        slug: 'oakley-fixture',
      },
    );

    expect(identity?.bio).toContain('author of many articles and books');
    expect(identity?.bio).not.toContain('deviant institution');

    const obs = identityToResearchEntityDescriptionObservations(identity!, {
      _id: 'entity-law',
      name: 'Oakley Fixture Research',
      slug: 'oakley-fixture',
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
        canonicalUrl: 'https://politicalscience.yale.edu/people/peyton-fixture/',
        fetchedUrl: 'https://politicalscience.yale.edu/people/peyton-fixture/',
        displayName: 'Peyton Fixture',
        email: 'peyton.fixture@yale.edu',
        title: 'Professor of Political Science',
        departments: [],
        bio: 'Swenson is an acclaimed author of articles and books on comparative political economy and the history of medical and health care politics.',
        researchInterests: [],
      },
      {
        _id: 'entity-swenson',
        name: 'Peyton Fixture Research',
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
      name: 'Jules Fixture Research Area',
      slug: 'faculty-research-area-jules-fixture',
    });

    const obs = identityToResearchEntityPiObservations(
      identity!,
      { _id: '64f000000000000000000020', netid: 'fixture106', email: 'jules.fixture@yale.edu' },
      {
        _id: '64f000000000000000000010',
        name: 'Jules Fixture Research Area',
        slug: 'faculty-research-area-jules-fixture',
      },
    );

    expect(obs).toEqual([
      expect.objectContaining({
        entityType: 'researchEntity',
        entityId: '64f000000000000000000010',
        entityKey: 'faculty-research-area-jules-fixture',
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
      name: 'Jules Fixture Research Area',
      slug: 'faculty-research-area-jules-fixture',
    });

    const obs = identityToResearchEntityPiKeyObservations(identity!, 'jules.fixture', {
      _id: '64f000000000000000000010',
      name: 'Jules Fixture Research Area',
      slug: 'faculty-research-area-jules-fixture',
    });

    expect(obs).toEqual([
      expect.objectContaining({
        entityType: 'researchEntity',
        entityId: '64f000000000000000000010',
        entityKey: 'faculty-research-area-jules-fixture',
        field: 'inferredPiUserKey',
        value: 'jules.fixture',
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
        name: 'Jules Fixture Research Area',
        slug: 'faculty-research-area-jules-fixture',
      },
    );

    const obs = identityToUserObservations(identity!, { netid: 'fixture106', email: 'jules.fixture@yale.edu' });

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
          name: 'Jules Fixture Research Area',
          slug: 'faculty-research-area-jules-fixture',
          websiteUrl: 'https://medicine.yale.edu/cancer/profile/jules-fixture',
        },
      ]),
      vi.fn(async () => ({
        _id: '64f000000000000000000020',
        netid: 'fixture106',
        email: 'jules.fixture@yale.edu',
      })),
      vi.fn(async () => [
        {
          _id: 'entity-1',
          name: 'Jules Fixture Research Area',
          slug: 'faculty-research-area-jules-fixture',
          websiteUrl: 'https://medicine.yale.edu/cancer/profile/jules-fixture',
        },
      ]),
    );

    const result = await scraper.run(contextFor(emitted));

    expect(result).toMatchObject({ observationCount: emitted.length, entitiesObserved: 1 });
    expect(emitted.find((o) => o.field === 'email')?.value).toBe('jules.fixture@yale.edu');
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
        name: 'Jules Fixture Research Area',
        slug: 'faculty-research-area-jules-fixture',
        websiteUrl: 'https://medicine.yale.edu/cancer/profile/jules-fixture',
      },
    ]);
    const scraper = new OfficialProfilePiBackfillScraper(
      fetcher,
      entitySelector,
      vi.fn(async () => ({
        _id: '64f000000000000000000020',
        netid: 'fixture106',
        email: 'jules.fixture@yale.edu',
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
          name: 'Jules Fixture Research Area',
          slug: 'faculty-research-area-jules-fixture',
          websiteUrl: 'https://medicine.yale.edu/cancer/profile/jules-fixture',
        },
      ]),
      vi.fn(async () => null),
      vi.fn(async () => [
        {
          _id: 'entity-1',
          name: 'Jules Fixture Research Area',
          slug: 'faculty-research-area-jules-fixture',
          websiteUrl: 'https://medicine.yale.edu/cancer/profile/jules-fixture',
        },
      ]),
    );

    const result = await scraper.run(contextFor(emitted));

    expect(result).toMatchObject({ observationCount: emitted.length, entitiesObserved: 1 });
    expect(emitted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: 'user',
          entityKey: 'netid:jules.fixture',
          field: 'email',
          value: 'jules.fixture@yale.edu',
        }),
        expect.objectContaining({
          entityType: 'user',
          entityKey: 'netid:jules.fixture',
          field: 'profileUrls',
          value: {
            medicine: profileUrl,
            official: profileUrl,
          },
        }),
        expect.objectContaining({
          entityType: 'researchEntity',
          field: 'inferredPiUserKey',
          value: 'jules.fixture',
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
          name: 'Jules Fixture Research Area',
          slug: 'faculty-research-area-jules-fixture',
          websiteUrl: 'https://medicine.yale.edu/cancer/profile/jules-fixture',
        },
      ]),
      vi.fn(async () => ({
        _id: '64f000000000000000000020',
        netid: 'fixture106',
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
          email: 'harper.sanchez@yale.edu',
          fname: 'Harper',
          lname: 'Sanchez',
          profileUrls: {
            medicine: 'https://medicine.yale.edu/profile/harper-sanchez/',
          },
        },
        {
          _id: 'user-hayde',
          netid: 'hs272',
          email: 'hayden.sanchez@yale.edu',
          fname: 'Hayde',
          lname: 'Sanchez',
          profileUrls: {
            medicine: 'https://medicine.yale.edu/profile/harper-sanchez/',
          },
        },
      ]),
    } as any);

    const match = await resolveExistingUserForIdentity({
      canonicalUrl: 'https://medicine.yale.edu/profile/harper-sanchez/',
      fetchedUrl: 'https://medicine.yale.edu/profile/harper-sanchez/',
      displayName: 'Harper Sanchez',
      email: '',
      title: 'Assistant Professor',
      departments: [],
      researchInterests: [],
    });

    expect(match).toEqual({
      _id: 'user-harold',
      netid: 'hs7',
      email: 'harper.sanchez@yale.edu',
    });
  });

  it('runs targeted bio backfill for already linked visible professor profiles', async () => {
    const emitted: ObservationInput[] = [];
    const scraper = new OfficialProfilePiBackfillScraper(
      vi.fn(async () => profileHtml),
      vi.fn(async () => [
        {
          _id: 'entity-1',
          name: 'Jules Fixture Research Area',
          slug: 'faculty-research-area-jules-fixture',
          websiteUrl: 'https://medicine.yale.edu/cancer/profile/jules-fixture',
        },
      ]),
      vi.fn(async () => ({ netid: 'fixture106', email: 'jules.fixture@yale.edu' })),
      vi.fn(async () => [
        {
          _id: 'entity-1',
          name: 'Jules Fixture Research Area',
          slug: 'faculty-research-area-jules-fixture',
          websiteUrl: 'https://medicine.yale.edu/cancer/profile/jules-fixture',
        },
      ]),
    );

    const result = await scraper.run(visibleBioContextFor(emitted));

    expect(result).toMatchObject({ observationCount: emitted.length, entitiesObserved: 1 });
    expect(emitted.find((o) => o.field === 'bio')?.value).toContain(
      'studies translational cancer biology',
    );
    expect(emitted.every((o) => o.entityKey === 'netid:fixture106')).toBe(true);
  });

  it('runs queued official profile description backfill for source-description entities', async () => {
    const emitted: ObservationInput[] = [];
    const scraper = new OfficialProfilePiBackfillScraper(
      vi.fn(async () => profileHtml),
      vi.fn(async () => []),
      vi.fn(async () => ({
        _id: '64f000000000000000000020',
        netid: 'fixture106',
        email: 'jules.fixture@yale.edu',
      })),
      vi.fn(async () => []),
      vi.fn(async () => []),
      vi.fn(async () => [
        {
          _id: 'entity-1',
          name: 'Jules Fixture Research Area',
          slug: 'faculty-research-area-jules-fixture',
          sourceUrls: ['https://medicine.yale.edu/cancer/profile/jules-fixture'],
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
            'https://medicine.yale.edu/cancer/profile/jules-fixture',
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
        netid: 'fixture106',
        email: 'jules.fixture@yale.edu',
      })),
      vi.fn(async () => []),
      vi.fn(async () => []),
      vi.fn(async () => [
        {
          _id: 'entity-1',
          name: 'Jules Fixture Research Area',
          slug: 'faculty-research-area-jules-fixture',
          sourceUrls: ['https://medicine.yale.edu/cancer/profile/jules-fixture'],
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
        name: 'Jules Fixture Research Area',
        slug: 'faculty-research-area-jules-fixture',
        sourceUrls: ['https://medicine.yale.edu/cancer/profile/jules-fixture'],
      },
    ]);
    const scraper = new OfficialProfilePiBackfillScraper(
      vi.fn(async () => profileHtml),
      vi.fn(async () => []),
      vi.fn(async () => ({
        _id: '64f000000000000000000020',
        netid: 'fixture106',
        email: 'jules.fixture@yale.edu',
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
        only: ['profile-description-backfill', 'faculty-research-area-jules-fixture'],
      },
    });

    expect(result).toMatchObject({ observationCount: emitted.length, entitiesObserved: 1 });
    expect(profileDescriptionSelector).toHaveBeenCalledWith(25, [
      'faculty-research-area-jules-fixture',
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
        fname: 'Logan',
        lname: 'Fixture',
        email: 'logan.fixture@yale.edu',
      }),
    ).toEqual([
      'https://medicine.yale.edu/profile/logan-fixture/',
      'https://ysph.yale.edu/profile/logan-fixture/',
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
      '<a href="mailto:jules.fixture@yale.edu">jules.fixture@yale.edu</a>',
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
          name: 'Jules Fixture Research Area',
          slug: 'faculty-research-area-jules-fixture',
          sourceUrls: ['https://medicine.yale.edu/cancer/profile/jules-fixture'],
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
      '<a href="mailto:jules.fixture@yale.edu">jules.fixture@yale.edu</a>',
      '<span>contact unavailable</span>',
    );
    const scraper = new OfficialProfilePiBackfillScraper(
      vi.fn(async () => noEmailProfileHtml),
      vi.fn(async () => []),
      vi.fn(async () => null),
      vi.fn(async () => [
        {
          _id: 'user-1',
          netid: 'fixture106',
          email: 'jules.fixture@yale.edu',
          name: 'Jules Fixture',
          slug: 'jules-fixture',
          websiteUrl: 'https://medicine.yale.edu/cancer/profile/jules-fixture',
        },
      ]),
    );

    const result = await scraper.run(visibleBioContextFor(emitted));

    expect(result).toMatchObject({ observationCount: emitted.length, entitiesObserved: 1 });
    expect(emitted.find((o) => o.field === 'bio')?.value).toContain(
      'studies translational cancer biology',
    );
    expect(emitted.every((o) => o.entityKey === 'netid:fixture106')).toBe(true);
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
          email: 'drew.fixture@yale.edu',
          fname: 'Drew',
          lname: 'Fixture',
          name: 'Drew Fixture',
          slug: 'drew-fixture',
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
    const facultyPageUrl = 'https://economics.yale.edu/faculty/drew-fixture/';
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
          email: 'drew.fixture@yale.edu',
          fname: 'Drew',
          lname: 'Fixture',
          name: 'Drew Fixture',
          slug: 'drew-fixture',
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
    const oldSociologyUrl = 'https://sociology.yale.edu/people/drew-fixture';
    const currentSociologyUrl = 'https://sociology.yale.edu/profile/drew-fixture/';
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
          email: 'drew.fixture@yale.edu',
          fname: 'Drew',
          lname: 'Fixture',
          name: 'Drew Fixture',
          slug: 'drew-fixture',
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
    const homeProfileUrl = 'https://medicine.yale.edu/cancer/profile/sage-aitken/';
    const canonicalHomeProfileUrl = 'https://medicine.yale.edu/profile/sage-aitken/';
    const homeProfileHtml = profileHtml
      .replace(new RegExp(profileUrl, 'g'), homeProfileUrl)
      .replace(/Jules Fixture/g, 'Sage Aitken')
      .replace(/Jules Fixture/g, 'Sage Aitken')
      .replace(/jules\.fixture@yale\.edu/g, 'sage.aitken@yale.edu')
      .replace(/Professor of Surgery \(Oncology\)/g, 'Assistant Professor of Medicine')
      .replace(
        /Sage Aitken studies translational cancer biology and develops clinical research\s+programs for gastrointestinal oncology\./,
        'Sage Aitken studies cancer outcomes, clinical epidemiology, and interventions that improve care delivery for patients with gastrointestinal malignancies.',
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
          email: 'sage.aitken@yale.edu',
          fname: 'Sage',
          lname: 'Aitken',
          name: 'Sage Aitken',
          slug: 'sage-aitken',
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
      'Sage Aitken studies cancer outcomes',
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
          email: 'zuri.fixture@yale.edu',
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
          _id: 'user-sky-lee',
          netid: 'sl3248',
          email: 'sky.lee@yale.edu',
          fname: 'Sky',
          lname: 'Lee',
          userType: 'faculty',
          bio: '',
          profileUrls: {
            departmental: 'https://politicalscience.yale.edu/people/sky-lee/',
          },
        },
      ]),
    } as any);

    const targets = await selectVisibleProfileBioTargets(10);

    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({
      netid: 'sl3248',
      leadProfileUrls: ['https://politicalscience.yale.edu/people/sky-lee/'],
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
          email: 'morgan.taylor@yale.edu',
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
          email: 'nico.brown@yale.edu',
          fname: 'Nancy',
          lname: 'Brown',
          name: 'Nico Brown',
          slug: 'nico-brown',
          websiteUrl: 'https://nelc.yale.edu/people/nicholas-brown/',
        },
        {
          _id: 'user-5',
          netid: 'ab123',
          email: 'ari.brown@yale.edu',
          fname: 'Ann',
          lname: 'Brown',
          name: 'Ari Brown',
          slug: 'ari-brown',
          websiteUrl: 'https://history.yale.edu/people/jordan-history-fixture/',
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
    const staleMedicineUrl = 'https://medicine.yale.edu/profile/different-fixture/';
    const htmlFetcher = vi.fn(async (url: string) => {
      if (url === staleMedicineUrl) {
        return departmentPersonPageHtml
          .replace(/Drew Fixture/g, 'Different Angluin')
          .replace(/drew\.fixture@yale\.edu/g, 'different.fixture@yale.edu');
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
          email: 'drew.fixture@yale.edu',
          fname: 'Drew',
          lname: 'Fixture',
          name: 'Drew Fixture',
          slug: 'drew-fixture',
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
    const staleMedicineUrl = 'https://medicine.yale.edu/profile/drew-fixture/';
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
          email: 'drew.fixture@yale.edu',
          fname: 'Drew',
          lname: 'Fixture',
          name: 'Drew Fixture',
          slug: 'drew-fixture',
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
      url.includes('second-fixture')
        ? profileHtml
            .replace(/Jules Fixture/g, 'Second Person')
            .replace(/jules\.fixture@yale\.edu/g, 'second.fixture@yale.edu')
            .replace(/jules-fixture/g, 'second-fixture')
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
          netid: 'fixture106',
          email: 'jules.fixture@yale.edu',
          name: 'Jules Fixture',
          slug: 'jules-fixture',
          websiteUrl: 'https://medicine.yale.edu/profile/jules-fixture/',
        },
        {
          _id: 'user-2',
          netid: 'sp123',
          email: 'second.fixture@yale.edu',
          name: 'Second Person',
          slug: 'second-fixture',
          websiteUrl: 'https://medicine.yale.edu/profile/second-fixture/',
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
          name: 'Cameron Profile Research',
          slug: 'faculty-research-area-cameron-profile',
          websiteUrl: 'https://medicine.yale.edu/profile/cameron-profile/',
        },
      ]),
      vi.fn(async () => ({
        netid: 'chj9',
        email: 'cameron.profile@yale.edu',
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
      'https://medicine.yale.edu/profile/taylor-profile/',
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
      'https://medicine.yale.edu/profile/taylor-profile/',
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
          .replace(/Taylor Sinusas/g, 'Taylor Simon')
          .replace(/taylor\.profile@yale\.edu/g, 'taylor.simulation@yale.edu')
          .replace(/\/profile\/taylor-profile\//g, '/profile/taylor-simulation/'),
      ),
      vi.fn(async () => []),
      vi.fn(async () => null),
      vi.fn(async () => []),
      vi.fn(async () => [
        {
          _id: 'entity-1',
          name: 'Sinusas Lab',
          slug: 'sinusas-lab-as123',
          sourceUrls: ['https://medicine.yale.edu/profile/taylor-simulation/'],
          leadUserProfileUrls: ['https://medicine.yale.edu/profile/taylor-simulation/'],
          leadUsers: [{ fname: 'Taylor', lname: 'Sinusas', email: 'taylor.profile@yale.edu' }],
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
      'https://medicine.yale.edu/profile/jules-audio-fixture/',
    );

    expect(homes).toEqual([]);
  });

  it('does not promote research-center affiliations without leadership evidence', () => {
    const homes = extractOfficialProfileResearchHomes(
      researchCenterAffiliationWithoutLeadershipHtml,
      'https://medicine.yale.edu/profile/riley-nutrition-fixture/',
    );

    expect(homes).toEqual([]);
  });

  it('does not treat a broad center as led when it is only the prefix of a program title', () => {
    const homes = extractOfficialProfileResearchHomes(
      centerPrefixProgramTitleHtml,
      'https://medicine.yale.edu/profile/wren-fixture/',
    );

    expect(homes).toEqual([]);
  });

  it('does not promote broad institutional centers as individual lab replacements', () => {
    const homes = extractOfficialProfileResearchHomes(
      broadChildStudyCenterLeadershipHtml,
      'https://medicine.yale.edu/profile/lane-fixture/',
    );

    expect(homes).toEqual([]);
  });

  it('does not treat associate director of a subarea as director of the parent institute', () => {
    const homes = extractOfficialProfileResearchHomes(
      associateDirectorSubareaProfileHtml,
      'https://medicine.yale.edu/profile/xen-fixture/',
    );

    expect(homes).toEqual([]);
  });

  it('accepts direct leadership when profile text prefixes a short affiliation with Yale', () => {
    const homes = extractOfficialProfileResearchHomes(
      yalePrefixedLeadershipProfileHtml,
      'https://medicine.yale.edu/profile/morgan-fixture/',
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
      'https://medicine.yale.edu/profile/devon-fixture/',
    );

    expect(homes).toEqual([]);
  });

  it('uses the canonical center name for profile cards that include a PI lab prefix', () => {
    const homes = extractOfficialProfileResearchHomes(
      profileLinkedWaxmanCenterWebsiteHtml,
      'https://medicine.yale.edu/profile/sawyer-fixture/',
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
      'https://medicine.yale.edu/profile/casey-fixture/',
    );

    expect(homes).toEqual([]);
  });

  it('does not promote student leadership programs as research-home replacements', () => {
    const homes = extractOfficialProfileResearchHomes(
      profileLinkedLeadershipProgramWebsiteHtml,
      'https://politicalscience.yale.edu/people/jordan-policy-fixture/',
    );

    expect(homes).toEqual([]);
  });

  it('does not promote academic programs as lab website replacements', () => {
    const homes = extractOfficialProfileResearchHomes(
      profileLinkedAcademicProgramWebsiteHtml,
      'https://history.yale.edu/people/parker-history-fixture/',
    );

    expect(homes).toEqual([]);
  });

  it('does not promote diagnostic service pages as research homes', () => {
    const homes = extractOfficialProfileResearchHomes(
      profileLinkedDiagnosticServiceWebsiteHtml,
      'https://medicine.yale.edu/profile/alex-diagnostics-fixture/',
    );

    expect(homes).toEqual([]);
  });

  it('does not promote broad department research directories as specific lab homes', () => {
    const homes = extractOfficialProfileResearchHomes(
      profileLinkedBroadChildStudyResearchWebsiteHtml,
      'https://medicine.yale.edu/profile/sasha-modeler-fixture/',
    );

    expect(homes).toEqual([]);
  });

  it('does not promote Google Sites profile-card links as official lab homes', () => {
    const homes = extractOfficialProfileResearchHomes(
      profileLinkedGoogleSiteLabWebsiteHtml,
      'https://medicine.yale.edu/profile/remy-neuro-fixture/',
    );

    expect(homes).toEqual([]);
  });

  it('does not promote medical education programs as lab website replacements', () => {
    const homes = extractOfficialProfileResearchHomes(
      profileLinkedEducationProgramWebsiteHtml,
      'https://medicine.yale.edu/profile/morgan-global-fixture/',
    );

    expect(homes).toEqual([]);
  });

  it('does not promote broad departments as lab website replacements', () => {
    const homes = extractOfficialProfileResearchHomes(
      profileLinkedBroadDepartmentWebsiteHtml,
      'https://medicine.yale.edu/profile/kai-informatics-fixture/',
    );

    expect(homes).toEqual([]);
  });

  it('does not promote Yale Medicine clinical program pages as research homes', () => {
    const homes = extractOfficialProfileResearchHomes(
      profileLinkedClinicalProgramWebsiteHtml,
      'https://medicine.yale.edu/profile/devon-orthopedics-fixture/',
    );

    expect(homes).toEqual([]);
  });

  it('does not promote known stale Yale Medicine research pages as profile-linked homes', () => {
    const homes = extractOfficialProfileResearchHomes(
      profileLinkedStaleResearchWebsiteHtml,
      'https://medicine.yale.edu/profile/avery-finance-fixture/',
    );

    expect(homes).toEqual([]);
  });

  it('does not promote known stale or placeholder external lab shells', () => {
    const homes = extractOfficialProfileResearchHomes(
      profileLinkedStaleExternalWebsiteHtml,
      'https://medicine.yale.edu/profile/blair-development-fixture/',
    );

    expect(homes).toEqual([]);
  });

  it('does not promote thin external JavaScript shells as research homes', () => {
    const homes = extractOfficialProfileResearchHomes(
      profileLinkedThinExternalWebsiteHtml,
      'https://medicine.yale.edu/profile/ellis-schoolhealth-fixture/',
    );

    expect(homes).toEqual([]);
  });

  it('canonicalizes the MRRC hostname alias to the current Magnetic Resonance Core URL', () => {
    const homes = extractOfficialProfileResearchHomes(
      profileLinkedMrrcAliasWebsiteHtml,
      'https://medicine.yale.edu/profile/drew-imaging-fixture/',
    );

    expect(homes[0]).toMatchObject({
      name: 'Magnetic Resonance Research Center',
      url: 'https://medicine.yale.edu/biomedical-imaging-institute/core-facilities/mr-core/',
    });
  });

  it('does not promote unreachable external collaboratory websites', () => {
    const homes = extractOfficialProfileResearchHomes(
      profileLinkedPainCollaboratoryWebsiteHtml,
      'https://medicine.yale.edu/profile/robin-pain-fixture/',
    );

    expect(homes).toEqual([]);
  });

  it('cleans overlong Y-Weight profile-card labels to the center name', () => {
    const homes = extractOfficialProfileResearchHomes(
      profileLinkedYWeightWebsiteHtml,
      'https://medicine.yale.edu/profile/ari-obesity-fixture/',
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
      'https://medicine.yale.edu/profile/cameron-neonatal-fixture/',
    );

    expect(homes[0]).toMatchObject({
      name: 'Yale Neonatal NOURISH Team',
      url: 'https://medicine.yale.edu/pediatrics/perinatal/research/nourish_program/',
    });
  });

  it('preserves CarDS acronym casing in profile-linked lab labels', () => {
    const homes = extractOfficialProfileResearchHomes(
      profileLinkedCardsLabWebsiteHtml,
      'https://medicine.yale.edu/profile/rory-cards-fixture/',
    );

    expect(homes[0]).toMatchObject({
      name: 'CarDS Lab',
      url: 'https://www.cards-lab.org/',
    });
  });

  it('does not promote person profile pages as lab website replacements', () => {
    const homes = extractOfficialProfileResearchHomes(
      profileLinkedPersonPageWebsiteHtml,
      'https://medicine.yale.edu/profile/logan-channels-fixture/',
    );

    expect(homes).toEqual([]);
  });

  it('prioritizes an explicit profile-linked lab website over a broader center affiliation', () => {
    const homes = extractOfficialProfileResearchHomes(
      profileLinkedExternalLabWebsiteHtml,
      'https://medicine.yale.edu/profile/hayden-fixture/',
    );

    expect(homes[0]).toMatchObject({
      name: 'Hayden Fixture Lab',
      url: 'https://www.haifanlinlab.org/',
      kind: 'lab',
      entityType: 'LAB',
    });
  });

  it('uses the profile card label for explicit lab website links instead of inventing a PI lab name', () => {
    const homes = extractOfficialProfileResearchHomes(
      profileLinkedNamedLabWebsiteHtml,
      'https://medicine.yale.edu/profile/morgan-cell-fixture/',
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
      'https://medicine.yale.edu/profile/mika-neurofeedback-fixture/',
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
      'https://medicine.yale.edu/profile/xen-fixture/',
    );

    expect(homes[0]).toMatchObject({
      name: 'BioImage Suite Project',
      url: 'https://bioimagesuiteweb.github.io/webapp/',
      kind: 'lab',
      entityType: 'LAB',
    });
  });

  it('extracts a synthetic squirrel-lab profile-card label', () => {
    const homes = extractOfficialProfileResearchHomes(
      profileLinkedSquirrelLabWebsiteHtml,
      'https://medicine.yale.edu/profile/emery-fixture/',
    );

    expect(homes[0]).toMatchObject({
      name: 'Emery Lab',
      kind: 'lab',
      entityType: 'LAB',
    });
  });

  it('extracts a synthetic Sloan-lab profile-card label', () => {
    const homes = extractOfficialProfileResearchHomes(
      profileLinkedSlavLabWebsiteHtml,
      'https://medicine.yale.edu/profile/sviatosloan-fixture/',
    );

    expect(homes[0]).toMatchObject({
      name: 'The Sloan Lab',
      kind: 'lab',
      entityType: 'LAB',
    });
  });

  it('expands YCSC profile-card shorthand in explicit lab website labels', () => {
    const homes = extractOfficialProfileResearchHomes(
      profileLinkedYcscLabWebsiteHtml,
      'https://medicine.yale.edu/profile/wynn-fixture/',
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
      'https://medicine.yale.edu/profile/lane-fixture/',
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
      'https://medicine.yale.edu/profile/carter-fixture/',
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
      'https://medicine.yale.edu/profile/avery-tan/',
    );

    expect(homes).toEqual([]);
  });

  it('does not promote outside-Yale deputy director text when profile sections collapse together', () => {
    const homes = extractOfficialProfileResearchHomes(
      outsideYaleNoSeparatorDeputyProfileHtml,
      'https://medicine.yale.edu/profile/avery-tan/',
    );

    expect(homes).toEqual([]);
  });

  it('emits same-entity research home observations that can replace NIH PI fallback identity', () => {
    const [home] = extractOfficialProfileResearchHomes(
      sinusasProfileHtml,
      'https://medicine.yale.edu/profile/taylor-profile/',
    );

    const obs = entityResearchHomeToObservations(
      {
        _id: '6a057df913fc60d57ec2a571',
        slug: 'nih-pi-taylor-profile',
        name: 'Taylor Sinusas Lab',
        sourceUrls: ['https://reporter.nih.gov/project-details/11168153'],
      },
      home,
      'https://medicine.yale.edu/profile/taylor-profile/',
    );

    expect(obs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: 'researchEntity',
          entityId: '6a057df913fc60d57ec2a571',
          entityKey: 'nih-pi-taylor-profile',
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
            'https://medicine.yale.edu/profile/taylor-profile/',
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
          name: 'Cameron Profile Research',
          slug: 'faculty-research-area-cameron-profile',
          websiteUrl: 'https://medicine.yale.edu/profile/cameron-profile/',
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
          entityKey: 'netid:cameron.profile',
          field: 'email',
          value: 'cameron.profile@yale.edu',
        }),
        expect.objectContaining({
          entityType: 'researchEntity',
          entityKey: 'faculty-research-area-cameron-profile',
          field: 'inferredPiUserKey',
          value: 'cameron.profile',
        }),
      ]),
    );
  });
});
