import React from 'react';

interface ScrollableTableRegionProps {
  label: string;
  children: React.ReactNode;
}

const ScrollableTableRegion = ({ label, children }: ScrollableTableRegionProps) => (
  <div
    role="region"
    aria-label={`${label} table, scrollable`}
    tabIndex={0}
    className="yr-focus-ring-inset overflow-x-auto"
  >
    {children}
  </div>
);

export default ScrollableTableRegion;
