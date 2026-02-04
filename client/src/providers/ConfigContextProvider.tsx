import { FC, useState, useEffect, useCallback, useMemo, ReactNode } from "react";
import axios from "axios";
import ConfigContext, {
  ConfigContextType,
  ResearchAreaConfig,
  FieldConfig,
  DepartmentConfig
} from "../contexts/ConfigContext";

// Color mappings (kept in frontend for Tailwind classes)
const colorKeyToTailwind: Record<string, { bg: string; text: string; border: string }> = {
  blue: { bg: "bg-blue-200", text: "text-blue-800", border: "border-blue-300" },
  green: { bg: "bg-green-200", text: "text-green-800", border: "border-green-300" },
  yellow: { bg: "bg-yellow-200", text: "text-yellow-800", border: "border-yellow-300" },
  red: { bg: "bg-red-200", text: "text-red-800", border: "border-red-300" },
  purple: { bg: "bg-purple-200", text: "text-purple-800", border: "border-purple-300" },
  pink: { bg: "bg-pink-200", text: "text-pink-800", border: "border-pink-300" },
  teal: { bg: "bg-teal-200", text: "text-teal-800", border: "border-teal-300" },
  orange: { bg: "bg-orange-200", text: "text-orange-800", border: "border-orange-300" },
  indigo: { bg: "bg-indigo-200", text: "text-indigo-800", border: "border-indigo-300" },
  gray: { bg: "bg-gray-200", text: "text-gray-800", border: "border-gray-300" }
};

// Aligned with Research Field colors in researchAreas.ts
const departmentColorKeyToTailwind: Record<number, string> = {
  0: "bg-blue-200",    // Computing & AI
  1: "bg-green-200",   // Life Sciences
  2: "bg-yellow-200",  // Physical Sciences & Engineering
  3: "bg-red-200",     // Health & Medicine
  4: "bg-purple-200",  // Social Sciences
  5: "bg-pink-200",    // Humanities & Arts
  6: "bg-teal-200",    // Environmental Sciences
  7: "bg-orange-200",  // Economics
  8: "bg-indigo-200"   // Mathematics
};

interface ConfigContextProviderProps {
  children: ReactNode;
}

const ConfigContextProvider: FC<ConfigContextProviderProps> = ({ children }) => {
  const [isLoading, setIsLoading] = useState(true);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [researchAreas, setResearchAreas] = useState<ResearchAreaConfig[]>([]);
  const [researchFields, setResearchFields] = useState<FieldConfig[]>([]);
  const [fieldOrder, setFieldOrder] = useState<string[]>([]);

  const [departments, setDepartments] = useState<DepartmentConfig[]>([]);
  const [departmentCategories, setDepartmentCategories] = useState<string[]>([]);

  const fetchConfig = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const backendBaseURL = window.location.host.includes('yalelabs.io')
        ? 'https://yalelabs.io/api'
        : import.meta.env.VITE_APP_SERVER + "/api";

      const response = await axios.get(`${backendBaseURL}/config`);
      const data = response.data;

      setResearchAreas(data.researchAreas.areas);
      setResearchFields(data.researchAreas.fields);
      setFieldOrder(data.researchAreas.fieldOrder);

      setDepartments(data.departments.list);
      setDepartmentCategories(data.departments.categories);

      setIsLoaded(true);
    } catch (err) {
      console.error('Error fetching config:', err);
      setError('Failed to load configuration. Some features may not work correctly.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  // Create lookup maps for efficient access
  const researchAreaMap = useMemo(() => {
    const map = new Map<string, ResearchAreaConfig>();
    researchAreas.forEach(area => map.set(area.name.toLowerCase(), area));
    return map;
  }, [researchAreas]);

  const departmentAbbrMap = useMemo(() => {
    const map = new Map<string, DepartmentConfig>();
    departments.forEach(dept => map.set(dept.abbreviation, dept));
    return map;
  }, [departments]);

  const departmentNameMap = useMemo(() => {
    const map = new Map<string, DepartmentConfig>();
    departments.forEach(dept => map.set(dept.name.toLowerCase(), dept));
    return map;
  }, [departments]);

  // Helper methods
  const getResearchAreaByName = useCallback((name: string): ResearchAreaConfig | undefined => {
    return researchAreaMap.get(name.toLowerCase());
  }, [researchAreaMap]);

  const getColorForResearchArea = useCallback((name: string) => {
    const area = researchAreaMap.get(name.toLowerCase());
    if (area) {
      return colorKeyToTailwind[area.colorKey] || colorKeyToTailwind.gray;
    }
    return colorKeyToTailwind.gray;
  }, [researchAreaMap]);

  const getDepartmentByAbbr = useCallback((abbr: string): DepartmentConfig | undefined => {
    return departmentAbbrMap.get(abbr);
  }, [departmentAbbrMap]);

  const getDepartmentByName = useCallback((name: string): DepartmentConfig | undefined => {
    return departmentNameMap.get(name.toLowerCase());
  }, [departmentNameMap]);

  const getDepartmentColor = useCallback((dept: string): string => {
    // Handle "ABBR - Name" format
    const match = dept.match(/^([A-Z&/]+)\s*-/);
    const abbr = match ? match[1] : null;

    if (abbr) {
      const deptConfig = departmentAbbrMap.get(abbr);
      if (deptConfig) {
        return departmentColorKeyToTailwind[deptConfig.colorKey] || "bg-gray-100";
      }
    }

    // Try finding by name
    const byName = departmentNameMap.get(dept.toLowerCase());
    if (byName) {
      return departmentColorKeyToTailwind[byName.colorKey] || "bg-gray-100";
    }

    return "bg-gray-100";
  }, [departmentAbbrMap, departmentNameMap]);

  const getDepartmentsByCategory = useCallback((category: string): DepartmentConfig[] => {
    return departments.filter(dept => dept.categories.includes(category));
  }, [departments]);

  const contextValue: ConfigContextType = {
    isLoading,
    isLoaded,
    error,
    researchAreas,
    researchFields,
    fieldOrder,
    departments,
    departmentCategories,
    getResearchAreaByName,
    getColorForResearchArea,
    getDepartmentByAbbr,
    getDepartmentByName,
    getDepartmentColor,
    getDepartmentsByCategory,
    refreshConfig: fetchConfig
  };

  return (
    <ConfigContext.Provider value={contextValue}>
      {children}
    </ConfigContext.Provider>
  );
};

export default ConfigContextProvider;
