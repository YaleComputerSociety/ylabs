import type {
  OfficialRosterConfig,
  OfficialRosterUndergraduate,
} from '../scrapers/sources/officialResearchHomeRosterScraper';
import type { UndergradRosterProposal } from '../scrapers/undergradRosterDerivation';

export {
  isProposableSectionLabel,
  labSitePageLinks,
  proposeUndergradRosterConfig,
  type LabSitePageLinks,
  type UndergradRosterProposal,
  type UndergradRosterProposalOutcome,
} from '../scrapers/undergradRosterDerivation';

const memberLine = (member: OfficialRosterUndergraduate): string => {
  const years =
    member.status === 'current'
      ? member.startYear
        ? ` (${member.startYear} - present)`
        : ''
      : member.startYear && member.endYear && member.startYear !== member.endYear
        ? ` (${member.startYear} - ${member.endYear})`
        : member.endYear || member.startYear
          ? ` (${member.endYear ?? member.startYear})`
          : '';
  return `${member.name}${years}${member.profileUrl ? ' [profile]' : ''}`;
};

const quotedLabels = (labels: string[] | undefined): string =>
  labels && labels.length > 0 ? labels.map((label) => `"${label}"`).join(', ') : 'none';

export function renderUndergradRosterReviewSheet(proposals: UndergradRosterProposal[]): string {
  const lines = [
    '# Undergraduate roster review',
    '',
    'Each lab below would list these undergraduates by name on its detail page.',
    'Check each against its page: are these people undergraduates in this lab, is anyone missing or extra, and is current versus past right?',
    'Reply with the numbers to approve, or "all except" the numbers to reject.',
    '',
  ];
  for (const proposal of proposals) {
    const { config } = proposal;
    lines.push(
      `## ${proposal.id}. ${proposal.researchEntityKey}`,
      '',
      `- Page: ${config.url}`,
      `- Layout: ${config.template}${config.currency === 'section-label' ? ' (publish date not required)' : ''}`,
      `- Current headings: ${quotedLabels(config.currentSectionLabels)}`,
      `- Past headings: ${quotedLabels(config.pastSectionLabels)}`,
      `- Other current members linked from the same headings: ${proposal.otherCurrentMembers}`,
      `- Entries refused as not a name: ${proposal.undergraduateWithheldCount}`,
      '',
      `Current undergraduates (${proposal.current.length}):`,
      ...(proposal.current.length > 0
        ? proposal.current.map((m) => `- ${memberLine(m)}`)
        : ['- none']),
      '',
      `Past undergraduates (${proposal.past.length}):`,
      ...(proposal.past.length > 0 ? proposal.past.map((m) => `- ${memberLine(m)}`) : ['- none']),
      '',
    );
  }
  return `${lines.join('\n')}\n`;
}

export function officialRosterConfigSource(configs: OfficialRosterConfig[]): string {
  return configs
    .map((config) => {
      const fields = [
        `    researchEntityKey: ${JSON.stringify(config.researchEntityKey)},`,
        `    url: ${JSON.stringify(config.url)},`,
        ...(config.template ? [`    template: ${JSON.stringify(config.template)},`] : []),
        ...(config.currency ? [`    currency: ${JSON.stringify(config.currency)},`] : []),
        `    currentSectionLabels: ${JSON.stringify(config.currentSectionLabels)},`,
        ...(config.pastSectionLabels && config.pastSectionLabels.length > 0
          ? [`    pastSectionLabels: ${JSON.stringify(config.pastSectionLabels)},`]
          : []),
        ...(config.withheldNames && config.withheldNames.length > 0
          ? [`    withheldNames: ${JSON.stringify(config.withheldNames)},`]
          : []),
        ...(config.pastNames && config.pastNames.length > 0
          ? [`    pastNames: ${JSON.stringify(config.pastNames)},`]
          : []),
      ];
      return `  {\n${fields.join('\n')}\n  },`;
    })
    .join('\n');
}
