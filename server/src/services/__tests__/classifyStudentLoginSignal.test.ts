import { describe, expect, it } from 'vitest';
import { classifyStudentLoginSignal } from '../yaliesService';

const undergrad = { school_code: 'YC', year: 2028 };
const graduate = { school_code: 'GS', year: 2027 };

describe('classifyStudentLoginSignal', () => {
  it('reads a stated major as usable', () => {
    expect(classifyStudentLoginSignal({ ...undergrad, major: 'Synthetic Studies' })).toBe(
      'undergrad_usable_major',
    );
  });

  it('reads the first non-empty entry when the major arrives as a list', () => {
    expect(classifyStudentLoginSignal({ ...undergrad, major: ['', 'Synthetic Studies'] })).toBe(
      'undergrad_usable_major',
    );
  });

  it('reads the literal Undeclared value apart from a missing major', () => {
    expect(classifyStudentLoginSignal({ ...undergrad, major: 'Undeclared' })).toBe(
      'undergrad_undeclared',
    );
    expect(classifyStudentLoginSignal({ ...undergrad, major: ' undeclared ' })).toBe(
      'undergrad_undeclared',
    );
  });

  it('reads an empty, blank or hidden major as no major', () => {
    expect(classifyStudentLoginSignal({ ...undergrad })).toBe('undergrad_no_major');
    expect(classifyStudentLoginSignal({ ...undergrad, major: '' })).toBe('undergrad_no_major');
    expect(classifyStudentLoginSignal({ ...undergrad, major: '   ' })).toBe('undergrad_no_major');
    expect(classifyStudentLoginSignal({ ...undergrad, major: null })).toBe('undergrad_no_major');
    expect(classifyStudentLoginSignal({ ...undergrad, major: [] })).toBe('undergrad_no_major');
  });

  it('reads a student on leave or visiting as carrying no usable signal, whatever the major', () => {
    expect(
      classifyStudentLoginSignal({ ...undergrad, leave: true, major: 'Synthetic Studies' }),
    ).toBe('undergrad_leave_or_visitor');
    expect(classifyStudentLoginSignal({ ...undergrad, visitor: true })).toBe(
      'undergrad_leave_or_visitor',
    );
  });

  it('reads a graduate or professional record by its curriculum', () => {
    expect(classifyStudentLoginSignal({ ...graduate, curriculum: 'Synthetic Program' })).toBe(
      'grad_with_curriculum',
    );
    expect(classifyStudentLoginSignal({ ...graduate })).toBe('grad_without_curriculum');
    expect(classifyStudentLoginSignal({ ...graduate, major: 'Synthetic Studies' })).toBe(
      'grad_without_curriculum',
    );
  });
});
