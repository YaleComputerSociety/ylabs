/**
 * Pure reducer for the account dashboard's tracking state.
 *
 * Covers the kanban-style "where am I in the process" state for saved labs
 * and fellowships: stage per item, free-form notes per item, and which note
 * is currently being edited. Extracted from pages/account.tsx so the semantic
 * transitions (toggle emailed, clear stage, edit/cancel note) are testable.
 *
 * LocalStorage persistence and hydration stay in the page component — this
 * module only models state transitions.
 */
import { FellowshipStage } from '../types/types';
import { LabStage } from '../components/shared/KanbanBoard';

export interface AccountTrackingState {
  labStage: Record<string, LabStage>;
  labNotes: Record<string, string>;
  editingNoteId: string | null;
  fellowshipStage: Record<string, FellowshipStage>;
  fellowshipNotes: Record<string, string>;
  editingFellowshipNoteId: string | null;
}

export type AccountTrackingAction =
  | { type: 'TOGGLE_EMAILED_LISTING'; listingId: string }
  | { type: 'SET_LAB_STAGE'; listingId: string; stage: LabStage }
  | { type: 'SET_LAB_NOTE'; listingId: string; value: string }
  | { type: 'TOGGLE_EDITING_LAB_NOTE'; listingId: string }
  | { type: 'SET_FELLOWSHIP_STAGE'; fellowshipId: string; stage: FellowshipStage }
  | { type: 'SET_FELLOWSHIP_NOTE'; fellowshipId: string; value: string }
  | { type: 'TOGGLE_EDITING_FELLOWSHIP_NOTE'; fellowshipId: string }
  | { type: 'HYDRATE'; payload: Partial<AccountTrackingState> };

export const createInitialAccountTrackingState = (
  overrides: Partial<AccountTrackingState> = {}
): AccountTrackingState => ({
  labStage: {},
  labNotes: {},
  editingNoteId: null,
  fellowshipStage: {},
  fellowshipNotes: {},
  editingFellowshipNoteId: null,
  ...overrides,
});

const withoutKey = <V>(obj: Record<string, V>, key: string): Record<string, V> => {
  const next = { ...obj };
  delete next[key];
  return next;
};

export function accountTrackingReducer(
  state: AccountTrackingState,
  action: AccountTrackingAction
): AccountTrackingState {
  switch (action.type) {
    case 'TOGGLE_EMAILED_LISTING': {
      const current = state.labStage[action.listingId] || 'not_emailed';
      if (current === 'not_emailed') {
        return {
          ...state,
          labStage: { ...state.labStage, [action.listingId]: 'emailed' },
        };
      }
      return { ...state, labStage: withoutKey(state.labStage, action.listingId) };
    }

    case 'SET_LAB_STAGE': {
      if (action.stage === 'not_emailed') {
        return { ...state, labStage: withoutKey(state.labStage, action.listingId) };
      }
      return {
        ...state,
        labStage: { ...state.labStage, [action.listingId]: action.stage },
      };
    }

    case 'SET_LAB_NOTE':
      return {
        ...state,
        labNotes: { ...state.labNotes, [action.listingId]: action.value },
      };

    case 'TOGGLE_EDITING_LAB_NOTE':
      return {
        ...state,
        editingNoteId: state.editingNoteId === action.listingId ? null : action.listingId,
      };

    case 'SET_FELLOWSHIP_STAGE': {
      if (action.stage === 'not_applied') {
        return {
          ...state,
          fellowshipStage: withoutKey(state.fellowshipStage, action.fellowshipId),
        };
      }
      return {
        ...state,
        fellowshipStage: {
          ...state.fellowshipStage,
          [action.fellowshipId]: action.stage,
        },
      };
    }

    case 'SET_FELLOWSHIP_NOTE':
      return {
        ...state,
        fellowshipNotes: {
          ...state.fellowshipNotes,
          [action.fellowshipId]: action.value,
        },
      };

    case 'TOGGLE_EDITING_FELLOWSHIP_NOTE':
      return {
        ...state,
        editingFellowshipNoteId:
          state.editingFellowshipNoteId === action.fellowshipId
            ? null
            : action.fellowshipId,
      };

    case 'HYDRATE':
      return { ...state, ...action.payload };

    default:
      return state;
  }
}

/**
 * Hydrate tracking state from localStorage. The `ylabs-emailed-labs` key is
 * the legacy format (a bare list of listing IDs), migrated here into the
 * per-listing `ylabs-lab-stages` map. Exported for reuse and unit-testing.
 */
export const loadAccountTrackingFromStorage = (
  storage: Pick<Storage, 'getItem' | 'removeItem'>
): AccountTrackingState => {
  const parse = <T>(key: string, fallback: T): T => {
    try {
      const raw = storage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  };

  let labStage = parse<Record<string, LabStage>>('ylabs-lab-stages', {});
  if (Object.keys(labStage).length === 0) {
    const legacyEmailed = parse<string[] | null>('ylabs-emailed-labs', null);
    if (legacyEmailed) {
      const migrated: Record<string, LabStage> = {};
      for (const id of legacyEmailed) migrated[id] = 'emailed';
      storage.removeItem('ylabs-emailed-labs');
      labStage = migrated;
    }
  }

  return createInitialAccountTrackingState({
    labStage,
    labNotes: parse<Record<string, string>>('ylabs-lab-notes', {}),
    fellowshipStage: parse<Record<string, FellowshipStage>>('ylabs-fellowship-stages', {}),
    fellowshipNotes: parse<Record<string, string>>('ylabs-fellowship-notes', {}),
  });
};
