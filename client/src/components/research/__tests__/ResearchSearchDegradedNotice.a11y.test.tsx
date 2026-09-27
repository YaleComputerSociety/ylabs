import { render } from '@testing-library/react';
import { describe, it, vi } from 'vitest';

import ResearchSearchDegradedNotice from '../ResearchSearchDegradedNotice';
import { expectNoAxeViolations } from '../../../testUtils/axe';

describe('ResearchSearchDegradedNotice accessibility', () => {
  it('conforms when a degraded search found nothing and offers both next steps', async () => {
    const { container } = render(
      <main>
        <ResearchSearchDegradedNotice hasResults={false} onRetry={vi.fn()} onBrowseAll={vi.fn()} />
      </main>,
    );

    await expectNoAxeViolations(container);
  });

  it('conforms above results a degraded search still returned', async () => {
    const { container } = render(
      <main>
        <ResearchSearchDegradedNotice hasResults onRetry={vi.fn()} />
      </main>,
    );

    await expectNoAxeViolations(container);
  });
});
