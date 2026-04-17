/**
 * Pure reducer for app configuration state (departments, research areas).
 *
 * Models the fetch lifecycle (idle → loading → loaded/error) so the provider's
 * state transitions can be unit-tested without mounting React or mocking axios.
 */
import {
  DepartmentConfig,
  FieldConfig,
  ResearchAreaConfig,
} from '../contexts/ConfigContext';

export interface ConfigState {
  isLoading: boolean;
  isLoaded: boolean;
  error: string | null;
  researchAreas: ResearchAreaConfig[];
  researchFields: FieldConfig[];
  fieldOrder: string[];
  departments: DepartmentConfig[];
  departmentCategories: string[];
}

export interface ConfigPayload {
  researchAreas: ResearchAreaConfig[];
  researchFields: FieldConfig[];
  fieldOrder: string[];
  departments: DepartmentConfig[];
  departmentCategories: string[];
}

export type ConfigAction =
  | { type: 'FETCH_START' }
  | { type: 'FETCH_SUCCESS'; payload: ConfigPayload }
  | { type: 'FETCH_FAILURE'; payload: string };

export const createInitialConfigState = (
  overrides: Partial<ConfigState> = {}
): ConfigState => ({
  isLoading: true,
  isLoaded: false,
  error: null,
  researchAreas: [],
  researchFields: [],
  fieldOrder: [],
  departments: [],
  departmentCategories: [],
  ...overrides,
});

export function configReducer(state: ConfigState, action: ConfigAction): ConfigState {
  switch (action.type) {
    case 'FETCH_START':
      return { ...state, isLoading: true, error: null };

    case 'FETCH_SUCCESS':
      return {
        ...state,
        isLoading: false,
        isLoaded: true,
        error: null,
        researchAreas: action.payload.researchAreas,
        researchFields: action.payload.researchFields,
        fieldOrder: action.payload.fieldOrder,
        departments: action.payload.departments,
        departmentCategories: action.payload.departmentCategories,
      };

    case 'FETCH_FAILURE':
      return {
        ...state,
        isLoading: false,
        error: action.payload,
      };

    default:
      return state;
  }
}
