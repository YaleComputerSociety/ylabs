import { describe, expect, it } from 'vitest';
import {
  FALLBACK_FOLLOW_UP_EMAIL_SUBJECT,
  FALLBACK_INTRO_EMAIL_SUBJECT,
  STUDENT_FOLLOW_UP_EMAIL_TEMPLATE_VERSION,
  STUDENT_INTRO_EMAIL_TEMPLATE_VERSION,
  composeStudentFollowUpEmailDraft,
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
});

describe('composeStudentFollowUpEmailDraft', () => {
  it('composes an honest follow-up naming the lead and entity', () => {
    const draft = composeStudentFollowUpEmailDraft({
      entityName: 'Example Lab',
      leadName: 'Jane Doe',
    });

    expect(draft.subject).toBe('Following up: interest in undergraduate research with Example Lab');
    expect(draft.body).toContain('Dear Jane Doe,');
    expect(draft.body).toContain('I recently reached out');
    expect(draft.generatedByPlatform).toBe(true);
    expect(draft.templateVersion).toBe(STUDENT_FOLLOW_UP_EMAIL_TEMPLATE_VERSION);
  });

  it('never implies the recipient did or did not read the first email', () => {
    const draft = composeStudentFollowUpEmailDraft({ entityName: 'Example Lab' });
    const body = draft.body.toLowerCase();

    expect(body).not.toContain('read');
    expect(body).not.toContain('ignore');
    expect(body).not.toContain('no response');
    expect(body).not.toContain("didn't");
    expect(body).not.toContain('did not');
    expect(draft.body).toContain('Hello,');
  });

  it('fails closed to the generic subject with no body when the entity name is missing', () => {
    const draft = composeStudentFollowUpEmailDraft({ leadName: 'Jane Doe' });

    expect(draft).toEqual({
      subject: FALLBACK_FOLLOW_UP_EMAIL_SUBJECT,
      body: '',
      generatedByPlatform: false,
      templateVersion: '',
    });
  });

  it('fails closed when a composed field would exceed the safe mailto length caps', () => {
    const draft = composeStudentFollowUpEmailDraft({ entityName: 'x'.repeat(1000) });

    expect(draft.generatedByPlatform).toBe(false);
    expect(draft.subject.length).toBeLessThanOrEqual(MAX_SAFE_MAILTO_SUBJECT_LENGTH);
    expect(draft.body.length).toBeLessThanOrEqual(MAX_SAFE_MAILTO_BODY_LENGTH);
  });
});
