import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import AdminFellowshipEditModal from '../AdminFellowshipEditModal';
import type { Fellowship } from '../../../types/types';

vi.mock('../../../utils/axios', () => ({ default: { put: vi.fn(), delete: vi.fn() } }));
vi.mock('sweetalert', () => ({ default: vi.fn(() => Promise.resolve(true)) }));

const fellowship = {
  id: 'f1',
  title: 'Synthetic Fellowship',
  isAcceptingApplications: true,
  archived: false,
  yearOfStudy: ['Senior'],
} as unknown as Fellowship;

describe('AdminFellowshipEditModal', () => {
  it('names each tag remove button after the value it removes', () => {
    render(<AdminFellowshipEditModal fellowship={fellowship} onClose={vi.fn()} onSave={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove Senior from Year of Study' }));

    expect(screen.queryByRole('button', { name: 'Remove Senior from Year of Study' })).toBeNull();
  });

  it('names the close button after the editor it closes', () => {
    const onClose = vi.fn();
    render(<AdminFellowshipEditModal fellowship={fellowship} onClose={onClose} onSave={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Close fellowship editor' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
