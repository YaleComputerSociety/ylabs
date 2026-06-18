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

const MAX_TRACKING_ITEMS = 100;
const MAX_TRACKING_NOTE_LENGTH = 2000;
export const MAX_TRACKING_STORAGE_VALUE_LENGTH = 100_000;
const TRACKING_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const TRACKING_OWNER_RE = /^[A-Za-z0-9]{2,80}$/;
const TRACKING_EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const TRACKING_PHONE_RE = /\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g;
const LAB_STAGES = new Set<LabStage>(['not_emailed', 'emailed', 'responded', 'interview']);
const FELLOWSHIP_STAGES = new Set<FellowshipStage>(['not_applied', 'applied']);

export type AccountTrackingAction =
  | { type: 'TOGGLE_EMAILED_LISTING'; listingId: string }
  | { type: 'SET_LAB_STAGE'; listingId: string; stage: LabStage }
  | { type: 'SET_LAB_NOTE'; listingId: string; value: string }
  | { type: 'TOGGLE_EDITING_LAB_NOTE'; listingId: string }
  | { type: 'SET_FELLOWSHIP_STAGE'; fellowshipId: string; stage: FellowshipStage }
  | { type: 'SET_FELLOWSHIP_NOTE'; fellowshipId: string; value: string }
  | { type: 'TOGGLE_EDITING_FELLOWSHIP_NOTE'; fellowshipId: string }
  | { type: 'HYDRATE'; payload: Partial<AccountTrackingState> };

const isSafeTrackingId = (value: unknown): value is string =>
  typeof value === 'string' && TRACKING_ID_RE.test(value);

const redactTrackingContactInfo = (value: string): string =>
  value.replace(TRACKING_EMAIL_RE, '[email redacted]').replace(TRACKING_PHONE_RE, '[phone redacted]');

const normalizeTrackingNote = (value: unknown): string =>
  typeof value === 'string'
    ? redactTrackingContactInfo(value).slice(0, MAX_TRACKING_NOTE_LENGTH)
    : '';

const normalizeTrackingNotes = (value: unknown): Record<string, string> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const notes: Record<string, string> = {};
  for (const [id, note] of Object.entries(value).slice(0, MAX_TRACKING_ITEMS)) {
    if (isSafeTrackingId(id)) notes[id] = normalizeTrackingNote(note);
  }
  return notes;
};

const normalizeLabStageMap = (value: unknown): Record<string, LabStage> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const stages: Record<string, LabStage> = {};
  for (const [id, stage] of Object.entries(value).slice(0, MAX_TRACKING_ITEMS)) {
    if (isSafeTrackingId(id) && LAB_STAGES.has(stage as LabStage)) {
      stages[id] = stage as LabStage;
    }
  }
  return stages;
};

const normalizeFellowshipStageMap = (value: unknown): Record<string, FellowshipStage> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const stages: Record<string, FellowshipStage> = {};
  for (const [id, stage] of Object.entries(value).slice(0, MAX_TRACKING_ITEMS)) {
    if (isSafeTrackingId(id) && FELLOWSHIP_STAGES.has(stage as FellowshipStage)) {
      stages[id] = stage as FellowshipStage;
    }
  }
  return stages;
};

const normalizeEditingId = (value: unknown): string | null =>
  isSafeTrackingId(value) ? value : null;

const normalizeAccountTrackingState = (
  state: Partial<AccountTrackingState>,
): AccountTrackingState => ({
  labStage: normalizeLabStageMap(state.labStage),
  labNotes: normalizeTrackingNotes(state.labNotes),
  editingNoteId: normalizeEditingId(state.editingNoteId),
  fellowshipStage: normalizeFellowshipStageMap(state.fellowshipStage),
  fellowshipNotes: normalizeTrackingNotes(state.fellowshipNotes),
  editingFellowshipNoteId: normalizeEditingId(state.editingFellowshipNoteId),
});

