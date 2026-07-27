import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const axios = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
}));

vi.mock('../../../utils/axios', () => ({ default: axios }));

import FacultyOpportunityManager from '../FacultyOpportunityManager';

const entity = {
  _id: '64f333333333333333333333',
  slug: 'verified-lab',
  name: 'Verified Lab',
  entityType: 'LAB',
};

const draft = {
  _id: '64f555555555555555555555',
  researchEntityId: entity._id,
  title: 'Undergraduate imaging research assistant',
  description:
    'Support an active imaging study by preparing datasets and documenting analyses each week.',
  term: 'Fall 2026',
  applicationUrl: 'https://research.yale.edu/forms/apply-imaging-role',
  status: 'ROLLING',
  hoursPerWeek: 8,
  payRate: '$18 per hour',
  compensationType: 'PAID',
  eligibility: 'Open to Yale undergraduates.',
  workflowState: 'DRAFT',
  revision: 0,
};

describe('FacultyOpportunityManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    axios.get.mockImplementation((url: string) => {
      if (url === '/opportunities/mine/research-entities') {
        return Promise.resolve({ data: { researchEntities: [entity] } });
      }
      if (url === '/opportunities/mine') {
        return Promise.resolve({ data: { opportunities: [] } });
      }
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
  });

  afterEach(() => cleanup());

  it('previews and saves a private draft without reporting publication', async () => {
    axios.post.mockImplementation((url: string) => {
      if (url === '/opportunities/preview') {
        return Promise.resolve({
          data: {
            preview: {
              ...draft,
              researchEntity: entity,
              workflowState: 'DRAFT',
            },
          },
        });
      }
      if (url === '/opportunities') {
        return Promise.resolve({ data: { opportunity: draft } });
      }
      return Promise.reject(new Error(`Unexpected POST ${url}`));
    });

    render(<FacultyOpportunityManager />);
    await screen.findByRole('heading', { name: 'Post a real research opportunity' });

    fireEvent.change(screen.getByLabelText('Research profile'), {
      target: { value: entity._id },
    });
    fireEvent.change(screen.getByLabelText('Opportunity title'), {
      target: { value: draft.title },
    });
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: draft.description },
    });
    fireEvent.change(screen.getByLabelText('Opening type'), {
      target: { value: 'ROLLING' },
    });
    fireEvent.change(screen.getByLabelText('Official application URL'), {
      target: { value: draft.applicationUrl },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Preview draft' }));
    expect(await screen.findByRole('heading', { name: draft.title })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Nothing was published');

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(
      await screen.findByText('Draft saved. It is not public and has not entered review.'),
    ).toBeTruthy();
    expect(await screen.findByText('Your opportunities')).toBeTruthy();
    expect(screen.getByText('Draft')).toBeTruthy();
    expect(axios.post).toHaveBeenCalledWith(
      '/opportunities',
      expect.objectContaining({ opportunity: expect.objectContaining({ title: draft.title }) }),
      expect.objectContaining({
        headers: { 'Idempotency-Key': expect.stringMatching(/^.{8,128}$/) },
      }),
    );
    expect(document.body.textContent).not.toContain('published successfully');
  });

  it('associates server validation errors and moves focus to the first invalid field', async () => {
    axios.post.mockRejectedValue({
      response: {
        data: {
          error: 'Review the highlighted opportunity fields',
          code: 'VALIDATION_FAILED',
          fieldErrors: {
            title: 'Enter a specific title of at least 8 characters',
            applicationUrl: 'An official application URL is required',
          },
        },
      },
    });

    render(<FacultyOpportunityManager />);
    await screen.findByRole('heading', { name: 'Post a real research opportunity' });
    fireEvent.click(screen.getByRole('button', { name: 'Preview draft' }));

    const title = await screen.findByLabelText('Opportunity title');
    await waitFor(() => expect(document.activeElement).toBe(title));
    expect(title.getAttribute('aria-invalid')).toBe('true');
    expect(title.getAttribute('aria-describedby')).toBe('faculty-opportunity-title-error');
    expect(screen.getByRole('alert').textContent).toContain('highlighted opportunity fields');
  });

  it('reports persisted pending review without claiming that submission is live', async () => {
    axios.get.mockImplementation((url: string) => {
      if (url === '/opportunities/mine/research-entities') {
        return Promise.resolve({ data: { researchEntities: [entity] } });
      }
      if (url === '/opportunities/mine') {
        return Promise.resolve({ data: { opportunities: [draft] } });
      }
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
    axios.post.mockResolvedValue({
      data: {
        opportunity: { ...draft, workflowState: 'PENDING_REVIEW', revision: 1 },
      },
    });

    render(<FacultyOpportunityManager />);
    fireEvent.click(await screen.findByRole('button', { name: 'Submit for review' }));

    expect(
      await screen.findByText(
        'Submitted for administrator review. This opportunity is not public yet.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Pending review')).toBeTruthy();
    expect(axios.post).toHaveBeenCalledWith(`/opportunities/${draft._id}/submit`, {
      revision: 0,
    });
    expect(document.body.textContent).not.toContain('Approved and live');
  });

  it('renders the verified-profile denial without exposing authoring controls', async () => {
    axios.get.mockRejectedValue({
      response: {
        data: {
          error: 'Faculty profile verification is required',
          code: 'PROFILE_VERIFICATION_REQUIRED',
        },
      },
    });

    render(<FacultyOpportunityManager />);

    expect(await screen.findByText(/must be verified before you can create/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'New opportunity' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save draft' })).toBeNull();
  });
});
