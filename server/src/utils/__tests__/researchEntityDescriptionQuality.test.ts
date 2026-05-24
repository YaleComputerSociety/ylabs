import { describe, expect, it } from 'vitest';
import {
  assessResearchEntityDescriptionQuality,
  deriveShortDescriptionFromFullDescription,
} from '../researchEntityDescriptionQuality';

describe('researchEntityDescriptionQuality', () => {
  it('passes a useful full description and derives a concise browsing summary', () => {
    const fullDescription =
      'The lab studies how children and adults learn social-group categories and use them to reason about other people. Its projects combine behavioral experiments, developmental studies, and cross-cultural methods to understand intergroup cognition.';

    const quality = assessResearchEntityDescriptionQuality({
      fullDescription,
      shortDescription: 'My lab focuses on intergroup social cognition.',
    });

    expect(quality.full.isUseful).toBe(true);
    expect(quality.short.isUseful).toBe(false);
    expect(quality.short.flags).toContain('generic-lead');
    expect(deriveShortDescriptionFromFullDescription(fullDescription)).toBe(
      'Studies how children and adults learn social-group categories and use them to reason about other people, using behavioral experiments, developmental studies, and cross-cultural methods.',
    );
  });

  it('blocks short descriptions when the full description is only metadata', () => {
    const quality = assessResearchEntityDescriptionQuality({
      fullDescription:
        'Meridian Lab is a Yale research home connected to INMD - Internal Medicine and .',
      shortDescription: 'Research home connected to INMD - Internal Medicine and .',
      sourceUrls: ['https://research.example.edu/lab/meridian/'],
    });

    expect(quality.full.isUseful).toBe(false);
    expect(quality.full.flags).toEqual(expect.arrayContaining(['synthetic-placeholder', 'broken-template']));
    expect(quality.short.isUseful).toBe(false);
    expect(quality.cardState).toBe('sparse');
    expect(quality.sourceEligible).toBe(true);
  });

  it('rejects profile chrome and appointment-only text as full descriptions', () => {
    expect(
      assessResearchEntityDescriptionQuality({
        fullDescription:
          'Research areas include Immunity, Innate23 YSM ResearchersView 57 Related PublicationsAutophagy4 YSM ResearchersView 18 Related Publications.',
        shortDescription:
          'Research areas include Immunity, Innate23 YSM ResearchersView 57 Related Publications.',
      }).full.flags,
    ).toContain('profile-chrome');

    expect(
      assessResearchEntityDescriptionQuality({
        fullDescription:
          'Synthetic Faculty Member will be appointed as an Assistant Professor of Example Biology.',
        shortDescription:
          'Synthetic Faculty Member will be appointed as an Assistant Professor of Example Biology.',
      }).full.flags,
    ).toContain('appointment-only');
  });

  it('rejects Cancer Center profile navigation chrome as description text', () => {
    const quality = assessResearchEntityDescriptionQuality({
      fullDescription:
        'Synthetic Researcher is an Associate Research Scientist at Example School of Medicine AdministrationNCI DesignationHistoryCommunity OutreachCommunity Advisory BoardProgramsBy the NumbersInformation & ResourcesResearchTrainingMeet Our TeamPatient InformationCancer Types',
      shortDescription:
        'AdministrationNCI DesignationHistoryCommunity OutreachCommunity Advisory BoardProgramsBy the NumbersInformation & ResourcesResearchTrainingMeet Our TeamPatient InformationCancer Types',
    });

    expect(quality.full.isUseful).toBe(false);
    expect(quality.full.flags).toContain('profile-chrome');
    expect(quality.short.isUseful).toBe(false);
    expect(quality.short.flags).toContain('profile-chrome');
  });

  it('rejects center page navigation chrome as description text', () => {
    const quality = assessResearchEntityDescriptionQuality({
      fullDescription:
        'People Events Research Courses Opportunities News Research The following Faculty Research Initiatives are currently active at the Blue Center.',
      shortDescription:
        'People Events Research Courses Opportunities News Research The following Faculty Research Initiatives are currently active at the Blue Center.',
    });

    expect(quality.full.isUseful).toBe(false);
    expect(quality.full.flags).toContain('profile-chrome');
    expect(quality.short.isUseful).toBe(false);
    expect(quality.short.flags).toContain('profile-chrome');
  });

  it('rejects doctor-profile callouts and broken generated short fragments', () => {
    const profileChrome = assessResearchEntityDescriptionQuality({
      fullDescription:
        "After obtaining a medical degree, Dr. Linden trained in basic research and internal medicine at a university medical center View this doctor's clinical profile on the example medicine website for information about the services we offer and making an appointment.",
      shortDescription:
        'View Doctor ProfileAdditional TitlesAssistant Professor, Synthetic Biomedical Data ScienceClinical Member, Synthetic Prevention Program.',
    });

    expect(profileChrome.full.flags).toContain('profile-chrome');
    expect(profileChrome.short.flags).toContain('profile-chrome');

    const brokenShort = assessResearchEntityDescriptionQuality({
      fullDescription:
        'The lab studies immunotherapy targets in animal tumor models and uses translational experiments to understand PD-1 and PD-L1 signaling in cancer.',
      shortDescription: 'Dr, using PD-1 and PD-L1 in animal tumor models.',
    });

    expect(brokenShort.full.isUseful).toBe(true);
    expect(brokenShort.short.isUseful).toBe(false);
    expect(brokenShort.short.flags).toContain('source-news-fragment');
  });

  it('rejects lab-site navigation chrome mixed into generated descriptions', () => {
    const quality = assessResearchEntityDescriptionQuality({
      fullDescription:
        'Current Members Collaborators Lab Life Alumni CS Years Past Research Current Research Publications Posters Get Involved Participate Contact Us Menu Toggle extended navigation Cognitive Systems Lab The Cognitive Systems Lab is a scientific research group at Example University headed by Mira Vale. We use human neuroscience methods to investigate cognition.',
      shortDescription:
        'Current Members Collaborators Lab Life Alumni CS Years Past Research Current Research Publications Posters Get Involved Participate Contact Us Menu Toggle extended navigation Cognitive Systems Lab studies cognition.',
    });

    expect(quality.full.isUseful).toBe(false);
    expect(quality.full.flags).toContain('profile-chrome');
    expect(quality.short.isUseful).toBe(false);
    expect(quality.short.flags).toContain('profile-chrome');
  });

  it('rejects lab homepage navigation chrome even when it mentions a research hub', () => {
    const quality = assessResearchEntityDescriptionQuality({
      fullDescription:
        'Explore Research Meet the Lab AboutAbout the Meridian LabThe Meridian Lab is located at Yale University, a long-standing hub of breakthroughs in the study of RNA.',
      shortDescription:
        'Explore Research Meet the Lab AboutAbout the Meridian LabThe Meridian Lab is located at Yale University.',
    });

    expect(quality.full.isUseful).toBe(false);
    expect(quality.full.flags).toContain('profile-chrome');
    expect(quality.short.isUseful).toBe(false);
    expect(quality.short.flags).toContain('profile-chrome');
  });

  it('rejects location-only lab about fragments as generic identity text', () => {
    const quality = assessResearchEntityDescriptionQuality({
      fullDescription:
        'The Meridian Lab is located at Yale University, a long-standing hub of breakthroughs in the study of RNA.',
      shortDescription:
        'The Meridian Lab is located at Yale University, a long-standing hub of breakthroughs in the study of RNA.',
    });

    expect(quality.full.isUseful).toBe(false);
    expect(quality.full.flags).toContain('generic-lead');
    expect(quality.short.isUseful).toBe(false);
    expect(quality.short.flags).toContain('generic-lead');
  });

  it('derives a research-focused short description when the first sentence only identifies the lab', () => {
    const fullDescription =
      'The Cognitive Systems Lab is a scientific research group at Example University headed by Mira Vale. We use human neuroscience methods to investigate how the brain constructs cohesive experience and guides adaptive behavior.';
    const quality = assessResearchEntityDescriptionQuality({
      fullDescription,
      shortDescription:
        'The Cognitive Systems Lab is a scientific research group at Example University headed by Mira Vale.',
    });

    expect(quality.full.isUseful).toBe(true);
    expect(quality.short.isUseful).toBe(false);
    expect(quality.short.flags).toContain('generic-lead');
    expect(deriveShortDescriptionFromFullDescription(fullDescription)).toBe(
      'Uses human neuroscience methods to investigate how the brain constructs cohesive experience and guides adaptive behavior.',
    );
  });

  it('normalizes conduct-research lead phrasing into a useful browsing summary', () => {
    const fullDescription =
      "The Meridian Health Lab conducts research focused on HIV and women's health, particularly among women involved in criminal justice systems, those with substance use disorders, and survivors of intimate partner violence. The lab develops and tests gender-responsive, trauma-informed HIV prevention and treatment interventions.";

    expect(deriveShortDescriptionFromFullDescription(fullDescription)).toBe(
      "Studies HIV and women's health, particularly among women involved in criminal justice systems, those with substance use disorders, and survivors of intimate partner violence.",
    );
  });

  it('derives a useful short summary from primary-interest instrumentation prose', () => {
    const fullDescription =
      'Our primary research interest is transformative instrumentation development. At the forefront of volume Electron Microscopy (vEM), we aim to develop next generation technologies to enable discoveries from engineering to life science to clinical applications.';

    expect(deriveShortDescriptionFromFullDescription(fullDescription)).toBe(
      'Develops next-generation technologies for volume Electron Microscopy (vEM), with a focus on transformative instrumentation development.',
    );
  });

  it('derives useful summaries from official professor-profile research phrasing', () => {
    expect(
      deriveShortDescriptionFromFullDescription(
        'Dr. Example studies how biological systems learn, adapt, and evolve functional molecular programs, with a special focus on the immune system.',
      ),
    ).toBe(
      'Studies how biological systems learn, adapt, and evolve functional molecular programs, with a special focus on the immune system.',
    );

    expect(
      deriveShortDescriptionFromFullDescription(
        'The research led by Morgan E. Hale focuses on utilizing Positron Emission Tomography (PET) to noninvasively measure in vivo physiology in humans and laboratory animals. Their work includes developing new tracer kinetic modeling methods and algorithms.',
      ),
    ).toBe(
      'Studies utilizing Positron Emission Tomography (PET) to noninvasively measure in vivo physiology in humans and laboratory animals.',
    );

    expect(
      deriveShortDescriptionFromFullDescription(
        "Valen's research interests are in the field of computer and communication networks with emphasis on fundamental mathematical models and algorithms of complex networks, architectures and protocols of wireless systems.",
      ),
    ).toBe(
      'Studies the field of computer and communication networks with emphasis on fundamental mathematical models and algorithms of complex networks, architectures and protocols of wireless systems.',
    );

    expect(
      deriveShortDescriptionFromFullDescription(
        'I am a labor economist who studies how public policy shapes economic opportunity for children, families, and young adults.',
      ),
    ).toBe(
      'Studies how public policy shapes economic opportunity for children, families, and young adults.',
    );
  });

  it('skips broad setup sentences when deriving short descriptions from materials-research prose', () => {
    const fullDescription =
      'One of the grand challenges of materials research is the ability to engineer and tune quantum degrees of freedom in order to discover new properties and phenomena, as well as to harness the flow of energy, charge, and information. The discovery and development of these materials must be guided by a deep understanding of how electrons and atoms in these systems behave in response to external stimuli. Our group uses and develops first principles quantum physics methods, which exploit high-performance computing to calculate many-electron interaction effects and make quantitatively accurate predictions about real materials.';

    expect(deriveShortDescriptionFromFullDescription(fullDescription)).toBe(
      'Uses and develops first principles quantum physics methods, which exploit high-performance computing to calculate many-electron interaction effects and make quantitatively accurate predictions about real materials.',
    );
  });

  it('rejects truncated full descriptions before deriving short descriptions', () => {
    const quality = assessResearchEntityDescriptionQuality({
      fullDescription:
        'Our research group focuses on delineating the molecular and mechanistic basis of neurotransmitter release in nerve terminals and understanding how it is altered',
      shortDescription:
        'Our research group focuses on delineating the molecular and mechanistic basis of neurotransmitter release in nerve terminals and understanding how it is altered',
    });

    expect(quality.full.isUseful).toBe(false);
    expect(quality.full.flags).toContain('incomplete-sentence');
    expect(deriveShortDescriptionFromFullDescription(quality.full.text)).toBe('');
  });

  it('rejects colon-ended incomplete full descriptions and malformed study verbs', () => {
    const quality = assessResearchEntityDescriptionQuality({
      fullDescription:
        'The Nucleus Forge Lab takes a multi-disciplinary and multi-model approach to tackle fundamental and disease-relevant problems related to the cell biology, biochemistry and biophysics of the nucleus and the nuclear envelope. Our team pursues big questions including those focused on:',
      shortDescription:
        'Studies attack topical and fundamental questions in condensed materials theory and materials physics using first principles computational methods.',
    });

    expect(quality.full.isUseful).toBe(false);
    expect(quality.full.flags).toContain('incomplete-sentence');
    expect(quality.short.isUseful).toBe(false);
    expect(quality.short.flags).toContain('malformed-generated-text');
  });

  it('derives useful short descriptions from named lab investigates leads', () => {
    expect(
      deriveShortDescriptionFromFullDescription(
        'The Nucleus Forge Lab investigates fundamental aspects of nuclear structure, dynamics, and integrity, focusing on how nuclear organization influences genome function and cellular health.',
      ),
    ).toBe(
      'Investigates fundamental aspects of nuclear structure, dynamics, and integrity, focusing on how nuclear organization influences genome function and cellular health.',
    );

    expect(
      deriveShortDescriptionFromFullDescription(
        'Sonar Systems Lab focuses on developing biomimetic sensors inspired by biological systems such as echolocating animals. The lab employs digital signal processing algorithms to extract information from sensor data, enhancing system performance through physical principles and prior knowledge.',
      ),
    ).toBe(
      'Focuses on developing biomimetic sensors inspired by biological systems such as echolocating animals.',
    );

    expect(
      deriveShortDescriptionFromFullDescription(
        "Example Scholar's research examines the intersection of organizations, gender, and cultural sociology, focusing on the future of work. Their studies investigate how pay equity laws influence employers' pay-setting practices, utilizing methods such as in-depth interviews, archival research, and survey experiments.",
      ),
    ).toBe(
      'Examines the intersection of organizations, gender, and cultural sociology, focusing on the future of work.',
    );
  });

  it('normalizes copied lab lead sentences into browsable short descriptions', () => {
    expect(
      deriveShortDescriptionFromFullDescription(
        'In the Membrane Design Lab, we investigate the spectrin membrane cytoskeleton and its critical role in organizing specialized membrane-surface domains essential for multicellular organisms. Our research addresses how cells achieve spatial design, the mechanisms behind polarized assembly of membrane domains, and the interactions of spectrin with other proteins in processes like signal transduction and cell differentiation.',
      ),
    ).toBe(
      'Investigates the spectrin membrane cytoskeleton and its critical role in organizing specialized membrane-surface domains essential for multicellular organisms.',
    );

    expect(
      deriveShortDescriptionFromFullDescription(
        "The Neural Repair Laboratory focuses on understanding the molecular pathways that limit fiber growth and functional rewiring of neuronal circuits during health and disease, particularly in the context of spinal cord injury and Alzheimer's disease. The lab utilizes chronic in vivo imaging, genetic alteration of mice, and receptor-ligand binding assays to study the mechanisms of axonal growth.",
      ),
    ).toBe(
      "Focuses on understanding the molecular pathways that limit fiber growth and functional rewiring of neuronal circuits during health and disease, particularly in the context of spinal cord injury and Alzheimer's disease.",
    );

    expect(
      deriveShortDescriptionFromFullDescription(
        'In the Membrane Design Lab, our focus of research is the spectrin membrane cytoskeleton and its evidently pivotal role in the process of organizing specialized membrane-surface domains that are central to the integrated function of all multicellular organisms. Among the questions we research and discuss are: How is it that cells are so elegant in their spatial design?',
      ),
    ).toBe(
      'Focuses on the spectrin membrane cytoskeleton and its evidently pivotal role in the process of organizing specialized membrane-surface domains that are central to the integrated function of all multicellular organisms.',
    );

    expect(
      deriveShortDescriptionFromFullDescription(
        'The Environmental Health Laboratory focuses on the etiologies and molecular mechanisms of environmentally-induced human diseases, including liver disease, obesity, diabetes, cancer, and neurodegenerative diseases. The lab studies how the exposome, metabolism, and antioxidants influence human health.',
      ),
    ).toBe(
      'Focuses on the etiologies and molecular mechanisms of environmentally-induced human diseases, including liver disease, obesity, diabetes, cancer, and neurodegenerative diseases.',
    );
  });

  it('rejects question-form short descriptions and derives mission prose instead', () => {
    const fullDescription =
      'As you go through your day, you are effortlessly interacting with other people by building living simulations of who they are and how they think. Our lab’s mission is to build a computational theory of how minds understand each other by answering four foundational questions: How does the mind model other minds?';

    const questionQuality = assessResearchEntityDescriptionQuality({
      fullDescription,
      shortDescription: 'How do we build accurate models of each other?',
    });

    expect(questionQuality.short.isUseful).toBe(false);
    expect(questionQuality.short.flags).toContain('malformed-generated-text');
    expect(deriveShortDescriptionFromFullDescription(fullDescription)).toBe(
      'Builds a computational theory of how minds understand each other by answering four foundational questions.',
    );
  });

  it('rejects flattened profile text spliced into research prose', () => {
    const quality = assessResearchEntityDescriptionQuality({
      fullDescription:
        'Dr. Example studies a synthetic receptor family and the functional significance of four example isoforms that exist in model systems and great Professor of Laboratory Medicine, of Immunobiology and of Molecular, Cellular, and Developmental Biology',
      shortDescription:
        'Studies a synthetic receptor family and the functional significance of four example isoforms that exist in model systems and great Professor of Laboratory Medicine, of Immunobiology and of Molecular, Cellular, and Developmental Biology',
    });

    expect(quality.full.isUseful).toBe(false);
    expect(quality.full.flags).toContain('malformed-generated-text');
    expect(quality.short.isUseful).toBe(false);
    expect(quality.short.flags).toContain('malformed-generated-text');
  });

  it('skips broad setup questions when deriving short descriptions from emotional-process prose', () => {
    expect(
      deriveShortDescriptionFromFullDescription(
        'Emotions are at the core of our human experience. Yet much of our emotional lives remains shrouded in mystery. Why do some people experience such a diverse range of emotions? When does culture create a barrier to a mutual understanding of each other’s states? We address questions like these with research focused on the dynamic influences of social, affective, and cultural processes on emotional experience, emotion perception and their downstream consequences for the mind, behavior, and relationships. Employs a multi-method approach, including ambulatory, fieldwork, and lab-based studies using behavioral and physiological methods.',
      ),
    ).toBe(
      'Studies the dynamic influences of social, affective, and cultural processes on emotional experience, emotion perception and their downstream consequences for the mind, behavior, and relationships.',
    );
  });

  it('rejects terminal ellipsis fragments as incomplete source text', () => {
    const quality = assessResearchEntityDescriptionQuality({
      fullDescription:
        "Valen's research interests are in the field of computer and communication networks with emphasis on protocols of wireless systems...",
      shortDescription:
        'Studies the field of computer and communication networks with emphasis on protocols of wireless systems...',
    });

    expect(quality.full.isUseful).toBe(false);
    expect(quality.full.flags).toContain('source-news-fragment');
  });

  it('rejects lower-case news fragments and derives initiative explore summaries', () => {
    expect(
      assessResearchEntityDescriptionQuality({
        fullDescription:
          'research focuses on interstate dynamics, multilateral institutions, and non-state actors to assess how a state action reflects broader trends in statecraft.',
        shortDescription:
          'Studies interstate dynamics, multilateral institutions, and non-state actors to assess how a state action reflects broader trends in statecraft.',
      }).full.flags,
    ).toContain('source-news-fragment');

    expect(
      deriveShortDescriptionFromFullDescription(
        'The Global Prosperity Initiative explores the complexities of global economic prosperity through multidisciplinary research and teaching. It addresses the impacts of economic growth on society and the environment, emphasizing the need for thoughtful policy solutions.',
      ),
    ).toBe(
      'Explores the complexities of global economic prosperity through multidisciplinary research and teaching.',
    );
  });

  it('derives short summaries from combine-to-understand and named-lab explores prose', () => {
    expect(
      deriveShortDescriptionFromFullDescription(
        'Combines experiments with theory to understand the computations organisms perform to navigate chemical environments, and the molecular and cellular circuits that enable them. At the smaller scale we analyze information processing in individual bacteria and neurons.',
      ),
    ).toBe(
      'Studies the computations organisms perform to navigate chemical environments, and the molecular and cellular circuits that enable them by combining experiments with theory.',
    );

    expect(
      deriveShortDescriptionFromFullDescription(
        'The Perception Learning Lab explores human cognition, particularly how we perceive the world, control our attention, and how our experiences shape learning and memory. The lab studies cognition through human behavior, brain activity, and computational models.',
      ),
    ).toBe(
      'Explores human cognition, particularly how we perceive the world, control our attention, and how our experiences shape learning and memory.',
    );
  });

  it('derives short summaries from center verbs and named lab study leads', () => {
    expect(
      deriveShortDescriptionFromFullDescription(
        'The center supports interdisciplinary teaching and research focused on generating actionable knowledge that contributes to the strategic exercise of statecraft.',
      ),
    ).toBe(
      'Supports interdisciplinary teaching and research focused on generating actionable knowledge that contributes to the strategic exercise of statecraft.',
    );

    expect(
      deriveShortDescriptionFromFullDescription(
        'The ILC develops and supports innovative, effective and adaptive leaders to address the most acute and complex challenges facing the world.',
      ),
    ).toBe(
      'Develops and supports innovative, effective and adaptive leaders to address the most acute and complex challenges facing the world.',
    );

    expect(
      deriveShortDescriptionFromFullDescription(
        'The Social Impact Initiative’s mission is to unite policy students passionate about social innovation and impact.',
      ),
    ).toBe('Unites policy students passionate about social innovation and impact.');

    expect(
      deriveShortDescriptionFromFullDescription(
        'The Reasoning Development Lab studies the cognitive processes that underlie how adults and children learn and reason about the world. The lab explores various aspects of cognition, including concept formation, reasoning, and the development of knowledge across different contexts.',
      ),
    ).toBe(
      'Studies the cognitive processes that underlie how adults and children learn and reason about the world.',
    );

    expect(
      deriveShortDescriptionFromFullDescription(
        'My lab focuses on intergroup social cognition. Humans are perhaps the most social species on the planet. My lab addresses this question by studying how knowledge of social groups is acquired, both in cognitively mature adults and in the developing minds of children.',
      ),
    ).toBe('Studies how knowledge of social groups is acquired in adults and children.');

    const conciseSingleSentence = assessResearchEntityDescriptionQuality({
      fullDescription:
        'Fosters research & teaching across disciplines, including computer science, data science, economics, engineering, international relations, law, physics, and political science.',
      shortDescription:
        'Fosters research & teaching across disciplines, including computer science, data science, economics, engineering, international relations, law, physics, and political science.',
    });
    expect(conciseSingleSentence.short.isUseful).toBe(true);

    expect(
      deriveShortDescriptionFromFullDescription(
        "The Humanities Exchange Center is more than a place. It's a center of gravity for the many orbits of research and teaching, creative expression, and scholarly exchange that make up the humanities at Yale University.",
      ),
    ).toBe(
      'Supports research and teaching, creative expression, and scholarly exchange in the humanities at Yale University.',
    );
  });

  it('rejects duplicated page fragments and recruitment boilerplate as full descriptions', () => {
    expect(
      assessResearchEntityDescriptionQuality({
        fullDescription:
          'The focus of the Cutaneous Systems Lab is on the impact of metabolic and environmental factors on the cutaneous immunobiology of the skin in homeostasis and in The focus of the Cutaneous Systems Lab is on the impact of metabolic and environmental factors on the cutaneous immunobiology of the skin in homeostasis and in disequilibrium.',
        shortDescription:
          'The focus of the Cutaneous Systems Lab is on the impact of metabolic and environmental factors on the cutaneous immunobiology of the skin.',
      }).full.flags,
    ).toContain('duplicated-fragment');

    expect(
      assessResearchEntityDescriptionQuality({
        fullDescription:
          'The goal of our laboratory is to bring together chemistry and neuroscience, with the aim of advancing knowledge about normal physiology and developing Thank you for your interest in our laboratory. We are always looking for motivated trainees.',
        shortDescription:
          'The goal of our laboratory is to bring together chemistry and neuroscience.',
      }).full.flags,
    ).toContain('recruitment-boilerplate');
  });

  it('rejects profile biographies, welcome copy, and broken page fragments', () => {
    expect(
      assessResearchEntityDescriptionQuality({
        fullDescription:
          'I am a Professor in the Department of Mathematics at Example University. My research interests lie in geometric analysis and differential geometry, with a particular focus on geometric flows.',
        shortDescription: 'I am a Professor in the Department of Mathematics at Example University.',
      }).full.flags,
    ).toContain('appointment-only');

    expect(
      assessResearchEntityDescriptionQuality({
        fullDescription:
          'Morgan Example, Ph.D., is an associate professor of Public Health, of Global Health, of Economics, and of Faculty of Arts and Sciences at Example University.',
        shortDescription:
          ', is an associate professor of Public Health, of Global Health, and of Economics.',
      }).full.flags,
    ).toContain('appointment-only');

    expect(
      assessResearchEntityDescriptionQuality({
        fullDescription:
          'Riley Example is the Example Professor of Accounting at Example School of Management, where they served as Senior Associate Dean from 1999 to 2005.',
        shortDescription:
          'Riley Example is the Example Professor of Accounting at Example School of Management.',
      }).full.flags,
    ).toContain('appointment-only');

    expect(
      assessResearchEntityDescriptionQuality({
        fullDescription:
          'Previously, I was a visiting fellow in the Department of Statistics at another university. I received my Ph.D. in Applied and Computational Mathematics from a peer institution under the supervision of Professor Example Advisor.',
        shortDescription:
          'Previously, I was a visiting fellow in the Department of Statistics at another university.',
      }).full.flags,
    ).toContain('source-news-fragment');

    expect(
      assessResearchEntityDescriptionQuality({
        fullDescription:
          'Avery studied Chemistry and Molecular Biology at two research universities. During undergraduate study, Avery worked with Example Advisor at an institute. Avery did a PhD with Example Mentor and a post-doc with Example Fellow. Avery established a laboratory at Example University in 2007 where the group investigates the regulatory codes that shape gene expression during embryonic development.',
        shortDescription:
          'Avery studied Chemistry and Molecular Biology at two research universities.',
      }).full.flags,
    ).toContain('source-news-fragment');

    expect(
      assessResearchEntityDescriptionQuality({
        fullDescription:
          'Welcome to the Meridian lab website. You will find information about our research, our publications, the people in the lab, events and seminars, and how to find us.',
        shortDescription:
          'Welcome to the Meridian lab website. You will find information about our research and publications.',
      }).full.flags,
    ).toContain('recruitment-boilerplate');

    expect(
      assessResearchEntityDescriptionQuality({
        fullDescription:
          'S. financial system before World War II. The lab examines how state regulation, bank runs, and liquidity issues influenced financial stability during this period.',
        shortDescription: 'S. financial system and its stability issues before World War II.',
      }).full.flags,
    ).toContain('source-news-fragment');

    expect(
      assessResearchEntityDescriptionQuality({
        fullDescription:
          'Phishing alert: If you received an email about a research internship with me, it is a scam and part of a phishing campaign.',
        shortDescription: '',
      }).full.flags,
    ).toContain('source-news-fragment');

    expect(
      assessResearchEntityDescriptionQuality({
        fullDescription:
          'Rowan’s research interests are in industrial organization and applied microeconomics. Research focuses on search, learning, and matching problems faced by economic agents in settings including natural resource exploration, con.',
        shortDescription:
          'Studies search, learning, and matching problems faced by economic agents in settings including natural resource exploration, con.',
      }).full.flags,
    ).toContain('source-news-fragment');

    expect(
      assessResearchEntityDescriptionQuality({
        fullDescription:
          'News People Projects Publications Opportunities Contact The Fabrication Systems Lab at Example University What We Do About us The natural world is filled with soft, adaptive systems capable of stably and safely interacting with their environme.',
        shortDescription:
          'The Fabrication Systems Lab is a fabrication laboratory at Example University pursuing innovation at the intersection of manufacturing, materials, and robotics.',
      }).full.flags,
    ).toContain('source-news-fragment');

    expect(
      assessResearchEntityDescriptionQuality({
        fullDescription:
          'Welcome to the Quantum Learning Group at Example University. g. ), and the intersection between artificial intelligence and physics (learning theory, optimization and AI4Physics).',
        shortDescription: '',
      }).full.flags,
    ).toContain('malformed-generated-text');
  });

  it('rejects generic department mission prose as research-entity descriptions', () => {
    const quality = assessResearchEntityDescriptionQuality({
      fullDescription:
        'The Department also accomplishes its research mission across all phases of the investigative spectrum from studies in basic biology through investigations in pathophysiology and translating knowledge into new innovations in clinical care, both diagnostic and therapeutic.',
      shortDescription:
        'The Department also accomplishes its research mission across all phases of the investigative spectrum from studies in basic biology through investigations in pathophysiology and translating knowledge into new innovations in clinical care, both diagnostic and therapeutic.',
    });

    expect(quality.full.isUseful).toBe(false);
    expect(quality.full.flags).toContain('generic-lead');
    expect(quality.short.isUseful).toBe(false);
    expect(quality.short.flags).toContain('generic-lead');
  });

  it('rejects paper abstract prose as research entity descriptions', () => {
    const quality = assessResearchEntityDescriptionQuality({
      fullDescription:
        'This paper is a companion to this one in which we introduced the notion of spectral network. In that paper we showed in particular that spectral networks have associated coordinate systems on moduli spaces of flat connections on punctured surfaces C.',
      shortDescription:
        'This paper is a companion to this one in which we introduced the notion of spectral network.',
    });

    expect(quality.full.isUseful).toBe(false);
    expect(quality.full.flags).toContain('paper-fragment');
    expect(quality.short.isUseful).toBe(false);
    expect(quality.short.flags).toContain('paper-fragment');
  });

  it('rejects publication-list snippets as research entity descriptions', () => {
    const quality = assessResearchEntityDescriptionQuality({
      fullDescription:
        'Example University Press (Apr 2025). Essays on Families and Economic History Working Paper. See also related Working Paper drafts on migration and labor markets.',
      shortDescription:
        'Studies families and economic history through working paper drafts on migration and labor markets.',
    });

    expect(quality.full.isUseful).toBe(false);
    expect(quality.full.flags).toContain('paper-fragment');
    expect(quality.short.isUseful).toBe(false);
    expect(quality.short.flags).toContain('paper-fragment');
  });

  it('rejects affiliation-only lab identity text as a description', () => {
    const quality = assessResearchEntityDescriptionQuality({
      fullDescription:
        'The Adaptive Systems Group for Physics of Adaptation, Learning, and Evolution in Biology is part of the Example Center for Systems and Engineering Immunology, the Example QBio institute, and the departments of Immunobiology, Biomedical engineering, and Physics at Example University.',
      shortDescription:
        'The Adaptive Systems Group for Physics of Adaptation, Learning, and Evolution in Biology is part of the Example Center for Systems and Engineering Immunology.',
    });

    expect(quality.full.isUseful).toBe(false);
    expect(quality.full.flags).toContain('generic-lead');
    expect(quality.short.isUseful).toBe(false);
    expect(quality.short.flags).toContain('generic-lead');

    const acronymExpansion = assessResearchEntityDescriptionQuality({
      fullDescription:
        'The Adaptive Systems Group for Physics of Adaptation, Learning, and Evolution in Biology [acronym sbj. to permutation invariance] is part of the Example Center for Systems and Engineering Immunology (CSEI), the Example QBio institute, and the departments of Immunobiology, Biomedical engineering, and Physics at Example University.',
      shortDescription:
        'The Adaptive Systems Group for Physics of Adaptation, Learning, and Evolution in Biology [acronym sbj.',
    });

    expect(acronymExpansion.full.flags).toContain('generic-lead');
    expect(acronymExpansion.short.isUseful).toBe(false);
  });

  it('normalizes first-person lab research copy for browsing summaries', () => {
    const fullDescription =
      'We are interested in how networks of neurons perform computations. In order to dissect the underlying mechanisms, the lab combines behavioral experiments, genetic tools, and computational models.';
    const quality = assessResearchEntityDescriptionQuality({
      fullDescription,
      shortDescription:
        'We are interested in how networks of neurons perform computations. In order to dissect the underlying mechanisms, the lab combines behavioral experiments.',
    });

    expect(quality.full.isUseful).toBe(true);
    expect(quality.short.isUseful).toBe(false);
    expect(quality.short.flags).toContain('first-person');
    expect(deriveShortDescriptionFromFullDescription(fullDescription)).toBe(
      'Studies how networks of neurons perform computations, using behavioral experiments, genetic tools, and computational models.',
    );
  });

  it('flags raw group-voice full descriptions as repair targets', () => {
    const quality = assessResearchEntityDescriptionQuality({
      fullDescription:
        'Our group focuses on using tau leptons to probe for and characterize physics beyond the standard model at a major collider experiment. We are also involved in hunting for signs of new physics at a precision particle experiment.',
      shortDescription:
        'Studies using tau leptons to probe for and characterize physics beyond the standard model at a major collider experiment.',
    });

    expect(quality.full.isUseful).toBe(false);
    expect(quality.full.flags).toContain('first-person');
  });

  it('does not reject engineering profile pages with the lab-description quality gate', () => {
    const quality = assessResearchEntityDescriptionQuality({
      fullDescription:
        'Professor of Applied Physics, Electrical & Computer Engineering and Physics Devon Porter is faculty and a Meridian Lab research leader at Example Engineering. See the campus, culture, and people that make Example Engineering a top-ranked program.',
      shortDescription:
        'Professor of Applied Physics, Electrical & Computer Engineering and Physics Devon Porter is faculty and a Meridian Lab research leader at Example Engineering.',
    });

    expect(quality.full.flags).not.toContain('appointment-only');
    expect(quality.full.flags).not.toContain('source-news-fragment');
    expect(quality.short.flags).not.toContain('appointment-only');
  });

  it('rejects lab page footer chrome and source-voice browsing summaries', () => {
    const footerChrome = assessResearchEntityDescriptionQuality({
      fullDescription:
        'The Data Biology Lab bridges quantitative disciplines like computer science and statistics with molecular biology to tackle practical challenges and analyze large-scale biological data. Below, we outline key areas of our research, all contributing to our overarching mission of interpreting personal genomes and advancing the field of biomedical data science. See lab permissions and copyright statement here.',
      shortDescription:
        'The Data Biology Lab bridges quantitative disciplines like computer science and statistics with molecular biology to tackle practical challenges and analyze large-scale biological data. Our work frequently involves collaboration within multi-disciplinary teams.',
    });

    expect(footerChrome.full.isUseful).toBe(false);
    expect(footerChrome.full.flags).toContain('source-news-fragment');
    expect(footerChrome.short.isUseful).toBe(false);
    expect(footerChrome.short.flags).toEqual(expect.arrayContaining(['first-person', 'full-not-useful']));

    const missionStatement = assessResearchEntityDescriptionQuality({
      fullDescription:
        'Create and communicate high-quality and creative science on the cellular and molecular mechanisms that control tissue biology: development, homeostasis, regeneration, and disease. Our research uses multiple epithelial tissues to explore these scientific interests.',
      shortDescription:
        'Create and communicate high-quality and creative science on the cellular and molecular mechanisms that control tissue biology: development, homeostasis, regeneration, and disease.',
    });

    expect(missionStatement.full.isUseful).toBe(false);
    expect(missionStatement.full.flags).toContain('generic-lead');
    expect(missionStatement.short.isUseful).toBe(false);
    expect(missionStatement.short.flags).toContain('generic-lead');
  });

  it('rejects generated summaries with malformed method joins or homepage welcome copy', () => {
    const malformedMethod = assessResearchEntityDescriptionQuality({
      fullDescription:
        'One of the grand challenges of materials research is the ability to engineer and tune quantum degrees of freedom in order to discover new properties and phenomena. The group uses and develops first principles quantum physics methods to calculate many-electron interaction effects and make predictions about real materials.',
      shortDescription:
        'One of the grand challenges of materials research is the ability to engineer and tune quantum degrees of freedom in order to discover new properties and phenomena, using develops first principles quantum physics methods.',
    });

    expect(malformedMethod.full.isUseful).toBe(true);
    expect(malformedMethod.short.isUseful).toBe(false);
    expect(malformedMethod.short.flags).toContain('malformed-generated-text');

    const repeatedMethodJoin = assessResearchEntityDescriptionQuality({
      fullDescription:
        'The Atomic Materials Group at Example University focuses on advancing atom manipulation techniques at room temperature using electron beams. The group uses chemical vapor deposition and electron beam techniques to synthesize and characterize two-dimensional materials.',
      shortDescription:
        'The Atomic Materials Group at Example University focuses on advancing atom manipulation techniques at room temperature using electron beams, using methods such as chemical vapor deposition and electron beam techniques.',
    });

    expect(repeatedMethodJoin.short.isUseful).toBe(false);
    expect(repeatedMethodJoin.short.flags).toContain('malformed-generated-text');

    const homepageWelcome = assessResearchEntityDescriptionQuality({
      fullDescription:
        'Welcome to the homepage of Atomic Materials Group at Example University, devoted to the advancement of atom manipulation techniques at room temperature using electron beam and the understanding of physical properties of atomic features. The group controls individual atoms by tailoring lattice structures, manipulating atomic species, and exploring physical science related to atomic features.',
      shortDescription:
        'Welcome to the homepage of Atomic Materials Group at Example University, devoted to the advancement of atom manipulation techniques at room temperature using electron beam and the understanding of physical properties of atomic features.',
    });

    expect(homepageWelcome.full.isUseful).toBe(false);
    expect(homepageWelcome.full.flags).toContain('recruitment-boilerplate');
    expect(homepageWelcome.short.isUseful).toBe(false);
    expect(homepageWelcome.short.flags).toContain('recruitment-boilerplate');
  });

  it('rejects visibly truncated source fragments before deriving cards', () => {
    const quality = assessResearchEntityDescriptionQuality({
      fullDescription:
        'Jordan Harlow is a health economist and health services researcher with expertise in using econometric techniques to analyze administrative, registry and electronic health record data to investigate the impacts of public health policie.',
      shortDescription:
        'Studies using econometric techniques to analyze administrative, registry and electronic health record data to investigate the impacts of public health policie.',
    });

    expect(quality.full.isUseful).toBe(false);
    expect(quality.full.flags).toContain('source-news-fragment');
    expect(quality.short.isUseful).toBe(false);
    expect(quality.short.flags).toContain('source-news-fragment');
  });

  it('rejects short descriptions that are too long or copy the full-description lead', () => {
    const quality = assessResearchEntityDescriptionQuality({
      fullDescription:
        'Research endeavors in the Interface Materials Laboratory are motivated by the intriguing properties of surfaces and thin films. Over the years, the group has focused on topics spanning cold-welding between rough metallic surfaces and biological membrane structures. The laboratory applies chemical engineering principles to interfacial phenomena.',
      shortDescription:
        'Research endeavors in the Interface Materials Laboratory are motivated by the intriguing properties of surfaces and thin films. Over the years, the group has focused on topics spanning cold-welding between rough metallic surfaces and biological membrane structures.',
    });

    expect(quality.full.isUseful).toBe(true);
    expect(quality.short.isUseful).toBe(false);
    expect(quality.short.flags).toEqual(expect.arrayContaining(['copied-first-sentence']));
  });

  it('derives a non-copied summary when the second sentence lists methods', () => {
    const fullDescription =
      'Studies the mechanisms by which animals sense odors, tastants, and pheromones, and translate them into behavior. Uses transcriptomics, genome editing, electrophysiology, GC-MS, and optogenetics. Most work uses Drosophila and insects that spread global infectious disease.';

    expect(deriveShortDescriptionFromFullDescription(fullDescription)).toBe(
      'Studies the mechanisms by which animals sense odors, tastants, and pheromones, and translate them into behavior, using transcriptomics, genome editing, electrophysiology, GC-MS, and optogenetics.',
    );
  });

  it('skips generic research-stream setup when deriving a summary', () => {
    const fullDescription =
      'Research focuses on two related research streams. Combines economic theory with experiments and econometrics to develop pricing and market design tools for companies and policy agencies.';

    expect(deriveShortDescriptionFromFullDescription(fullDescription)).toBe(
      'Combines economic theory with experiments and econometrics to develop pricing and market design tools for companies and policy agencies.',
    );
  });

  it('combines research fields and listed interests for economist profile summaries', () => {
    const fullDescription =
      'Research focuses on econometric theory. Research interests include inference under partial identification, inference with weak identification and/or weak instruments, uniformity in asymptotic approximations, stationary and nonstationary time series.';

    expect(deriveShortDescriptionFromFullDescription(fullDescription)).toBe(
      'Studies econometric theory, including inference under partial identification, inference with weak identification and/or weak instruments, uniformity in asymptotic approximations, stationary and nonstationary time series.',
    );
  });

  it('uses a substantive second sentence when economist profile fields are too broad', () => {
    const fullDescription =
      'Research focuses on asset pricing and financial econometrics. Studies issues related to financial machine learning; volatility, tail risk, and correlation modeling in financial markets; banking sector.';

    expect(deriveShortDescriptionFromFullDescription(fullDescription)).toBe(
      'Studies issues related to financial machine learning; volatility, tail risk, and correlation modeling in financial markets; banking sector.',
    );
  });
});
