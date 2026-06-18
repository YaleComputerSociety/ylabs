import { describe, expect, it } from 'vitest';

import {
  deriveShortDescriptionFromFullDescription,
  fullDescriptionQuality,
  shortDescriptionQuality,
} from '../researchEntityDescriptionQuality';

describe('fullDescriptionQuality', () => {
  it('keeps official lab overview copy that starts with a welcome sentence', () => {
    const quality = fullDescriptionQuality(
      'Welcome to the Developmental Electrophysiology Laboratory (DEL), a core research resource in the Yale Child Study Center and the Yale School of Medicine. The DEL is equipped to study brain electrical responses and peripheral psychophysiological indices of cognition, emotion, and arousal.',
    );

    expect(quality.flags).not.toContain('recruitment-boilerplate');
    expect(quality.isUseful).toBe(true);
  });

  it('rejects homepage and recruitment welcome boilerplate', () => {
    const quality = fullDescriptionQuality(
      'Welcome to the Smith Lab website. Thank you for your interest in our lab.',
    );

    expect(quality.flags).toContain('recruitment-boilerplate');
    expect(quality.isUseful).toBe(false);
  });

  it('derives card copy from numbered active areas of research instead of copying the first long sentence', () => {
    const fullDescription =
      'Active areas of research 1- Bone marrow Stem Cell niches All blood cells develop from hematopoietic stem cells through complex developmental transitions. 2- Where and how B cell development occurs in vivo. 3- Chemoattractants, receptors, and B cell homeostasis.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);

    expect(shortDescription).toBe(
      'Studies Bone marrow Stem Cell niches, Where and how B cell development occurs in vivo, and Chemoattractants, receptors, and B cell homeostasis.',
    );
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('accepts specific research-area series as source-backed cardable descriptions', () => {
    const fullDescription =
      'Research areas include Spectroscopy and Quantum Chemical Studies, Molecular spectroscopy and chirality, and Receptor Mechanisms and Signaling.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);

    expect(fullDescriptionQuality(fullDescription).flags).not.toContain('research-area-placeholder');
    expect(fullDescriptionQuality(fullDescription).isUseful).toBe(true);
    expect(shortDescription).toBe(fullDescription);
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('still rejects generic research-area placeholders without a specific series', () => {
    const fullDescription = 'Research areas include biology.';

    expect(fullDescriptionQuality(fullDescription).flags).toContain('research-area-placeholder');
    expect(fullDescriptionQuality(fullDescription).isUseful).toBe(false);
    expect(deriveShortDescriptionFromFullDescription(fullDescription)).toBe('');
  });

  it('derives card copy from later research activity when profile biographies start with appointments', () => {
    const fullDescription =
      'Dr Roberts has worked at the University of Vermont, Virginia Commonwealth University, and Yale University. He is board certified in internal medicine, pediatrics, medical oncology, and hospice and palliative care. Current activities are clinical research and consulting for non-governmental organizations and the pharmaceutical and pharmacy industries.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);

    expect(shortDescription).toBe(
      'Conducts clinical research and consulting for non-governmental organizations and the pharmaceutical and pharmacy industries.',
    );
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('derives card copy from later research interests when biographies start with appointments', () => {
    const fullDescription =
      'Stephen Darwall is the Andrew Downey Orrick Professor of Philosophy at Yale University and the John Dewey Distinguished University Professor Emeritus at the University of Michigan. He has taught in the Department of Philosophy at Yale University. His research interests include moral philosophy, particularly in the areas of second-fixtureal ethics, moral reasoning, and the relationship between morality and authority.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);

    expect(fullDescriptionQuality(fullDescription).flags).not.toContain('appointment-only');
    expect(shortDescription).toBe(
      'Studies moral philosophy, particularly in the areas of second-fixtureal ethics, moral reasoning, and the relationship between morality and authority.',
    );
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('derives third-person card copy from first-person humanities profile research statements', () => {
    const fullDescription =
      'In my work, I study practices, genres, and institutions of literature from early modernity to the modern and contemporary. The underlying assumption is that literature is not a given but undergoes changes historically and manifests in a plurality of forms culturally. My present work explores the practices, genres, and institutions of literature in broader, theoretical ways.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);

    expect(shortDescription).toBe(
      'Studies practices, genres, and institutions of literature from early modernity to the modern and contemporary.',
    );
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('derives card copy from first-person research-and-teaching focus statements', () => {
    const fullDescription =
      'My research and teaching focus on eighteenth-century literature and philosophy, the foundations of literary theory and criticism, and interdisciplinary approaches to the arts. My most recent book defends the epistemology of close reading at the heart of contemporary criticism. I continue to write on form and method.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);

    expect(shortDescription).toBe(
      'Studies eighteenth-century literature and philosophy, the foundations of literary theory and criticism, and interdisciplinary approaches to the arts.',
    );
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('derives card copy from third-person teaching-and-research focus statements', () => {
    const fullDescription =
      'Matthew Frye Jacobson is Sterling Professor of American Studies and History. He is the author of eight books on race, politics, and culture in the United States. His teaching and research focus on race in U.S. political culture 1790-present, including U.S. imperialism, immigration and migration, popular culture, Civil Rights, and the juridical structures of U.S. citizenship.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);

    expect(shortDescription).toBe(
      'Studies race in U.S. political culture 1790-present, including U.S. imperialism, immigration and migration, popular culture, Civil Rights, and the juridical structures of U.S. citizenship.',
    );
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('derives card copy from current book-project exploration statements', () => {
    const fullDescription =
      'Elise R. Morrison, Ph.D. is an Assistant Professor of Theater, Dance, and Performance Studies at Yale. Her current book project, Post-Dramatic Stress: Theater and Therapy After War, explores how technologies of 21st century war, from drones to first person shooter video games to virtual therapies developed to treat post-traumatic stress disorder, perform in and across socio-political, therapeutic and theatrical arenas. Morrison has also devised intermedia cabaret performances that focus on gender, surveillance, and mediatized culture.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);

    expect(shortDescription).toBe(
      'Explores how technologies of 21st century war perform in socio-political, therapeutic and theatrical arenas.',
    );
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('derives card copy from research-centers-on-investigating profile prose', () => {
    const fullDescription =
      'Biographical Sketch: Henrich’s research in the Surface Science Laboratory centers on investigating a variety of properties of solid surfaces, the interaction of surfaces with absorbed atoms and molecules, interfaces between solids, and the properties of complex oxides. The Laboratory is equipped with a multiple-chamber oxide MBE growth and analysis facility.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);

    expect(shortDescription).toBe(
      'Studies solid surfaces, surface interactions with absorbed atoms and molecules, solid interfaces, and complex oxides.',
    );
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('derives card copy from writes-and-teaches scholarly tradition prose', () => {
    const fullDescription =
      'Critical Theory, History of Philosophy, German literatures, Latin American literature and thought, Psychoanalysis, Franz Kafka, Walter Benjamin, Karl Marx Bio Paul North writes and teaches in the tradition of critical theory, emphasizing Jewish thought, emancipatory strains in the history of philosophy, and European literatures. He has written books on the concept of distraction, on Franz Kafka, and on likeness in culture and thought.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);

    expect(shortDescription).toBe('Studies critical theory, Jewish thought, philosophy, and European literatures.');
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('derives card copy from singular later research-interest phrasing', () => {
    const fullDescription =
      'Prof. Michael A. Boozer graduated from MIT with a bachelor’s degree in Physics before starting graduate school at Princeton where he obtained his PhD in Economics. His research interest is in Education and Labour policy where he studied consequences of class size on student achievement, looked at the relationship between human development and economic growth and the link between school quality and race.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);

    expect(shortDescription).toBe('Studies Education and Labour policy.');
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('derives card copy from later focused-research sentences after appointment front matter', () => {
    const fullDescription =
      'Dr. Jones is a Yale-trained cancer epidemiologist whose work and teaching focus is on health disparities. Her research is primarily focused on racial/ethnic differences in cancer screening, prevention, and cancer outcomes. A recently completed study tested evidence-based interventions to address overdue colorectal cancer screening in a large urban primary care clinic.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);

    expect(shortDescription).toBe(
      'Studies racial/ethnic differences in cancer screening, prevention, and cancer outcomes.',
    );
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('derives card copy from creative-work research focus sentences', () => {
    const fullDescription =
      'Dr. Scott Petersen is a composer, performer, electronic musician and laptop improviser. His current creative work and research revolve around improvisational electronic music, analog electronic instrument design, experimental music programming, and open music technologies. His artistic output includes works for orchestra, chamber ensemble, film, animation, dance, theater, and sound installation.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);

    expect(shortDescription).toBe(
      'Creative work spans improvisational electronic music, analog electronic instrument design, experimental music programming, and open music technologies.',
    );
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('keeps Ph.D. thesis-work research sentences intact when deriving card copy', () => {
    const fullDescription =
      'Pallavi Gopal is a graduate of the Medical Scientist Training Program at the University of Pennsylvania, Perelman School of Medicine in Philadelphia. Her Ph.D. thesis work in Neuroscience with Dr. Jeffrey Golden focused on understanding the cellular and molecular mechanisms that guide neuronal migration during forebrain development. After earning her M.D., Pallavi completed postgraduate clinical training in Anatomic Pathology and Neuropathology.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);

    expect(shortDescription).toBe(
      'Studies the cellular and molecular mechanisms that guide neuronal migration during forebrain development.',
    );
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('derives card copy from primary research interests in appointment-led biographies', () => {
    const fullDescription =
      'Rene Almeling is Professor of Sociology at Yale University. Her primary research and teaching interests are in gender, medicine, and reproduction. Using a range of qualitative, historical, and quantitative methods, her work examines questions about how biological bodies and cultural norms interact to influence scientific knowledge, markets, and individual experiences.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);

    expect(fullDescriptionQuality(fullDescription).flags).not.toContain('appointment-only');
    expect(shortDescription).toBe(
      'Studies gender, medicine, and reproduction, using a range of qualitative, historical, and quantitative methods.',
    );
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('keeps appointment-led profiles when later current research projects are explicit', () => {
    const fullDescription =
      'Kate Baldwin is an associate professor of political science and a faculty fellow at the Institution for Social and Policy Studies. She is the author of the book The Paradox of Traditional Chiefs in Democratic Africa. Her current research projects analyze politics in weak states, examining how non-state actors such as traditional leaders, churches, and NGOs interact with the national state to affect development and democracy.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);
    const fullQuality = fullDescriptionQuality(fullDescription);

    expect(fullQuality.flags).not.toContain('appointment-only');
    expect(fullQuality.isUseful).toBe(true);
    expect(shortDescription).toBe(
      'Studies politics in weak states, examining how non-state actors such as traditional leaders, churches, and NGOs interact with the national state to affect development and democracy.',
    );
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('keeps appointment-led profiles when research concerns are explicit', () => {
    const fullDescription =
      'John E. Roemer is the Elizabeth S. and A. Varick Professor of Political Science and Economics. His research concerns political economy and distributive justice. Active current research topics are inter-generational and inter-regional equity in the presence of climate change, and the micro-foundations of cooperation.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);
    const fullQuality = fullDescriptionQuality(fullDescription);

    expect(fullQuality.flags).not.toContain('appointment-only');
    expect(fullQuality.isUseful).toBe(true);
    expect(shortDescription).toBe('Studies political economy and distributive justice.');
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('derives card copy from official lab research-program-use prose', () => {
    const fullDescription =
      'Our research program uses Positron Emission Tomography (PET) imaging, a technique that combines physics, chemistry, mathematics, biology and medicine to enable detection of the molecular underpinnings of the brain including neurotransmitters and synapses. We use the state-of-the-art facility at the Yale PET Center that focuses on quantitative PET techniques using cutting-edge tools such as novel tracers along with advanced imaging technology and techniques to study the brain in living people.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);

    expect(shortDescription).toBe(
      'Uses Positron Emission Tomography (PET) imaging to study molecular underpinnings of the brain.',
    );
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('derives card copy from official lab focused-on prose', () => {
    const fullDescription =
      'Our lab is focused on the intersection of psychiatry, neuroscience, and substance use to advance knowledge of the underlying pathophysiology of psychiatric disorders, including schizophrenia and depression, and to develop novel biomarkers and treatments. We use a multidimensional approach considering the biological, psychological, and environmental factors that contribute to these conditions.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);

    expect(shortDescription).toBe(
      'Studies the intersection of psychiatry, neuroscience, and substance use.',
    );
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('derives card copy from official lab mission prose', () => {
    const fullDescription =
      'The Vascular Medicine OutcomeS (VAMOS) research program’s mission is to serve communities by improving vascular health outcomes. Multidisciplinary and global in its reach, it wants to build a culture of collaboration and diversity in vascular outcomes research. Important pillars of our program are training the next generation of global leaders in vascular outcomes research, and to lead innovations in patient-centered care supported by the insights generated through vascular outcomes research.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);

    expect(shortDescription).toBe('Improves vascular health outcomes through vascular outcomes research.');
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('derives card copy from later official lab mission-to-enhance prose', () => {
    const fullDescription =
      'In 2022, we encountered a patient with Neurofibromatosis Type 2 (NF2) whose tumor growth was not captured by linear MRI measurements. This experience underscored the need for more accurate tumor analysis and led to the creation of the 3D Tumor Lab. Thus, our mission is to enhance the accessibility and precision of 3D tumor growth analysis. We aim to advance from manual segmentation to an automated system that generates 3D models of tumors with just the click of a button.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);

    expect(shortDescription).toBe('Enhances accessibility and precision of 3D tumor growth analysis.');
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('derives card copy from official working-group aims prose', () => {
    const fullDescription =
      'Mission Statement Pharmacoepidemiology is an area of study which focuses on epidemiological methods to evaluate the use and effects of drugs in large populations. The Yale Pharmacoepidemiology Working Group aims to create collaborative opportunities for cultivating and disseminating cutting-edge pharmacoepidemiological methods. The Group aims to provide multi-purpose opportunities to enhance methodological expertise and support collaborative learning.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);

    expect(shortDescription).toBe(
      'Creates collaborative opportunities for cultivating and disseminating cutting-edge pharmacoepidemiological methods.',
    );
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('derives card copy from official profile work-advances prose', () => {
    const fullDescription =
      'I am a physician-scientist in Rheumatology, Director of the Lupus Clinical Research Program and co-Director of the Lupus Program at Yale School of Medicine. My work advances personalized care and precision medicine by integrating target-site pharmacokinetics, interferon-driven immune signatures, and patient-centered qualitative methods to improve outcomes in lupus.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);

    expect(shortDescription).toBe('Advances personalized care and precision medicine to improve outcomes in lupus.');
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('derives card copy from official research-group-focused prose', () => {
    const fullDescription =
      'The Gastric Cancer Prevention and Screening Lab at Yale is a multidisciplinary research group focused on improving early detection and prevention of gastric cancer through clinically grounded, risk-based strategies. Our work bridges research and practice by developing tools to support provider education, refining risk assessment models, and conducting real-world studies in high-risk populations.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);

    expect(shortDescription).toBe(
      'Improves early detection and prevention of gastric cancer through clinically grounded, risk-based strategies.',
    );
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('derives card copy from official physician-research group seek-to prose', () => {
    const fullDescription =
      'The Yale Glaucoma Research Group is comprised of internationally respected physicians and research scientists who seek to decrease preventable blindness from glaucoma through medical and surgical management, research, and community awareness. With continued study to improve their understanding of the diagnosis and management of glaucoma, the group supports innovation in patient care.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);

    expect(shortDescription).toBe(
      'Seeks to decrease preventable blindness from glaucoma through medical and surgical management, research, and community awareness.',
    );
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('derives card copy from official research-fueled-by clinical prose', () => {
    const fullDescription =
      'Our research is fueled by questions arising from clinical observations at the bedside of the patient and focuses on liver diseases. Diseases of the liver represent a major healthcare problem worldwide and the main causes of morbidity and mortality in the population between 45 and 55 years old.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);

    expect(shortDescription).toBe('Studies liver diseases.');
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('derives card copy from research interests that lie in a field', () => {
    const fullDescription =
      'Shelly Kagan is the Clark Professor of Philosophy at Yale University. Kagan’s main research interests lie in moral philosophy, and in particular, normative ethics. Much of his work centers on the debate between consequentialist and deontological moral theories.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);
    const fullQuality = fullDescriptionQuality(fullDescription);

    expect(fullQuality.flags).not.toContain('appointment-only');
    expect(fullQuality.isUseful).toBe(true);
    expect(shortDescription).toBe('Studies moral philosophy, and in particular, normative ethics.');
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('derives card copy from first-person does-research-in profile bios', () => {
    const fullDescription =
      'I am an Assistant Professor of Economics at Yale University and a Faculty Research Fellow at the NBER. I do research in Financial Economics and Macroeconomics, with an emphasis on normative questions. I teach General Equilibrium and Welfare Economics.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);
    const fullQuality = fullDescriptionQuality(fullDescription);

    expect(fullQuality.flags).not.toContain('appointment-only');
    expect(fullQuality.isUseful).toBe(true);
    expect(shortDescription).toBe(
      'Studies Financial Economics and Macroeconomics, with an emphasis on normative questions.',
    );
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('derives card copy from research contributions include phrasing', () => {
    const fullDescription =
      'Dr. Shyam Sunder is the Robin L. Frank Professor of Accounting, Economics, and Finance at the Yale School of Management. His research contributions include financial reporting, information in security markets, statistical theory of valuation, and design of electronic markets. He is a pioneer in experimental finance.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);
    const fullQuality = fullDescriptionQuality(fullDescription);

    expect(fullQuality.flags).not.toContain('appointment-only');
    expect(fullQuality.isUseful).toBe(true);
    expect(shortDescription).toBe(
      'Studies financial reporting, information in security markets, statistical theory of valuation, and design of electronic markets.',
    );
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('derives card copy from authored-articles scholarship after publication front matter', () => {
    const fullDescription =
      'Daphne A. Brooks is William R. Kenan, Jr. Professor of Black Studies, American Studies, Women’s, Gender, and Sexuality Studies, and Music at Yale University. Brooks has authored numerous articles on race, gender, performance and popular music culture, such as “Loud Dreaming” with Toni Morrison and Cecile McLorin Salvant.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);

    expect(shortDescription).toBe('Studies race, gender, performance and popular music culture.');
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('derives card copy from authored-articles scholarship after long award front matter', () => {
    const fullDescription =
      'Daphne A. Brooks is William R. Kenan, Jr. Professor of Black Studies, American Studies, Women’s, Gender, and Sexuality Studies, and Music at Yale University. She is the author of Bodies in Dissent: Spectacular Performances of Race and Freedom, 1850-1910 (Durham, NC: Duke UP, 2006), winner of The Errol Hill Award for Outstanding Scholarship on African American Performance from ASTR. Liner Notes for the Revolution is the winner of eleven book awards and prizes, including the 2022 ASTR Barnard Hewitt Award for Outstanding Research in Theatre History. Brooks has authored numerous articles on race, gender, performance and popular music culture, such as “Loud Dreaming” with Toni Morrison and Cecile McLorin Salvant. Brooks is currently at work on two book projects.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);

    expect(shortDescription).toBe('Studies race, gender, performance and popular music culture.');
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('derives card copy from profile prose about elucidating disease mechanisms', () => {
    const fullDescription =
      'Dr. Brash received his BS in Engineering Physics from the University of Illinois, minoring in Physiological Psychology. After receiving a PhD in Biophysics, he began elucidating the steps leading from ultraviolet light photons to human skin cancer. Upon moving to Yale, his lab used the distinctive UV mutation pattern to identify genes mutated by sunlight in causing skin cancer.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);

    expect(shortDescription).toBe(
      'Studies steps leading from ultraviolet light photons to human skin cancer.',
    );
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('derives card copy from creative writing profiles with plays and screenplays', () => {
    const fullDescription =
      'Donald Margulies won the Pulitzer Prize for Drama for Dinner with Friends. His many other plays, which include Lunar Eclipse, Long Lost, The Country House, and Shipwrecked! An Entertainment, have been produced on and off-Broadway. He has developed numerous screenplays, teleplays and pilots for HBO, Showtime, NBC, CBS, Warner Bros., TriStar, Universal, Paramount, and MGM.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);

    expect(shortDescription).toBe(
      'Creative work spans playwriting, theater, screenwriting, and dramatic storytelling.',
    );
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('derives card copy from research-is-centered profile prose', () => {
    const fullDescription =
      'I am an Associate Professor in the Department of Biostatistics at the Yale School of Public Health. My research is centered on advancing statistical methodology in causal inference, clinical trial design, and mediation analysis, integrating modern semiparametric and machine learning techniques to address complex challenges in public health.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);

    expect(shortDescription).toBe(
      'Studies advancing statistical methodology in causal inference, clinical trial design, and mediation analysis.',
    );
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('derives card copy from interests-include profile prose', () => {
    const fullDescription =
      'John Coleman Darnell joined the faculty of the Department of Near Eastern Languages & Civilizations as Assistant Professor in 1998. His interests include Egyptian religion, cryptography, the scripts and texts of Graeco-Roman Egypt, and the archaeological and epigraphic remains of ancient activity in the Egyptian Western Desert.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);

    expect(shortDescription).toBe(
      'Studies Egyptian religion, cryptography, the scripts and texts of Graeco-Roman Egypt, and the archaeological and epigraphic remains of ancient activity in the Egyptian Western Desert.',
    );
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('derives card copy from studies-focusing profile prose', () => {
    const fullDescription =
      'Christina M. Kinane is an Assistant Professor of Political Science at Yale University. She studies American political institutions and their role in policymaking under separation of powers, focusing on the political control of the bureaucracy.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);

    expect(shortDescription).toBe(
      'Studies American political institutions and their role in policymaking under separation of powers, focusing on the political control of the bureaucracy.',
    );
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('derives card copy from biomedical informatics research-interest biography prose', () => {
    const fullDescription =
      'Lucila Ohno-Machado, MD, PhD, MBA, is the Deputy Dean for Biomedical Informatics and the Chair of Biomedical Informatics and Data Science. Biomedical Informatics and Data Science serves as the hub for biomedical collaboration at Yale. Her research interests include predictive models, data sharing, and innovative algorithms for federated data analysis.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);
    const fullQuality = fullDescriptionQuality(fullDescription);

    expect(fullQuality.flags).not.toContain('appointment-only');
    expect(fullQuality.isUseful).toBe(true);
    expect(shortDescription).toBe(
      'Studies predictive models, data sharing, and innovative algorithms for federated data analysis.',
    );
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('derives card copy from biomedical informatics big-data innovation prose', () => {
    const fullDescription =
      'Biomedical Informatics and Data Science serves as the hub for biomedical collaboration at Yale. It brings informatics to the clinic and the bedside; innovates new approaches to the analysis of big data across the biomedical research spectrum from basic genetic, proteomic, cellular, and systems biology to the understanding of the social determinants of health; and works in concert with colleagues in data science.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);

    expect(fullDescriptionQuality(fullDescription).isUseful).toBe(true);
    expect(shortDescription).toBe(
      'Innovates new approaches to the analysis of big data across the biomedical research spectrum from basic genetic, proteomic, cellular, and systems biology to the understanding of the social determinants of health.',
    );
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('derives card copy from humanities profiles that teach and write on a scholarly field', () => {
    const fullDescription =
      'John Fabian Witt is the Duffy Class of 1960 Professor of Law and a Professor of History at Yale, where he teaches and writes on the history of American law and the law of torts. He is the author of books including Lincoln’s Code: The Laws of War in American History.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);
    const fullQuality = fullDescriptionQuality(fullDescription);

    expect(fullQuality.flags).not.toContain('appointment-only');
    expect(fullQuality.flags).not.toContain('paper-fragment');
    expect(fullQuality.isUseful).toBe(true);
    expect(shortDescription).toBe('Studies the history of American law and the law of torts.');
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('derives card copy from historian profiles that teach a field and direct a study center', () => {
    const fullDescription =
      'John Mack Faragher was born in Phoenix, Arizona and raised in southern California, where he attended the University of California, Riverside. His books include Women and Men on the Overland Trail and Frontiers: A Short History of the American West. He teaches the history of the American West and directs the Howard R. Lamar Center for the Study of Frontiers and Borders.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);
    const fullQuality = fullDescriptionQuality(fullDescription);

    expect(fullQuality.flags).not.toContain('source-news-fragment');
    expect(fullQuality.isUseful).toBe(true);
    expect(shortDescription).toBe('Studies the American West.');
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('derives card copy from legal scholarship writing-interest prose', () => {
    const fullDescription =
      'Lea Brilmayer is the Howard M. Holtzmann Professor of International Law at Yale Law School. During her first decade of teaching, her writing interests mainly concerned conflict of laws, federal jurisdiction, and jurisprudence. More recently, her interests have gradually turned to international law and international relations, and she is frequently cited for her academic writings about nationalism and the international legal status of secessionist movements.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);
    const fullQuality = fullDescriptionQuality(fullDescription);

    expect(fullQuality.flags).not.toContain('appointment-only');
    expect(fullQuality.isUseful).toBe(true);
    expect(shortDescription).toBe('Studies conflict of laws, federal jurisdiction, and jurisprudence.');
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('derives card copy from substantive-interests profile prose after appointment front matter', () => {
    const fullDescription =
      'K. Sudhir is Robin L. Frank Professor of Marketing, Private Enterprise and Management at the Yale School of Management. He served as Visiting Fellow at Microsoft Research for the year 2020. Sudhir’s substantive interests include customer relationship management, digital marketing and artificial intelligence, marketing organizations and emerging markets. His papers use a wide range of methods including machine learning, quasi-experiments, field experiments and game theory.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);
    const fullQuality = fullDescriptionQuality(fullDescription);

    expect(fullQuality.flags).not.toContain('source-news-fragment');
    expect(fullQuality.isUseful).toBe(true);
    expect(shortDescription).toBe(
      'Studies customer relationship management, digital marketing and artificial intelligence, marketing organizations and emerging markets.',
    );
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('derives card copy from scholarly-work-encompasses profile prose', () => {
    const fullDescription =
      'David Bromwich is a Sterling Professor of English at Yale University, with a rich academic background that includes appointments at Princeton before joining Yale. His scholarly work encompasses a variety of topics, particularly focusing on the intellectual life of Edmund Burke, modern poetry, and the intersection of politics and literature. He has authored several notable books.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);
    const fullQuality = fullDescriptionQuality(fullDescription);

    expect(fullQuality.flags).not.toContain('appointment-only');
    expect(fullQuality.isUseful).toBe(true);
    expect(shortDescription).toBe(
      'Studies the intellectual life of Edmund Burke, modern poetry, and the intersection of politics and literature.',
    );
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('derives card copy from foremost-authority profile prose after joined-Yale front matter', () => {
    const fullDescription =
      'David W. Blight joined the faculty at Yale in January 2003. He is one of the nation’s foremost authorities on the US Civil War and its legacy. Blight has also published essays and edited volumes on topics related to the Civil War, abolitionism, and African American history.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);
    const fullQuality = fullDescriptionQuality(fullDescription);

    expect(fullQuality.flags).not.toContain('source-news-fragment');
    expect(fullQuality.isUseful).toBe(true);
    expect(shortDescription).toBe('Studies the US Civil War and its legacy.');
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('derives card copy from clinical-research-includes prose after appointment front matter', () => {
    const fullDescription =
      'Frank Detterbeck, MD, FACS, FCCP is a Professor of Surgery at Yale University and Associate Director of the Yale Cancer Center. He specializes in the surgical treatment of lung cancer and thoracic tumors. His clinical research includes cancer biology, cancer imaging techniques, prognostic markers of cancers, multimodality treatment of cancer, and evidence-based medicine.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);
    const fullQuality = fullDescriptionQuality(fullDescription);

    expect(fullQuality.flags).not.toContain('appointment-only');
    expect(fullQuality.isUseful).toBe(true);
    expect(shortDescription).toBe(
      'Studies cancer biology, cancer imaging techniques, prognostic markers of cancers, multimodality treatment of cancer, and evidence-based medicine.',
    );
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('rejects reputation-only and degree-only cards after finding better research prose', () => {
    const reputationFull =
      'Dr. Mario Sznol is a Professor of Medicine (Medical Oncology) with an international reputation in cancer drug development. His expertise lies in cancer immunotherapy, drug development for cancer, and the treatment of patients with melanoma and renal cell carcinoma.';
    const degreeFull =
      'Dr. Tish Knobf is a Professor of Nursing at Yale University with a focus on the clinical practice and research related to women with breast cancer. Her research has been foundational in understanding symptom distress in cancer patients.';

    expect(shortDescriptionQuality('Dr. Sznol has an international reputation in cancer drug development.', reputationFull).isUseful).toBe(false);
    expect(shortDescriptionQuality("Dr. Knobf holds a master's degree from the Yale School of Nursing.", degreeFull).isUseful).toBe(false);
    expect(deriveShortDescriptionFromFullDescription(reputationFull)).toBe(
      'Studies cancer immunotherapy, drug development for cancer, and the treatment of patients with melanoma and renal cell carcinoma.',
    );
    expect(deriveShortDescriptionFromFullDescription(degreeFull)).toBe(
      'Studies clinical practice and research related to women with breast cancer.',
    );
  });

  it('derives card copy from specialist-in academic profiles', () => {
    const fullDescription =
      'William Brainard is a specialist in economic theory, macroeconomics, and monetary theory. He has taught at Yale University since 1962 and wrote influential work on monetary policy under uncertainty.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);
    const fullQuality = fullDescriptionQuality(fullDescription);

    expect(fullQuality.flags).not.toContain('source-news-fragment');
    expect(fullQuality.isUseful).toBe(true);
    expect(shortDescription).toBe('Studies economic theory, macroeconomics, and monetary theory.');
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('derives card copy from has-written-about scholarship prose', () => {
    const fullDescription =
      'David R. Cameron is a Professor of Political Science at Yale and the Director of the Yale Program in European Union Studies. He teaches courses on European politics and the European Union. He has written about the impact of trade openness on government and the creation of democratic polities and market-oriented economies in central and eastern Europe.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);
    const fullQuality = fullDescriptionQuality(fullDescription);

    expect(fullQuality.flags).not.toContain('appointment-only');
    expect(fullQuality.isUseful).toBe(true);
    expect(shortDescription).toBe(
      'Studies the impact of trade openness on government and the creation of democratic polities and market-oriented economies in central and eastern Europe.',
    );
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('derives card copy from first-person research-aims prose with profile URL chrome', () => {
    const fullDescription =
      'My research aims at understanding the RNA molecular mechanisms underlying dysregulation in human diseases, by combining experimental and computational approaches and with focus on alternative splicing events. https://www.researchgate.net/profile/Taylor_Testfixture https://orcid.org/0000-0000-0000-0001 Last Updated on February 11, 2025.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);
    const fullQuality = fullDescriptionQuality(fullDescription);

    expect(fullQuality.flags).not.toContain('profile-chrome');
    expect(fullQuality.isUseful).toBe(true);
    expect(shortDescription).toBe(
      'Studies the RNA molecular mechanisms underlying dysregulation in human diseases.',
    );
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('derives card copy from primary areas driving teaching and research', () => {
    const fullDescription =
      "Dr. Shimon Anisfeld sees himself as an educator first and a researcher second. Two primary areas of interest have driven Dr. Anisfeld's teaching and research at Yale over the last two decades: coastal ecosystems and freshwater management. His long-term research studies the response of Connecticut salt marshes to sea-level rise.";

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);
    const fullQuality = fullDescriptionQuality(fullDescription);

    expect(fullQuality.flags).not.toContain('profile-chrome');
    expect(fullQuality.isUseful).toBe(true);
    expect(shortDescription).toBe('Studies coastal ecosystems and freshwater management.');
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('derives card copy from curatorial research-based program prose', () => {
    const fullDescription =
      'Marta Kuzma is a Professor of Art at Yale University. She was the director of the Office for Contemporary Art Norway, where she established the OCA Semesterplan, a research-based program of exhibitions and projects. Her curatorial work includes significant exhibitions at the Venice Biennale and Documenta 13.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);
    const fullQuality = fullDescriptionQuality(fullDescription);

    expect(fullQuality.flags).not.toContain('appointment-only');
    expect(fullQuality.isUseful).toBe(true);
    expect(shortDescription).toBe(
      'Creative work spans curatorial practice, research-based exhibitions and projects, and contemporary art.',
    );
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('derives card copy from our-work-focuses profile prose', () => {
    const fullDescription =
      'What are the algorithms of the mind implemented in neural activity and online psychological processes? Our work focuses on visual cognition, uncovering the computational logic and intermediate representations that transform images into rich representations of objects, agents, and places.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);

    expect(shortDescription).toBe(
      'Studies visual cognition, uncovering the computational logic and intermediate representations that transform images into rich representations of objects, agents, and places.',
    );
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('derives card copy from YSM lab research-focus prose before method lists', () => {
    const fullDescription =
      "The RIIPL lab is a pioneering force in neuroimaging research housed within the Yale University School of Medicine. Our lab research focus extends through diverse areas such as Diabetes, Dyslexia, Aging, Music, Brain Tumors, and Alzheimer's Disease, leveraging our expertise in: Medical 3D Printing to create anatomical models for surgical planning and education. Immersive Technologies including Virtual Reality (VR), Extended Reality (XR), and Spatial Computing to enhance diagnostic accuracy and therapeutic applications.";

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);

    expect(shortDescription).toBe(
      "Studies neuroimaging across Diabetes, Dyslexia, Aging, Music, Brain Tumors, and Alzheimer's Disease.",
    );
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('derives card copy from currently studying mechanisms phrasing', () => {
    const fullDescription =
      'David Braun, MD, PhD, is an Assistant Professor of Medicine and a member of the Center of Molecular and Cellular Oncology at Yale Cancer Center. He has a longstanding interest in integrating experimental and computational approaches to biomedical research and is currently studying mechanisms of response and resistance to immune therapy in kidney cancer, with the goal of developing novel therapies.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);

    expect(shortDescription).toBe(
      'Studies mechanisms of response and resistance to immune therapy in kidney cancer.',
    );
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('derives card copy from first-person clinical trial summaries without keeping first person', () => {
    const fullDescription =
      'We are conducting 2 Phase III RCTs for pathogen reduced RBCs. One involves patients undergoing complex cardiovascular surgery and the other anemic oncology patients receiving simple transfusions. Medical Research InterestsBlood Banks; Blood Transfusion.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);

    expect(shortDescription).toBe('Conducts 2 Phase III RCTs for pathogen reduced RBCs.');
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('derives card copy from scholar-of phrasing after appointment front matter', () => {
    const fullDescription =
      'Daniel Martinez HoSang is Professor of American Studies and holds secondary appointments in the Department of Political Science and in the Yale School of Medicine Section of the History of Medicine. He is an interdisciplinary scholar of racial formation and racism in politics, culture, and the law. HoSang’s current research projects include a volume of essays on the politics of the multiracial right.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);

    expect(shortDescription).toBe(
      'Studies racial formation and racism in politics, culture, and the law.',
    );
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('derives card copy from research-spans phrasing after appointment front matter', () => {
    const fullDescription =
      'Marcia C. Inhorn, PhD, MPH, is the William K. Lanman, Jr. Professor of Anthropology and International Affairs at Yale University, specializing in Middle Eastern gender, religion, and health. Her research spans over 35 years, focusing on the social impact of infertility and assisted reproductive technologies in various regions including Egypt, Lebanon, and the United Arab Emirates. Inhorn’s recent work draws on interviews with American women to explore the motivations behind egg freezing.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);

    expect(fullDescriptionQuality(fullDescription).flags).not.toContain('appointment-only');
    expect(shortDescription).toBe(
      'Studies the social impact of infertility and assisted reproductive technologies in various regions including Egypt, Lebanon, and the United Arab Emirates.',
    );
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('keeps research-focused profile bios with publication and media mentions', () => {
    const fullDescription =
      'I am an Assistant Professor of American Studies at Yale University and a Just Tech Fellow at the Social Science Research Council. My research examines the social and cultural dimensions of information, especially the role of labor and infrastructure in the development of artificial intelligence. My book, Platform Extractivism: Data Work and the People Powering Artificial Intelligence (University of California Press, October 2026), argues that the development of datasets for artificial intelligence depends on labor organized through platform extractivism. My academic articles have been published in journals including Big Data & Society and the Proceedings of the ACM on Human-Computer Interaction. My research and commentary have appeared in media outlets including The Economist, Fortune, and WIRED.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);
    const fullQuality = fullDescriptionQuality(fullDescription);

    expect(fullQuality.flags).not.toContain('paper-fragment');
    expect(fullQuality.flags).not.toContain('source-news-fragment');
    expect(fullQuality.isUseful).toBe(true);
    expect(shortDescription).toBe(
      'Examines the social and cultural dimensions of information, especially the role of labor and infrastructure in the development of artificial intelligence.',
    );
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('derives card copy from primary specialization sentences before publication lists', () => {
    const fullDescription =
      'Paul H. Fry is the William Lampson Professor of English and has taught at Yale since 1971. His primary areas of specialization are British romanticism, the history of literary criticism, contemporary literary theory, and literature in relation to the visual arts. Subsequent books are: The Reach of Criticism: Method and Perception in Literary Theory (Yale, 1984), William Empson: Prophet Against Sacrifice (Routledge, 1990), and Wordsworth and the Poetry of What We Are (Yale Studies in English, 2008).';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);

    expect(shortDescription).toBe(
      'Studies British romanticism, the history of literary criticism, contemporary literary theory, and literature in relation to the visual arts.',
    );
    expect(shortDescriptionQuality('Martins, 1999), and Wordsworth and the Poetry of What We Are.', fullDescription).isUseful).toBe(false);
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('derives card copy from specializations sections before biography front matter', () => {
    const fullDescription =
      'Professional website: https://jameshepokoski.com/ Specializations: History and analysis of European art music from ca. 1750 to 1950; historical contexts, musical structure, and hermeneutics. About: Robin Hepokoski received his M.A. and Ph.D. in musicology from Harvard University.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);

    expect(shortDescription).toBe(
      'Studies History and analysis of European art music from ca. 1750 to 1950; historical contexts, musical structure, and hermeneutics.',
    );
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('derives card copy from leading humanities field-list profile prose', () => {
    const fullDescription =
      'Middle English especially Chaucer and Langland, Medieval Latin. I have finished editing and translating Gervase of Melkley’s Ars versificatoria; it will appear from the Dunbarton Oaks Medieval Library early in 2025. I am currently teaching a course in the Yale Alumni College on Joyce’s Ulysses.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);

    expect(shortDescription).toBe('Studies Middle English especially Chaucer and Langland, Medieval Latin.');
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('rejects teaching-only profile biographies as research descriptions', () => {
    const fullDescription =
      'Andrew Ehrgood teaches expository writing in the English Department. A former trusts and estates lawyer, Andrew also teaches an undergraduate introduction to legal reasoning and writing. Before teaching in the English Department, Andrew taught Japanese in the Department of East Asian Languages and Literatures. In 2018, he received the Brodhead Prize for Teaching Excellence.';
    const profileChrome =
      'Interests Andrew Ehrgood teaches expository writing in the English Department. A former trusts and estates lawyer, Andrew also teaches an undergraduate introduction to legal reasoning and writing. Courses Undergraduate: Reading and Writing the Modern Essay; Thinking and Writing about the Law';

    expect(fullDescriptionQuality(fullDescription).flags).toContain('profile-chrome');
    expect(fullDescriptionQuality(fullDescription).isUseful).toBe(false);
    expect(fullDescriptionQuality(profileChrome).flags).toContain('profile-chrome');
    expect(deriveShortDescriptionFromFullDescription(fullDescription)).toBe('');
    expect(deriveShortDescriptionFromFullDescription(profileChrome)).toBe('');
  });

  it('rejects card fragments from book-title lists and single-initial truncation', () => {
    const fullDescription =
      'The profile includes a list of publications and books before the research summary.';

    expect(shortDescriptionQuality('Louis, the Interdisciplinary PhD in Theatre at Northwestern University.', fullDescription).isUseful).toBe(false);
    expect(shortDescriptionQuality('Her book, Southern Horrors: Women and the Politics of Rape and Lynching, focuses on two women journalists, Ida B.', fullDescription).isUseful).toBe(false);
  });

  it('derives card copy from study/history-of book descriptions when no clearer research sentence exists', () => {
    const fullDescription =
      'Joseph Roach has chaired several departments. His most recent book is It (Michigan, 2007), a study of charismatic celebrity. His other books and articles include Cities of the Dead: Circum-Atlantic Performance.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);

    expect(shortDescription).toBe('Studies charismatic celebrity.');
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('derives card copy from currently-working-on profile research bios', () => {
    const fullDescription =
      'Alan Mikhail is the author of five books and editor of another. His work has helped to establish the field of Middle East environmental history, positioned the Ottoman Empire at the center of global early modern history, and creatively scrutinized the place of the archive in the making of past and present. He is currently working on the intertwined histories of Islam and colonial America.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);

    expect(shortDescription).toBe('Works on the intertwined histories of Islam and colonial America.');
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('derives card copy from presently-working-on profile research bios', () => {
    const fullDescription =
      'Stuart Schwartz is a historian of colonial Latin America and the Atlantic world. He is presently working on several projects: a history of Brazil and the Atlantic world, and a social history of Caribbean hurricanes.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);

    expect(fullDescriptionQuality(fullDescription).flags).not.toContain('source-news-fragment');
    expect(shortDescription).toBe(
      'Works on a history of Brazil and the Atlantic world, and a social history of Caribbean hurricanes.',
    );
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('derives card copy from research-aimed-at profile research bios', () => {
    const fullDescription =
      'Dr. Rodwin is an Assistant Professor of Pediatrics at Yale School of Medicine. She looks forward to continuing her research aimed at minimizing treatment-related toxicities and improving health-related quality of life for childhood cancer survivors through interventions and the HEROS survivorship program.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);

    expect(fullDescriptionQuality(fullDescription).flags).not.toContain('appointment-only');
    expect(shortDescription).toBe(
      'Studies minimizing treatment-related toxicities and improving health-related quality of life for childhood cancer survivors through interventions and the HEROS survivorship program.',
    );
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('derives card copy from co-principal-investigator grant project prose', () => {
    const fullDescription =
      'Barbara Shailor is Senior Research Scholar in Classics and retired Deputy Provost for the Arts at Yale University. Ms. Shailor is Co-Principal Investigator on a grant from the Andrew W. Mellon Foundation, Digitally Enabled Scholarship and Medieval Manuscripts at Yale University.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);

    expect(shortDescription).toBe(
      'Studies Digitally Enabled Scholarship and Medieval Manuscripts at Yale University.',
    );
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('derives card copy from collaboration project prose', () => {
    const fullDescription =
      'Professor Plattus is involved in a collaboration on an annual urban design studio project in Hong Kong. This project was undertaken jointly by students at Yale, Hong Kong University, and Tongji University. The sites are usually in Shanghai and students and faculty travel to Hong Kong, Shanghai, and New Haven.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);

    expect(shortDescription).toBe(
      'Works on an annual urban design studio project in Hong Kong through collaboration.',
    );
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('does not turn biography chronology into currently-working-on card copy', () => {
    const fullDescription =
      'After working on the staff of the Demotic Dictionary Project in Chicago, he joined the Epigraphic Survey of the Oriental Institute, based at Chicago House in Luxor, Egypt.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);

    expect(shortDescription).toBe('');
  });

  it('derives card copy from scholarship contribution phrasing', () => {
    const fullDescription =
      'His scholarship has had a global impact. He has been awarded an honorary doctorate for his contributions to comparative constitutional law. Before the Next Attack served as a basis for reform of emergency powers.';

    const shortDescription = deriveShortDescriptionFromFullDescription(fullDescription);

    expect(shortDescription).toBe('Studies comparative constitutional law and emergency powers reform.');
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('accepts concise source-backed research-field lists as useful descriptions', () => {
    const fullDescription = 'Research fields include HIV Infections, Veterans, and Aging.';
    const shortDescription = 'Studies HIV Infections, Veterans, and Aging.';

    expect(fullDescriptionQuality(fullDescription).isUseful).toBe(true);
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });

  it('accepts concise imaging research-field lists as useful descriptions', () => {
    const fullDescription =
      'Research fields include Brain Neoplasms, Molecular Imaging, and Liver Neoplasms.';
    const shortDescription = 'Studies Brain Neoplasms, Molecular Imaging, and Liver Neoplasms.';

    expect(fullDescriptionQuality(fullDescription).isUseful).toBe(true);
    expect(shortDescriptionQuality(shortDescription, fullDescription).isUseful).toBe(true);
  });
});
