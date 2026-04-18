/**
 * Admin modal for editing fellowship details.
 *
 * Field state lives in reducers/adminFellowshipEditReducer.ts. This component
 * owns the body-scroll lock and the save/delete side effects.
 */
import { useState, useEffect, useReducer, KeyboardEvent } from 'react';
import { Fellowship } from '../../types/types';
import axios from '../../utils/axios';
import swal from 'sweetalert';
import {
  adminFellowshipEditReducer,
  createInitialAdminFellowshipEditState,
} from '../../reducers/adminFellowshipEditReducer';

const TagInput = ({
  label,
  values,
  onChange,
  placeholder,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
}) => {
  const [input, setInput] = useState('');

  const handleAdd = () => {
    const trimmed = input.trim();
    if (trimmed && !values.includes(trimmed)) {
      onChange([...values, trimmed]);
      setInput('');
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdd();
    }
  };

  return (
    <div className="mb-3">
      <label className="block text-xs font-semibold text-gray-600 mb-1">{label}</label>
      <div className="flex flex-wrap gap-1 mb-1.5">
        {values.map((v) => (
          <span
            key={v}
            className="inline-flex items-center bg-blue-50 text-blue-800 text-xs px-1.5 py-0.5 rounded border border-blue-200"
          >
            {v}
            <button
              type="button"
              onClick={() => onChange(values.filter((x) => x !== v))}
              className="ml-1 text-blue-400 hover:text-blue-600"
            >
              &times;
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-1">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="flex-1 border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <button
          type="button"
          onClick={handleAdd}
          className="px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700"
        >
          Add
        </button>
      </div>
    </div>
  );
};

interface Props {
  fellowship: Fellowship;
  onClose: () => void;
  onSave: () => void;
}

const AdminFellowshipEditModal = ({ fellowship, onClose, onSave }: Props) => {
  const [state, dispatch] = useReducer(
    adminFellowshipEditReducer,
    fellowship,
    createInitialAdminFellowshipEditState,
  );

  const {
    title,
    summary,
    description,
    applicationInformation,
    eligibility,
    applicationLink,
    awardAmount,
    isAcceptingApplications,
    deadline,
    applicationOpenDate,
    contactName,
    contactEmail,
    archived,
    audited,
    yearOfStudy,
    termOfAward,
    purpose,
    globalRegions,
    citizenshipStatus,
    isSaving,
  } = state;

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  const handleSave = async () => {
    if (!title.trim()) {
      swal({ text: 'Title is required', icon: 'warning' });
      return;
    }

    const confirmSave = await swal({
      title: 'Save Changes',
      text: 'Are you sure you want to update this fellowship?',
      icon: 'info',
      buttons: ['Cancel', 'Save'],
    });

    if (!confirmSave) return;

    dispatch({ type: 'SET_SAVING', payload: true });
    try {
      await axios.put(
        `/admin/fellowships/${fellowship.id}`,
        {
          data: {
            title,
            summary,
            description,
            applicationInformation,
            eligibility,
            applicationLink,
            awardAmount,
            isAcceptingApplications,
            deadline: deadline ? new Date(deadline).toISOString() : null,
            applicationOpenDate: applicationOpenDate
              ? new Date(applicationOpenDate).toISOString()
              : null,
            contactName,
            contactEmail,
            archived,
            audited,
            yearOfStudy,
            termOfAward,
            purpose,
            globalRegions,
            citizenshipStatus,
          },
        },
        { withCredentials: true },
      );
      swal({ text: 'Fellowship updated', icon: 'success', timer: 1500 });
      onSave();
    } catch (error: any) {
      console.error('Error updating fellowship:', error);
      swal({ text: error.response?.data?.error || 'Failed to update fellowship', icon: 'error' });
    } finally {
      dispatch({ type: 'SET_SAVING', payload: false });
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-start justify-center z-[1200] overflow-y-auto py-8"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <h3 className="text-lg font-bold text-gray-900">Edit Fellowship</h3>
            <p className="text-xs text-gray-500">ID: {fellowship.id}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
          >
            &times;
          </button>
        </div>

        <div className="px-6 py-4 max-h-[70vh] overflow-y-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="mb-3">
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  Title <span className="text-red-500">*</span>
                </label>
                <input
                  value={title}
                  onChange={(e) => dispatch({ type: 'SET_TITLE', payload: e.target.value })}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="mb-3">
                <label className="block text-xs font-semibold text-gray-600 mb-1">Summary</label>
                <textarea
                  value={summary}
                  onChange={(e) => dispatch({ type: 'SET_SUMMARY', payload: e.target.value })}
                  rows={3}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="mb-3">
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  Description
                </label>
                <textarea
                  value={description}
                  onChange={(e) => dispatch({ type: 'SET_DESCRIPTION', payload: e.target.value })}
                  rows={6}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="mb-3">
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  Application Information
                </label>
                <textarea
                  value={applicationInformation}
                  onChange={(e) =>
                    dispatch({ type: 'SET_APPLICATION_INFORMATION', payload: e.target.value })
                  }
                  rows={3}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="mb-3">
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  Eligibility
                </label>
                <textarea
                  value={eligibility}
                  onChange={(e) => dispatch({ type: 'SET_ELIGIBILITY', payload: e.target.value })}
                  rows={2}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>

            <div>
              <div className="mb-3">
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  Accepting Applications
                </label>
                <select
                  value={isAcceptingApplications ? 'yes' : 'no'}
                  onChange={(e) =>
                    dispatch({
                      type: 'SET_IS_ACCEPTING_APPLICATIONS',
                      payload: e.target.value === 'yes',
                    })
                  }
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </div>

              <div className="mb-3">
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  Application Open Date
                </label>
                <input
                  type="datetime-local"
                  value={applicationOpenDate}
                  onChange={(e) =>
                    dispatch({ type: 'SET_APPLICATION_OPEN_DATE', payload: e.target.value })
                  }
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="mb-3">
                <label className="block text-xs font-semibold text-gray-600 mb-1">Deadline</label>
                <input
                  type="datetime-local"
                  value={deadline}
                  onChange={(e) => dispatch({ type: 'SET_DEADLINE', payload: e.target.value })}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="mb-3">
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  Application Link
                </label>
                <input
                  value={applicationLink}
                  onChange={(e) =>
                    dispatch({ type: 'SET_APPLICATION_LINK', payload: e.target.value })
                  }
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="https://..."
                />
              </div>

              <div className="mb-3">
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  Award Amount
                </label>
                <input
                  value={awardAmount}
                  onChange={(e) => dispatch({ type: 'SET_AWARD_AMOUNT', payload: e.target.value })}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="e.g. $5,000"
                />
              </div>

              <div className="mb-3">
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  Contact Name
                </label>
                <input
                  value={contactName}
                  onChange={(e) => dispatch({ type: 'SET_CONTACT_NAME', payload: e.target.value })}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="mb-3">
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  Contact Email
                </label>
                <input
                  type="email"
                  value={contactEmail}
                  onChange={(e) => dispatch({ type: 'SET_CONTACT_EMAIL', payload: e.target.value })}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="flex gap-6 mb-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={archived}
                    onChange={(e) => dispatch({ type: 'SET_ARCHIVED', payload: e.target.checked })}
                    className="rounded"
                  />
                  Archived
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={audited}
                    onChange={(e) => dispatch({ type: 'SET_AUDITED', payload: e.target.checked })}
                    className="rounded"
                  />
                  Audited
                </label>
              </div>
            </div>
          </div>

          <div className="border-t pt-3 mt-3">
            <h4 className="text-xs font-bold text-gray-700 mb-2">Categories & Filters</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4">
              <TagInput
                label="Year of Study"
                values={yearOfStudy}
                onChange={(v) => dispatch({ type: 'SET_YEAR_OF_STUDY', payload: v })}
                placeholder="e.g. Freshman, Sophomore..."
              />
              <TagInput
                label="Term of Award"
                values={termOfAward}
                onChange={(v) => dispatch({ type: 'SET_TERM_OF_AWARD', payload: v })}
                placeholder="e.g. Fall, Spring, Summer..."
              />
              <TagInput
                label="Purpose"
                values={purpose}
                onChange={(v) => dispatch({ type: 'SET_PURPOSE', payload: v })}
                placeholder="e.g. Research, Study Abroad..."
              />
              <TagInput
                label="Global Regions"
                values={globalRegions}
                onChange={(v) => dispatch({ type: 'SET_GLOBAL_REGIONS', payload: v })}
                placeholder="e.g. North America, Europe..."
              />
              <TagInput
                label="Citizenship Status"
                values={citizenshipStatus}
                onChange={(v) => dispatch({ type: 'SET_CITIZENSHIP_STATUS', payload: v })}
                placeholder="e.g. US Citizen, International..."
              />
            </div>
          </div>
        </div>

        <div className="flex justify-between px-6 py-4 border-t bg-gray-50 rounded-b-lg">
          <button
            onClick={async () => {
              const confirmed = await swal({
                title: 'Delete Fellowship',
                text: `Permanently delete "${fellowship.title}"? This cannot be undone.`,
                icon: 'warning',
                buttons: ['Cancel', 'Delete'],
                dangerMode: true,
              });
              if (!confirmed) return;
              try {
                await axios.delete(`/admin/fellowships/${fellowship.id}`, {
                  withCredentials: true,
                });
                swal({ text: 'Fellowship deleted', icon: 'success', timer: 1500 });
                onSave();
              } catch (error: any) {
                swal({ text: error.response?.data?.error || 'Failed to delete', icon: 'error' });
              }
            }}
            className="px-4 py-2 text-sm text-red-600 border border-red-200 rounded-md hover:bg-red-50 transition-colors"
          >
            Delete Fellowship
          </button>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-100 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminFellowshipEditModal;
