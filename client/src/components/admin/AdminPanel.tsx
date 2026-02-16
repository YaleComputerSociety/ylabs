/**
 * Admin dashboard with tabs for listings, fellowships, users, and config.
 */
import { useState } from "react";
import AdminListingsTable from "./AdminListingsTable";
import AdminFellowshipsTable from "./AdminFellowshipsTable";
import AdminResearchAreas from "./AdminResearchAreas";
import AdminDepartments from "./AdminDepartments";
import AdminFacultyProfilesTable from "./AdminFacultyProfilesTable";

const TABS = ["Listings", "Fellowships", "Research Areas", "Departments", "Faculty Profiles"] as const;
type Tab = (typeof TABS)[number];

const AdminPanel = () => {
  const [activeTab, setActiveTab] = useState<Tab>("Listings");

  return (
    <section className="mb-10 mt-16">
      <div className="flex items-center gap-3 mb-6">
        <svg className="w-7 h-7 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M20.618 5.984A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
        <h2 className="text-3xl font-bold text-gray-900">Admin Controls</h2>
      </div>

      <div className="border-b border-gray-300 mb-6">
        <nav className="flex gap-1">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-5 py-3 text-sm font-semibold border-b-2 transition-colors ${
                activeTab === tab
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              {tab}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === "Listings" && <AdminListingsTable />}
      {activeTab === "Fellowships" && <AdminFellowshipsTable />}
      {activeTab === "Research Areas" && <AdminResearchAreas />}
      {activeTab === "Departments" && <AdminDepartments />}
      {activeTab === "Faculty Profiles" && <AdminFacultyProfilesTable />}
    </section>
  );
};

export default AdminPanel;
