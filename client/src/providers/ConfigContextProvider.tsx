/**
 * Provider component loading and caching application configuration.
 *
 * State transitions live in reducers/configReducer.ts (pure, testable).
 * This component owns the fetch side effect and derived memoized lookups.
 */
import { FC, useEffect, useCallback, useMemo, useReducer, ReactNode } from "react";
import axios from "../utils/axios";
import ConfigContext, {
  ConfigContextType,
  ResearchAreaConfig,
  DepartmentConfig
} from "../contexts/ConfigContext";
import { configReducer, createInitialConfigState } from "../reducers/configReducer";

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

const departmentColorKeyToTailwind: Record<number, string> = {
  0: "bg-blue-200",
  1: "bg-green-200",
  2: "bg-yellow-200",
  3: "bg-red-200",
  4: "bg-purple-200",
  5: "bg-pink-200",
  6: "bg-teal-200",
  7: "bg-orange-200",
  8: "bg-indigo-200"
};

interface ConfigContextProviderProps {
  children: ReactNode;
}

const ConfigContextProvider: FC<ConfigContextProviderProps> = ({ children }) => {
  const [state, dispatch] = useReducer(configReducer, undefined, () => createInitialConfigState());
  const {
    isLoading,
    isLoaded,
    error,
    researchAreas,
    researchFields,
    fieldOrder,
    departments,
    departmentCategories,
  } = state;

  const fetchConfig = useCallback(async () => {
    dispatch({ type: 'FETCH_START' });
    try {
      const response = await axios.get('/config');
      const data = response.data;

      const areas: ResearchAreaConfig[] = data?.researchAreas?.areas || [];
      const fields = data?.researchAreas?.fields || [];
      const fieldOrderData = data?.researchAreas?.fieldOrder || [];
      const deptList: DepartmentConfig[] = data?.departments?.list || [];
      const deptCategories = data?.departments?.categories || [];

      if (areas.length === 0 || deptList.length === 0) {
        console.warn('Config loaded but data may be incomplete:', {
          researchAreas: areas.length,
          departments: deptList.length,
          rawResponse: data
        });
      }

      dispatch({
        type: 'FETCH_SUCCESS',
        payload: {
          researchAreas: areas,
          researchFields: fields,
          fieldOrder: fieldOrderData,
          departments: deptList,
          departmentCategories: deptCategories,
        },
      });
    } catch (err) {
      console.error('Error fetching config:', err);
      dispatch({
        type: 'FETCH_FAILURE',
        payload: 'Failed to load configuration. Some features may not work correctly.',
      });
    }
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

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
    const match = dept.match(/^([A-Z&/]+)\s*-/);
    const abbr = match ? match[1] : null;

    if (abbr) {
      const deptConfig = departmentAbbrMap.get(abbr);
      if (deptConfig) {
        return departmentColorKeyToTailwind[deptConfig.colorKey] || "bg-gray-100";
      }
    }

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
