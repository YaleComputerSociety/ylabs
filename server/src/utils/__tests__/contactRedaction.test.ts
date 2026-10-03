import { describe, expect, it } from 'vitest';
import { redactDirectContactInfo } from '../contactRedaction';

const PHONE = '[phone redacted]';

describe('redactDirectContactInfo phone arm', () => {
  it.each([
    ['Contact: 555-010-0000 for details', `Contact: ${PHONE} for details`],
    ['Tel.555.010.0001', `Tel.${PHONE}`],
    ['Phone: (555) 010-0002', `Phone: ${PHONE}`],
    ['call +1 555 010 0003 today', `call ${PHONE} today`],
    ['call 1-555-010-0004 today', `call ${PHONE} today`],
    ['dial 5550100005.', `dial ${PHONE}.`],
  ])('redacts a phone number set off by spaces or punctuation: %s', (input, expected) => {
    expect(redactDirectContactInfo(input)).toBe(expected);
  });

  it.each([
    ['Phone555-010-0006 for details', `Phone${PHONE} for details`],
    ['office x555-010-0007', `office x${PHONE}`],
    ['Tel555.010.0008', `Tel${PHONE}`],
    ['Phone(555) 010-0009', `Phone${PHONE}`],
    ['Phone5550100016 for details', `Phone${PHONE} for details`],
    ['Tel5550100017', `Tel${PHONE}`],
    ['office x5550100018', `office x${PHONE}`],
    ['Ph5550100022', `Ph${PHONE}`],
    ['Office5550100023 for details', `Office${PHONE} for details`],
    ['Main5550100024', `Main${PHONE}`],
    ['Voice5550100025', `Voice${PHONE}`],
    ['phone number5550100026', `phone number${PHONE}`],
  ])('redacts a phone number glued to the letters before it: %s', (input, expected) => {
    expect(redactDirectContactInfo(input)).toBe(expected);
  });

  it.each([
    ['call 555-010-0010Email us', `call ${PHONE}Email us`],
    ['555.010.0011Fax', `${PHONE}Fax`],
    ['call 5550100019Fax', `call ${PHONE}Fax`],
  ])('redacts a phone number glued to the letters after it: %s', (input, expected) => {
    expect(redactDirectContactInfo(input)).toBe(expected);
  });

  it('redacts a phone number glued on both sides', () => {
    expect(redactDirectContactInfo('Phone555.010.0012Fax555.010.0013Office')).toBe(
      `Phone${PHONE}Fax${PHONE}Office`,
    );
  });

  it.each([
    ['NIH grant R01GM123456', 'NIH grant R01GM123456'],
    ['award 5R01CA123456-03', 'award 5R01CA123456-03'],
    ['NSF award 2045678', 'NSF award 2045678'],
    ['contract HHSN272201400008C', 'contract HHSN272201400008C'],
    ['trial NCT01234567', 'trial NCT01234567'],
    ['record 55501000001234', 'record 55501000001234'],
    ['id A555010001499Z', 'id A555010001499Z'],
    ['PMID 12345678', 'PMID 12345678'],
    ['IRB ID5550100020Role Sub Investigator', 'IRB ID5550100020Role Sub Investigator'],
    ['PNAS 2020, e5550100021.', 'PNAS 2020, e5550100021.'],
  ])('leaves a grant number or record id alone: %s', (input, expected) => {
    expect(redactDirectContactInfo(input)).toBe(expected);
  });

  it.each([
    ['funded 1998-2003 and 2010-2015', 'funded 1998-2003 and 2010-2015'],
    ['the 2019-2020 academic year', 'the 2019-2020 academic year'],
    ['since 2004, 2012 and 2020', 'since 2004, 2012 and 2020'],
  ])('leaves years and year ranges alone: %s', (input, expected) => {
    expect(redactDirectContactInfo(input)).toBe(expected);
  });

  it.each([
    ['ORCID 9999-9000-9999-9005', 'ORCID 9999-9000-9999-9005'],
    ['orcid.org/9999-9001-9999-999X', 'orcid.org/9999-9001-9999-999X'],
    ['doi:10.1038/s41586-020-2649-2', 'doi:10.1038/s41586-020-2649-2'],
  ])('leaves ORCID-like ids and DOIs alone: %s', (input, expected) => {
    expect(redactDirectContactInfo(input)).toBe(expected);
  });
});

describe('redactDirectContactInfo email arm', () => {
  it('redacts an email address', () => {
    expect(redactDirectContactInfo('Email someone@example.edu today')).toBe(
      'Email [email redacted] today',
    );
  });
});

const EMAIL = '[email redacted]';

describe('redactDirectContactInfo obfuscated email arm', () => {
  it.each([
    ['Contact jdoe [at] example [dot] edu', `Contact ${EMAIL}`],
    ['Contact jdoe(at)example(dot)edu', `Contact ${EMAIL}`],
    ['Contact jdoe at example dot edu', `Contact ${EMAIL}`],
    ['Contact jdoe＠example.edu', `Contact ${EMAIL}`],
    ['Contact jdoe&#64;example.edu', `Contact ${EMAIL}`],
    ['Contact jdoe&commat;example.edu', `Contact ${EMAIL}`],
    ['Contact jdoe @ example.edu', `Contact ${EMAIL}`],
    ['Write to JDOE AT CS DOT EXAMPLE DOT EDU.', `Write to ${EMAIL}.`],
    ['jdoe {at} example {.} org today', `${EMAIL} today`],
    ['jdoe [at] example.edu today', `${EMAIL} today`],
    ['jdoe at cs.example dot edu today', `${EMAIL} today`],
  ])('redacts an obfuscated address: %s', (input, expected) => {
    expect(redactDirectContactInfo(input)).toBe(expected);
  });

  it.each([
    'We work at the lab every day.',
    'Code is available at github.com for review.',
    'The dot com bubble shaped the field.',
    'Students invested at the dot com peak.',
    'Meet at 5 pm in the lab.',
    'Students at the school study at the institute.',
    'Follow us @examplelab on social media.',
    'Find us on Bluesky @examplelab.bsky.social today.',
    'Systems that run C [at] scale.',
    'A professor at the university dot',
  ])('leaves ordinary prose alone: %s', (input) => {
    expect(redactDirectContactInfo(input)).toBe(input);
  });
});
