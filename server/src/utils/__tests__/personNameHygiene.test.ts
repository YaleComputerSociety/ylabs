import { describe, expect, it } from 'vitest';
import {
  isNonNamePersonIdentifier,
  personNameHasNoise,
  personNameNoiseShapes,
  sanitizePersonName,
  stripPersonNameCaptionWrapper,
  stripPersonNameCredentialList,
  stripPersonNameFormerNameAnnotation,
} from '../personNameHygiene';

describe('stripPersonNameCaptionWrapper', () => {
  it('drops an image-caption lead-in and its sentence period', () => {
    expect(stripPersonNameCaptionWrapper('Photo of Ada Byron.')).toBe('Ada Byron');
    expect(stripPersonNameCaptionWrapper('Headshot of Ada Byron')).toBe('Ada Byron');
    expect(stripPersonNameCaptionWrapper('Portrait of Ada Byron.')).toBe('Ada Byron');
  });

  it('leaves a real name alone, including one that starts with a caption word', () => {
    expect(stripPersonNameCaptionWrapper('Ada Byron')).toBe('Ada Byron');
    expect(stripPersonNameCaptionWrapper('Photo Nguyen')).toBe('Photo Nguyen');
  });

  it('keeps the original when stripping would empty the value', () => {
    expect(stripPersonNameCaptionWrapper('Photo of .')).toBe('Photo of .');
  });
});

describe('stripPersonNameCredentialList', () => {
  it('drops a trailing post-nominal credential list after a comma', () => {
    expect(stripPersonNameCredentialList('Ada Byron, PhD, MMath')).toBe('Ada Byron');
    expect(stripPersonNameCredentialList('Ada Byron, DrPH, MSN')).toBe('Ada Byron');
    expect(stripPersonNameCredentialList('Ada Byron, PhD, CNM, FNP , APRN')).toBe('Ada Byron');
    expect(stripPersonNameCredentialList('Ada Byron, M.D.')).toBe('Ada Byron');
  });

  it('keeps a generational suffix and an inverted surname-first name', () => {
    expect(stripPersonNameCredentialList('Ada Byron Jr.')).toBe('Ada Byron Jr.');
    expect(stripPersonNameCredentialList('Ada Byron III')).toBe('Ada Byron III');
    expect(stripPersonNameCredentialList('Byron, Ada')).toBe('Byron, Ada');
  });

  it('requires the comma, so an unseparated post-nominal is left for a human', () => {
    expect(stripPersonNameCredentialList('Janet Ruffing RSM')).toBe('Janet Ruffing RSM');
  });

  it('strips a whitespace-separated run but not a lone lower-cased ambiguous token', () => {
    expect(stripPersonNameCredentialList('Ada Byron, MD PhD')).toBe('Ada Byron');
    expect(stripPersonNameCredentialList('Ada Byron, MS')).toBe('Ada Byron');
    expect(stripPersonNameCredentialList('Byron, Ma')).toBe('Byron, Ma');
  });

  it('strips a credential the vocabulary does not list, by its all-caps shape', () => {
    expect(stripPersonNameCredentialList('Ada Byron, MHA')).toBe('Ada Byron');
    expect(stripPersonNameCredentialList('Ada Byron, MD, PhD, MHA')).toBe('Ada Byron');
    expect(stripPersonNameCredentialList('Ada Byron, PhD, LCSW, LADC')).toBe('Ada Byron');
    expect(stripPersonNameCredentialList('Ada Byron, MPH, CHES')).toBe('Ada Byron');
  });

  it('refuses the all-caps shape rule when it would eat an inverted given name', () => {
    expect(stripPersonNameCredentialList('BYRON, ADA')).toBe('BYRON, ADA');
    expect(stripPersonNameCredentialList('DE LA CRUZ, MARIA')).toBe('DE LA CRUZ, MARIA');
    expect(stripPersonNameCredentialList('DE LA CRUZ, MARIA JOSE')).toBe('DE LA CRUZ, MARIA JOSE');
    expect(stripPersonNameCredentialList('Van Buren, MARTIN')).toBe('Van Buren, MARTIN');
    expect(stripPersonNameCredentialList('Fernandez de la Mora, JUAN')).toBe(
      'Fernandez de la Mora, JUAN',
    );
  });

  it('keeps a generational suffix printed after a comma', () => {
    expect(stripPersonNameCredentialList('Ada Byron, III')).toBe('Ada Byron, III');
    expect(stripPersonNameCredentialList('Ada Byron, JR.')).toBe('Ada Byron, JR.');
    expect(stripPersonNameCredentialList('Ada Byron, SR')).toBe('Ada Byron, SR');
  });

  it('strips a hyphenated initialism and a class year printed with the degree', () => {
    expect(stripPersonNameCredentialList('Ada Byron, PhD, PA-C')).toBe('Ada Byron');
    expect(stripPersonNameCredentialList("Ada Byron, MD '90")).toBe('Ada Byron');
  });
});

describe('stripPersonNameFormerNameAnnotation', () => {
  it('drops a former-name annotation', () => {
    expect(stripPersonNameFormerNameAnnotation('Ada Lovelace f.k.a. Byron')).toBe('Ada Lovelace');
    expect(stripPersonNameFormerNameAnnotation('Ada Lovelace formerly Byron')).toBe('Ada Lovelace');
    expect(stripPersonNameFormerNameAnnotation('Ada Lovelace née Byron')).toBe('Ada Lovelace');
  });

  it('leaves a real name alone', () => {
    expect(stripPersonNameFormerNameAnnotation('Ada Lovelace')).toBe('Ada Lovelace');
  });
});

