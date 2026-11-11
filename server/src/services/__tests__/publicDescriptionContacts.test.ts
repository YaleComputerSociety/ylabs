import { describe, expect, it } from 'vitest';
import { sanitizeObservationField } from '../../scrapers/observationFieldSanitizer';
import { sanitizeProjectedField } from '../../scrapers/entityMaterializer';
import { coverageSynthesisDecision } from '../../scrapers/coverageSynthesis';
import { groundDescriptionExtraction } from '../../scrapers/sources/labMicrositeDescriptionLLMExtractor';
import { redactFailureTailLine } from '../../scripts/scraperSweepLogging';
import { sanitizeLogValue } from '../../utils/logSanitizer';
import { redactContactsAbsentFrom } from '../../utils/contactRedaction';
import { proseWithPageContactsRestored } from '../../utils/quotedContactRestoration';
import {
  sanitizeResearchEntityDescription,
  sanitizeResearchEntityShortDescription,
} from '../../utils/descriptionHygiene';
import { toPublicResearchEntityDto } from '../researchEntityDto';
import { buildResearchEntitySearchIndexDocument } from '../researchEntitySearchIndexService';

const EMAIL = 'tidepool-lab@example.edu';
const PHONE = '203-555-0187';
const FULL = `The Tidepool Lab studies how coastal kelp forests recover after marine heatwaves. Prospective students can write to ${EMAIL} or call ${PHONE} to ask about joining.`;
const SHORT = `Studies how coastal kelp forests recover after marine heatwaves; email ${EMAIL}.`;

describe('a public description keeps the contacts its page publishes (#5046)', () => {
  it('is stored with them at ingest and at projection', () => {
    expect(sanitizeObservationField('researchEntity', 'fullDescription', FULL).value).toBe(FULL);
    expect(sanitizeObservationField('researchEntity', 'shortDescription', SHORT).value).toBe(SHORT);
    expect(sanitizeProjectedField('researchEntity', 'fullDescription', FULL)).toBe(FULL);
  });

  it('is sanitized for serving with them intact', () => {
    expect(sanitizeResearchEntityDescription(FULL)).toBe(FULL);
    expect(sanitizeResearchEntityShortDescription(SHORT)).toBe(SHORT);
  });

  it('is served and indexed with them intact', () => {
    const row = {
      id: 'entity-tidepool-contacts',
      slug: 'tidepool-contacts-lab',
      name: 'Tidepool Lab',
      shortDescription: SHORT,
      fullDescription: FULL,
      archived: false,
    };
    const dto = toPublicResearchEntityDto(row);
    expect(dto.fullDescription).toBe(FULL);
    expect(dto.shortDescription).toBe(SHORT);
    const doc = buildResearchEntitySearchIndexDocument({ _id: row.id, ...row });
    expect(doc?.fullDescription).toBe(FULL);
    expect(doc?.shortDescription).toBe(SHORT);
  });

  it('restores the contacts a verbatim model extraction copied as placeholders', () => {
    const page = `Welcome. ${FULL} Footer text.`;
    const redacted = FULL.replace(EMAIL, '[email redacted]').replace(PHONE, '[phone redacted]');
    expect(proseWithPageContactsRestored(redacted, page)).toBe(FULL);
    const grounded = groundDescriptionExtraction(
      { fullDescription: redacted, shortDescription: '', subject: 'named_entity' } as never,
      page,
    );
    expect(grounded.fullDescription).toBe(FULL);
  });

  it('lets a written body repeat a contact from its evidence but never introduce one', async () => {
    expect(redactContactsAbsentFrom(`Write to ${EMAIL} or other@example.edu.`, [FULL])).toBe(
      `Write to ${EMAIL} or [email redacted].`,
    );
    const decision = await coverageSynthesisDecision({
      snippets: [{ text: FULL, sourceName: 'research-page-text' }],
      entityName: 'Tidepool Lab',
      callLLM: async () => ({
        fullDescription: `Studies how coastal kelp forests recover after marine heatwaves. Prospective students can write to ${EMAIL} to ask about joining.`,
        usedSnippetIndexes: [0],
      }),
    });
    expect(decision.result?.description).toContain(EMAIL);
  });
});

describe('non-public text keeps redacting (#5046)', () => {
  it('redacts contacts in log lines', () => {
    expect(sanitizeLogValue(`failed for ${EMAIL}`)).not.toContain(EMAIL);
    const tail = redactFailureTailLine(`row failed: call ${PHONE} or write ${EMAIL}`);
    expect(tail).not.toContain(EMAIL);
    expect(tail).not.toContain(PHONE);
  });
});
