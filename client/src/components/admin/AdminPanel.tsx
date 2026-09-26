/**
 * Admin dashboard with tabs for access review, fellowships, users, and config.
 */
import { useState } from 'react';
import AdminFellowshipsTable from './AdminFellowshipsTable';
import AdminResearchAreas from './AdminResearchAreas';
import AdminDepartments from './AdminDepartments';
import AdminOperatorBoard from './AdminOperatorBoard';
import AdminCorrectionReports from './AdminCorrectionReports';
import { WarningIcon } from '../shared/icons';

const TABS = [
  'Operator Board',
  'Correction Reports',
  'Fellowships',
  'Topics',
  'Departments',
] as const;
type Tab = (typeof TABS)[number];

const AdminPanel = () => {
  const [activeTab, setActiveTab] = useState<Tab>('Operator Board');

  return (
    <section className="mb-10 mt-16">
      <div className="flex items-center gap-3 mb-6">
        <WarningIcon className="w-7 h-7 text-red-600" />
        <h2 className="yr-display text-3xl font-semibold text-ink">Admin Controls</h2>
      </div>

      <div className="border-b border-[var(--yr-line-strong)] mb-6">
        <nav className="flex gap-1">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`min-h-[44px] px-5 py-3 text-sm font-semibold border-b-2 transition-colors yr-focus-ring ${
                activeTab === tab
                  ? 'border-brand text-brand'
                  : 'border-transparent text-muted hover:text-ink-soft hover:border-[var(--yr-line-strong)]'
              }`}
            >
              {tab}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === 'Operator Board' && <AdminOperatorBoard />}
      {activeTab === 'Correction Reports' && <AdminCorrectionReports />}
      {activeTab === 'Fellowships' && <AdminFellowshipsTable />}
      {activeTab === 'Topics' && <AdminResearchAreas />}
      {activeTab === 'Departments' && <AdminDepartments />}
    </section>
  );
};

export default AdminPanel;
