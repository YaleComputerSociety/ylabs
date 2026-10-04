import { describe, expect, it } from 'vitest';
import {
  isFacultyTitle,
  isStudentTitle,
  ownsNoResearchEntityByTitle,
} from '../yaleDirectoryScraper';

describe('isStudentTitle', () => {
  it('reads each spelling a degree programme gives its students and graduates', () => {
    for (const title of [
      'Ph.D. Student',
      'PhD Student',
      'Graduate School Student',
      'IDE Student',
      'IDE Alumni',
      "Master's Student",
    ]) {
      expect(isStudentTitle(title)).toBe(true);
      expect(ownsNoResearchEntityByTitle(title)).toBe(true);
    }
  });

  it('does not read an appointment as a student title', () => {
    for (const title of [
      'Professor of Economics',
      'Lecturer',
      'Alumni Professor of History',
      'Postdoctoral Associate',
    ]) {
      expect(isStudentTitle(title)).toBe(false);
    }
  });

  it('leaves the faculty classifier unchanged for a professorship', () => {
    expect(isFacultyTitle('Professor of Economics')).toBe(true);
    expect(ownsNoResearchEntityByTitle('Professor of Economics')).toBe(false);
  });
});