export const createInitialAccountTrackingState = (
  overrides: Partial<AccountTrackingState> = {},
): AccountTrackingState =>
  normalizeAccountTrackingState({
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
  action: AccountTrackingAction,
): AccountTrackingState {
  switch (action.type) {
    case 'TOGGLE_EMAILED_LISTING': {
      if (!isSafeTrackingId(action.listingId)) return state;
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
      if (!isSafeTrackingId(action.listingId)) return state;
      if (!LAB_STAGES.has(action.stage)) return state;
      if (action.stage === 'not_emailed') {
        return { ...state, labStage: withoutKey(state.labStage, action.listingId) };
      }
      return {
        ...state,
        labStage: { ...state.labStage, [action.listingId]: action.stage },
      };
    }

    case 'SET_LAB_NOTE':
      if (!isSafeTrackingId(action.listingId)) return state;
      return {
        ...state,
        labNotes: { ...state.labNotes, [action.listingId]: normalizeTrackingNote(action.value) },
      };

    case 'TOGGLE_EDITING_LAB_NOTE':
      if (!isSafeTrackingId(action.listingId)) return state;
      return {
        ...state,
        editingNoteId: state.editingNoteId === action.listingId ? null : action.listingId,
      };

    case 'SET_FELLOWSHIP_STAGE': {
      if (!isSafeTrackingId(action.fellowshipId)) return state;
      if (!FELLOWSHIP_STAGES.has(action.stage)) return state;
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
      if (!isSafeTrackingId(action.fellowshipId)) return state;
      return {
        ...state,
        fellowshipNotes: {
          ...state.fellowshipNotes,
          [action.fellowshipId]: normalizeTrackingNote(action.value),
        },
      };

    case 'TOGGLE_EDITING_FELLOWSHIP_NOTE':
      if (!isSafeTrackingId(action.fellowshipId)) return state;
      return {
        ...state,
        editingFellowshipNoteId:
          state.editingFellowshipNoteId === action.fellowshipId ? null : action.fellowshipId,
      };

    case 'HYDRATE':
      return normalizeAccountTrackingState({ ...state, ...action.payload });

    default:
      return state;
  }
}

const STORAGE_PREFIX = 'yale-research';
const LEGACY_STORAGE_PREFIX = ['y', 'labs'].join('');
const TRACKING_STORAGE_KEYS = [
  'lab-stages',
  'lab-notes',
  'fellowship-stages',
  'fellowship-notes',
] as const;
const PRIVATE_TRACKING_STORAGE_KEYS = new Set(['lab-notes', 'fellowship-notes']);

export const normalizeAccountTrackingStorageOwner = (owner: unknown): string | undefined => {
  const normalized = typeof owner === 'string' ? owner.trim().toLowerCase() : '';
  return TRACKING_OWNER_RE.test(normalized) ? normalized : undefined;
};

const storageKey = (key: string, owner: unknown) => {
  const ownerKey = normalizeAccountTrackingStorageOwner(owner);
  return ownerKey ? `${STORAGE_PREFIX}-${ownerKey}-${key}` : '';
};
const unscopedStorageKey = (key: string) => `${STORAGE_PREFIX}-${key}`;
const legacyStorageKey = (key: string) => `${LEGACY_STORAGE_PREFIX}-${key}`;

const removeUnscopedTrackingStorage = (storage: Pick<Storage, 'removeItem'>): void => {
  for (const key of TRACKING_STORAGE_KEYS) {
    storage.removeItem(unscopedStorageKey(key));
    storage.removeItem(legacyStorageKey(key));
  }
  storage.removeItem(legacyStorageKey('emailed-labs'));
};

export const persistAccountTrackingToStorage = (
  storage: Pick<Storage, 'removeItem' | 'setItem'>,
  key: string,
  value: unknown,
  owner: unknown,
): void => {
  const fullKey = storageKey(key, owner);
  if (!fullKey) return;
  if (PRIVATE_TRACKING_STORAGE_KEYS.has(key)) {
    storage.removeItem(fullKey);
    return;
  }
  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized !== 'string' || serialized.length > MAX_TRACKING_STORAGE_VALUE_LENGTH) {
      storage.removeItem(fullKey);
      return;
    }
    storage.setItem(fullKey, serialized);
  } catch {
    // Ignore quota and serialization errors; account tracking remains server-backed elsewhere.
  }
};

/**
 * Hydrate tracking state from localStorage, including older saved-state keys.
 * Exported for reuse and unit-testing.
 */
export const loadAccountTrackingFromStorage = (
  storage: Pick<Storage, 'getItem' | 'removeItem'>,
  owner: unknown,
): AccountTrackingState => {
  const ownerKey = normalizeAccountTrackingStorageOwner(owner);
  if (!ownerKey) return createInitialAccountTrackingState();
  removeUnscopedTrackingStorage(storage);
  storage.removeItem(storageKey('lab-notes', ownerKey));
  storage.removeItem(storageKey('fellowship-notes', ownerKey));

  const parse = (key: string): unknown => {
    try {
      const raw = storage.getItem(key);
      if (raw && raw.length > MAX_TRACKING_STORAGE_VALUE_LENGTH) {
        storage.removeItem(key);
        return null;
      }
      return raw ? JSON.parse(raw) : null;
    } catch {
      storage.removeItem(key);
      return null;
    }
  };

  return createInitialAccountTrackingState({
    labStage: normalizeLabStageMap(parse(storageKey('lab-stages', ownerKey))),
    fellowshipStage: normalizeFellowshipStageMap(parse(storageKey('fellowship-stages', ownerKey))),
  });
};
