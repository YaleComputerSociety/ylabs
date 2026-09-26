import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DepartmentResearchContextSection } from '../DepartmentResearchContextSection';

const route = {
  departmentName: 'Religious Studies',
  evidenceQuote:
    'The senior essay courses, RLST 4910 and RLST 4920, include research and writing assignments.',
  sourceUrl: 'https://religiousstudies.yale.edu/undergraduate/senior-essay',
};

describe('DepartmentResearchContextSection', () => {
  it('names the department as the subject of the route', () => {
    render(<DepartmentResearchContextSection routes={[route]} />);

    expect(
      screen.getByText('Religious Studies offers undergraduate research for course credit'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Religious Studies course page' })).toHaveAttribute(
      'href',
      route.sourceUrl,
    );
    expect(screen.getByText(route.evidenceQuote)).toBeInTheDocument();
  });

  /**
   * The forbidden shape. A department course page says nothing about the entity
   * whose page this is, so the copy must disclaim that reading rather than leave
   * it open.
   */
  it('says the route is department-wide and not a statement about the listing', () => {
    render(<DepartmentResearchContextSection routes={[route]} />);

    expect(
      screen.getByText(/route the department offers across the department/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/not a statement about this listing/i)).toBeInTheDocument();
  });

  it('renders one card per department when an entity sits in two', () => {
    render(
      <DepartmentResearchContextSection
        routes={[route, { ...route, departmentName: 'American Studies' }]}
      />,
    );

    expect(screen.getAllByRole('link', { name: /course page$/ })).toHaveLength(2);
  });

  it('renders nothing without a route, and nothing for an unsafe or missing citation', () => {
    const { container: empty } = render(<DepartmentResearchContextSection routes={[]} />);
    expect(empty).toBeEmptyDOMElement();

    const { container: unsafe } = render(
      <DepartmentResearchContextSection
        routes={[{ ...route, sourceUrl: 'javascript:alert(1)' }]}
      />,
    );
    expect(unsafe).toBeEmptyDOMElement();

    const { container: quoteless } = render(
      <DepartmentResearchContextSection routes={[{ ...route, evidenceQuote: '' }]} />,
    );
    expect(quoteless).toBeEmptyDOMElement();
  });

  it('never introduces retired vocabulary in its copy', () => {
    const { container } = render(<DepartmentResearchContextSection routes={[route]} />);

    expect(container.textContent).not.toMatch(/research\s+(?:home|area)s?\b/i);
  });
});
