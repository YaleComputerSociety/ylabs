import { describe, expect, it } from 'vitest';
import {
  FALLBACK_INTRO_EMAIL_SUBJECT,
  STUDENT_INTRO_EMAIL_TEMPLATE_VERSION,
  composeStudentIntroEmailDraft,
} from '../introEmailComposer';
import { MAX_SAFE_MAILTO_BODY_LENGTH, MAX_SAFE_MAILTO_SUBJECT_LENGTH } from '../url';

describe('composeStudentIntroEmailDraft', () => {
  it('composes a subject and body naming the lead, entity, and top research areas', () => {
    const draft = composeStudentIntroEmailDraft({
      entityName: 'Example Lab',
      leadName: 'Jane Doe',
      researchAreas: ['Machine Learning', 'Computer Vision', 'Robotics'],
    });

    expect(draft.subject).toBe('Interest in undergraduate research with Example Lab');
    expect(draft.body).toContain('Dear Jane Doe,');
    expect(draft.body).toContain('Example Lab');
    expect(draft.body).toContain('Machine Learning and Computer Vision');
    expect(draft.body).not.toContain('Robotics');
    expect(draft.generatedByPlatform).toBe(true);
    expect(draft.templateVersion).toBe(STUDENT_INTRO_EMAIL_TEMPLATE_VERSION);
  });

  it('falls back to a generic greeting when no lead name is available', () => {
    const draft = composeStudentIntroEmailDraft({ entityName: 'Example Lab' });

    expect(draft.body).toContain('Hello,');
    expect(draft.body).not.toContain('undefined');
    expect(draft.generatedByPlatform).toBe(true);
  });

  it('omits the research-areas phrase entirely when none are given', () => {
    const draft = composeStudentIntroEmailDraft({ entityName: 'Example Lab', leadName: 'Jane Doe' });

    expect(draft.body).toContain('research opportunities with Example Lab');
  });

  it('fails closed to the generic subject with no body when the entity name is missing', () => {
    const draft = composeStudentIntroEmailDraft({ leadName: 'Jane Doe' });

    expect(draft).toEqual({
      subject: FALLBACK_INTRO_EMAIL_SUBJECT,
      body: '',
      generatedByPlatform: false,
      templateVersion: '',
    });
  });

  it('fails closed when a composed field would exceed the safe mailto length caps', () => {
    const draft = composeStudentIntroEmailDraft({ entityName: 'x'.repeat(1000) });

    expect(draft.generatedByPlatform).toBe(false);
    expect(draft.subject).toBe(FALLBACK_INTRO_EMAIL_SUBJECT);
    expect(draft.subject.length).toBeLessThanOrEqual(MAX_SAFE_MAILTO_SUBJECT_LENGTH);
    expect(draft.body.length).toBeLessThanOrEqual(MAX_SAFE_MAILTO_BODY_LENGTH);
  });

  it('never fabricates claims beyond the fields it was given', () => {
    const draft = composeStudentIntroEmailDraft({ entityName: '  Example Lab  ', leadName: '   ' });

    expect(draft.body).toContain('Hello,');
    expect(draft.body).not.toContain('  Example Lab  ');
    expect(draft.subject).toBe('Interest in undergraduate research with Example Lab');
  });

  it('never emits placeholder-name tokens in the drafted body', () => {
    const draft = composeStudentIntroEmailDraft({
      entityName: 'Example Lab',
      leadName: 'Jane Doe',
      researchAreas: ['Machine Learning'],
    });

    expect(draft.body).not.toMatch(/\[[^\]]*\]/);
    expect(draft.body).not.toContain('Your Name');
    expect(draft.body).toContain('I am a Yale undergraduate');
  });

  it('drops fields carrying placeholder or redaction artifacts and fails closed when the entity name is one', () => {
    const withPlaceholderLead = composeStudentIntroEmailDraft({
      entityName: 'Example Lab',
      leadName: '[redacted]',
      researchAreas: ['<script>', '{{topic}}', 'Genomics'],
    });

    expect(withPlaceholderLead.generatedByPlatform).toBe(true);
    expect(withPlaceholderLead.body).toContain('Hello,');
    expect(withPlaceholderLead.body).toContain('in Genomics');
    expect(withPlaceholderLead.body).not.toMatch(/\[[^\]]*\]|\{\{|<[^>]+>|redacted/i);

    const withPlaceholderEntity = composeStudentIntroEmailDraft({ entityName: '[unknown]' });
    expect(withPlaceholderEntity.generatedByPlatform).toBe(false);
    expect(withPlaceholderEntity.subject).toBe(FALLBACK_INTRO_EMAIL_SUBJECT);
  });

  it('derives the closing ask from the best next step when present', () => {
    const credit = composeStudentIntroEmailDraft({
      entityName: 'Example Lab',
      bestNextStep: 'Ask about credit or thesis expectations after finding a mentor',
    });
    expect(credit.body).toContain('research credit or a senior project');

    const funding = composeStudentIntroEmailDraft({
      entityName: 'Example Lab',
      bestNextStep: 'Ask about funding after finding a mentor',
    });
    expect(funding.body).toContain('funded or fellowship-supported roles');

    const availability = composeStudentIntroEmailDraft({
      entityName: 'Example Lab',
      bestNextStep: 'Reach out to confirm current availability',
    });
    expect(availability.body).toContain('currently taking on undergraduate researchers');

    const generic = composeStudentIntroEmailDraft({
      entityName: 'Example Lab',
      bestNextStep: 'Reach out to ask about opportunities',
    });
    expect(generic.body).toContain('whether there might be a way for me to get involved.');
    expect(generic.body).not.toContain('research credit');
  });
});
