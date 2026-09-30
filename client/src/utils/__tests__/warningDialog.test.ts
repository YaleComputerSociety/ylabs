import { afterEach, describe, expect, it, vi } from 'vitest';

import { showWarningDialog } from '../warningDialog';

const { swal, dialogChunk } = vi.hoisted(() => ({
  swal: vi.fn(),
  dialogChunk: { fails: false },
}));

vi.mock('sweetalert', () => ({
  get default() {
    if (dialogChunk.fails) throw new Error('synthetic chunk load failure');
    return swal;
  },
}));

afterEach(() => {
  dialogChunk.fails = false;
  vi.restoreAllMocks();
  swal.mockReset();
});

describe('showWarningDialog', () => {
  it('shows the warning through the dialog library', async () => {
    await showWarningDialog('Synthetic save failure');

    expect(swal).toHaveBeenCalledWith({ text: 'Synthetic save failure', icon: 'warning' });
  });

  it('still warns through the browser alert when the dialog chunk fails to load', async () => {
    dialogChunk.fails = true;
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    await expect(showWarningDialog('Synthetic save failure')).resolves.toBeUndefined();

    expect(alert).toHaveBeenCalledWith('Synthetic save failure');
    expect(swal).not.toHaveBeenCalled();
  });
});
