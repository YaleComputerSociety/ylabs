/**
 * Admin dashboard with tabs for access review, fellowships, users, and config.
 */
import type { ComponentType } from 'react';
import AdminFellowshipsTable from './AdminFellowshipsTable';
import AdminResearchAreas from './AdminResearchAreas';
import AdminDepartments from './AdminDepartments';
import AdminOperatorBoard from './AdminOperatorBoard';
import AdminCorrectionReports from './AdminCorrectionReports';
import { WarningIcon } from '../shared/icons';
import useRovingTabs from '../../hooks/useRovingTabs';

const TABS = [
  'Operator Board',
  'Correction Reports',
  'Fellowships',
  'Topics',
  'Departments',
] as const;
type Tab = (typeof TABS)[number];

const TAB_PANELS: Record<Tab, { slug: string; Panel: ComponentType }> = {
  'Operator Board': { slug: 'operator-board', Panel: AdminOperatorBoard },
  'Correction Reports': { slug: 'correction-reports', Panel: AdminCorrectionReports },
  Fellowships: { slug: 'fellowships', Panel: AdminFellowshipsTable },
  Topics: { slug: 'topics', Panel: AdminResearchAreas },
  Departments: { slug: 'departments', Panel: AdminDepartments },
};

const tabId = (tab: Tab) => `admin-${TAB_PANELS[tab].slug}-tab`;
const panelId = (tab: Tab) => `admin-${TAB_PANELS[tab].slug}-panel`;

const AdminPanel = () => {
  const { activeTab, activateTab, handleTabKeyDown, registerTab } = useRovingTabs<Tab>(
    TABS,
    'Operator Board',
  );

  return (
    <section className="mb-10 mt-16">
      <div className="flex items-center gap-3 mb-6">
        <WarningIcon className="w-7 h-7 text-red-600" />
        <h2 className="yr-display text-3xl font-semibold text-ink">Admin Controls</h2>
      </div>

      <div className="border-b border-[var(--yr-line-strong)] mb-6">
        <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Admin controls">
          {TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              id={tabId(tab)}
              aria-controls={panelId(tab)}
              aria-selected={activeTab === tab}
              tabIndex={activeTab === tab ? 0 : -1}
              ref={registerTab(tab)}
              onClick={() => activateTab(tab)}
              onKeyDown={handleTabKeyDown}
              className={`min-h-[44px] shrink-0 whitespace-nowrap px-5 py-3 text-sm font-semibold border-b-2 transition-colors yr-focus-ring ${
                activeTab === tab
                  ? 'border-brand text-brand'
                  : 'border-transparent text-muted hover:text-ink-soft hover:border-[var(--yr-line-strong)]'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {TABS.map((tab) => {
        const { Panel } = TAB_PANELS[tab];
        const isActive = activeTab === tab;
        return (
          <div
            key={tab}
            id={panelId(tab)}
            role="tabpanel"
            aria-labelledby={tabId(tab)}
            tabIndex={0}
            hidden={!isActive}
          >
            {isActive && <Panel />}
          </div>
        );
      })}
    </section>
  );
};

export default AdminPanel;