describe('isNonNamePersonIdentifier', () => {
  it('recognizes a directory slug and an email local part', () => {
    expect(isNonNamePersonIdentifier('byron_ada')).toBe(true);
    expect(isNonNamePersonIdentifier('ada.byron')).toBe(true);
  });

  it('does not treat a real name as an identifier', () => {
    expect(isNonNamePersonIdentifier('Ada Byron')).toBe(false);
    expect(isNonNamePersonIdentifier("Gail D'Onofrio")).toBe(false);
    expect(isNonNamePersonIdentifier('Ada J. Byron')).toBe(false);
    expect(isNonNamePersonIdentifier('Byron')).toBe(false);
  });
});

describe('sanitizePersonName', () => {
  it('cleans every shape at once and fixes the casing', () => {
    expect(sanitizePersonName('Photo of ADA BYRON.')).toBe('Ada Byron');
    expect(sanitizePersonName('  ADA   BYRON, PhD, MPH  ')).toBe('Ada Byron');
    expect(sanitizePersonName('Ada Lovelace f.k.a. Byron, PhD')).toBe('Ada Lovelace');
  });

  it('preserves the tokens a name is allowed to keep', () => {
    expect(sanitizePersonName('Ada Byron Jr.')).toBe('Ada Byron Jr.');
    expect(sanitizePersonName("Gail D'Onofrio")).toBe("Gail D'Onofrio");
    expect(sanitizePersonName('Alex Cantó-Pastor')).toBe('Alex Cantó-Pastor');
    expect(sanitizePersonName('Juan Fernandez de la Mora')).toBe('Juan Fernandez de la Mora');
    expect(sanitizePersonName('Ada Byron, MD PhD')).toBe('Ada Byron');
  });

  it('title-cases a wholly shouty name but leaves a deliberate capitalization alone', () => {
    expect(sanitizePersonName('MOHAMMAD ISLAMUL HAQUE')).toBe('Mohammad Islamul Haque');
    expect(sanitizePersonName('IMRAN IQBAL')).toBe('Imran Iqbal');
    // A trailing short all-caps token on an otherwise mixed-case name is a
    // post-nominal or a deliberately capitalized surname, never shouting.
    expect(sanitizePersonName('Janet K. Ruffing RSM')).toBe('Janet K. Ruffing RSM');
    expect(sanitizePersonName('Nguyen Minh Thu PHAM')).toBe('Nguyen Minh Thu PHAM');
  });

  it('never re-cases a credential run the strip rules declined', () => {
    // The casing pass stops at the first comma, so a credential the vocabulary
    // does not list and the shape rule cannot reach is left verbatim rather than
    // mangled into 'Lpc' or 'Dtm&H'.
    expect(sanitizePersonName('Bonitz Moore Atr-BC, LPC, Iecmh-E, Heather')).toBe(
      'Bonitz Moore Atr-BC, LPC, Iecmh-E, Heather',
    );
    expect(sanitizePersonName('Theddeus Iheanacho, MBBS, DTM&H')).toBe(
      'Theddeus Iheanacho, MBBS, DTM&H',
    );
  });

  it('lowercases a shouting surname particle', () => {
    expect(sanitizePersonName('ROBIN DE GRAAF')).toBe('Robin de Graaf');
    expect(sanitizePersonName('PIETER VAN DOKKUM')).toBe('Pieter van Dokkum');
    expect(sanitizePersonName('DE GRAAF')).toBe('de Graaf');
  });

  it('leaves a leading particle that is equally a given name capitalized', () => {
    expect(sanitizePersonName('AL GORE')).toBe('AL Gore');
    expect(sanitizePersonName('DI STEFANO ROSSI')).toBe('DI Stefano Rossi');
  });

  it('de-shouts a token that carries punctuation, as the inverted form does', () => {
    expect(sanitizePersonName('BYRON, ADA')).toBe('Byron, Ada');
    expect(sanitizePersonName('SMITH, JOHN A.')).toBe('Smith, John A.');
    expect(sanitizePersonName('DE LA CRUZ, MARIA')).toBe('de la Cruz, Maria');
    expect(sanitizePersonName("O'BRIEN, MARY")).toBe("O'Brien, Mary");
  });

  it('leaves an accented shouty run alone, as the casing rule always has', () => {
    expect(sanitizePersonName('ALEX CANTÓ-PASTOR')).toBe('Alex CANTÓ-Pastor');
  });

  it('refuses a value that is an identifier rather than a name', () => {
    expect(sanitizePersonName('byron_ada')).toBeUndefined();
    expect(sanitizePersonName('ada.byron')).toBeUndefined();
    expect(sanitizePersonName('   ')).toBeUndefined();
    expect(sanitizePersonName(undefined)).toBeUndefined();
  });
});

describe('personNameNoiseShapes', () => {
  it('names each shape it found', () => {
    expect(personNameNoiseShapes('Photo of Ada Byron.')).toEqual(['caption-wrapper']);
    expect(personNameNoiseShapes('Ada Byron, PhD')).toEqual(['credential-list']);
    expect(personNameNoiseShapes('ADA BYRON')).toEqual(['shouty-casing']);
    expect(personNameNoiseShapes('byron_ada')).toEqual(['non-name-identifier']);
    expect(personNameNoiseShapes('Photo of ADA BYRON, PhD.')).toEqual([
      'caption-wrapper',
      'credential-list',
      'shouty-casing',
    ]);
  });

  it('reports nothing for a clean name', () => {
    expect(personNameNoiseShapes('Ada Byron')).toEqual([]);
    expect(personNameHasNoise('Ada Byron')).toBe(false);
    expect(personNameHasNoise('Ada Byron, PhD')).toBe(true);
  });
});
