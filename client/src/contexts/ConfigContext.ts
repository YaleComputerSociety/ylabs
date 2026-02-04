import { createContext } from "react";

export interface ResearchAreaConfig {
  name: string;
  field: string;
  colorKey: string;
  isDefault: boolean;
}

export interface FieldConfig {
  name: string;
  colorKey: string;
}

export interface DepartmentConfig {
  abbreviation: string;
  name: string;
  displayName: string;
  categories: string[];
  primaryCategory: string;
  colorKey: number;
}

export interface ConfigContextType {
  // Loading state
  isLoading: boolean;
  isLoaded: boolean;
  error: string | null;

  // Research Areas
  researchAreas: ResearchAreaConfig[];
  researchFields: FieldConfig[];
  fieldOrder: string[];

  // Departments
  departments: DepartmentConfig[];
  departmentCategories: string[];

  // Helper methods
  getResearchAreaByName: (name: string) => ResearchAreaConfig | undefined;
  getColorForResearchArea: (name: string) => { bg: string; text: string; border: string };
  getDepartmentByAbbr: (abbr: string) => DepartmentConfig | undefined;
  getDepartmentByName: (name: string) => DepartmentConfig | undefined;
  getDepartmentColor: (dept: string) => string;
  getDepartmentsByCategory: (category: string) => DepartmentConfig[];

  // Refresh function
  refreshConfig: () => Promise<void>;
}

export const defaultConfigContext: ConfigContextType = {
  isLoading: true,
  isLoaded: false,
  error: null,
  researchAreas: [],
  researchFields: [],
  fieldOrder: [],
  departments: [],
  departmentCategories: [],
  getResearchAreaByName: () => undefined,
  getColorForResearchArea: () => ({ bg: "bg-gray-200", text: "text-gray-800", border: "border-gray-300" }),
  getDepartmentByAbbr: () => undefined,
  getDepartmentByName: () => undefined,
  getDepartmentColor: () => "bg-gray-100",
  getDepartmentsByCategory: () => [],
  refreshConfig: async () => {},
};

export default createContext<ConfigContextType>(defaultConfigContext);
