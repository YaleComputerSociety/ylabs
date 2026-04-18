/**
 * Admin panel tab for managing research areas.
 */
import { useReducer, useEffect } from 'react';
import axios from '../../utils/axios';
import swal from 'sweetalert';
import {
  inlineCrudReducer,
  createInitialInlineCrudState,
  InlineCrudState,
  InlineCrudAction,
} from '../../reducers/inlineCrudReducer';

const RESEARCH_FIELDS = [
  'Computing & Artificial Intelligence',
  'Life Sciences & Biology',
  'Physical Sciences & Engineering',
  'Health & Medicine',
  'Social Sciences',
  'Humanities & Arts',
  'Environmental Sciences',
  'Economics',
  'Mathematics',
];

const FIELD_COLORS: Record<string, string> = {
  'Computing & Artificial Intelligence': 'bg-blue-100 text-blue-800',
  'Life Sciences & Biology': 'bg-green-100 text-green-800',
  'Physical Sciences & Engineering': 'bg-yellow-100 text-yellow-800',
  'Health & Medicine': 'bg-red-100 text-red-800',
  'Social Sciences': 'bg-purple-100 text-purple-800',
  'Humanities & Arts': 'bg-pink-100 text-pink-800',
  'Environmental Sciences': 'bg-teal-100 text-teal-800',
  Economics: 'bg-orange-100 text-orange-800',
  Mathematics: 'bg-indigo-100 text-indigo-800',
};

interface ResearchArea {
  _id: string;
  name: string;
  field: string;
  colorKey: string;
  isDefault: boolean;
  addedBy?: string;
}

interface NewDraft {
  name: string;
  field: string;
}

interface EditDraft {
  name: string;
  field: string;
}

const INITIAL_NEW_DRAFT: NewDraft = { name: '', field: RESEARCH_FIELDS[0] };

type ResearchAreaState = InlineCrudState<ResearchArea, NewDraft, EditDraft>;
type ResearchAreaAction = InlineCrudAction<ResearchArea, NewDraft, EditDraft>;

const AdminResearchAreas = () => {
  const [state, dispatch] = useReducer(
    inlineCrudReducer as (state: ResearchAreaState, action: ResearchAreaAction) => ResearchAreaState,
    createInitialInlineCrudState<ResearchArea, NewDraft, EditDraft>(INITIAL_NEW_DRAFT),
  );
  const { items: areas, isLoading, search, newDraft, editingId, editDraft } = state;

  const fetchAreas = async () => {
    dispatch({ type: 'FETCH_START' });
    try {
      const response = await axios.get('/admin/research-areas', { withCredentials: true });
      dispatch({ type: 'FETCH_SUCCESS', items: response.data.researchAreas });
    } catch (error) {
      console.error('Error fetching research areas:', error);
      swal({ text: 'Failed to fetch research areas', icon: 'error' });
      dispatch({ type: 'FETCH_FAILURE' });
    }
  };

  useEffect(() => {
    fetchAreas();
  }, []);

  const handleAdd = async () => {
    if (!newDraft.name.trim()) {
      swal({ text: 'Name is required', icon: 'warning' });
      return;
    }

    try {
      await axios.post(
        '/research-areas',
        { name: newDraft.name.trim(), field: newDraft.field },
        { withCredentials: true },
      );
      dispatch({ type: 'RESET_NEW_DRAFT', initial: INITIAL_NEW_DRAFT });
      fetchAreas();
      swal({ text: 'Research area added', icon: 'success', timer: 1500 });
    } catch (error: any) {
      swal({ text: error.response?.data?.message || 'Failed to add', icon: 'error' });
    }
  };

  const handleUpdate = async (id: string) => {
    if (!editDraft || !editDraft.name.trim()) {
      swal({ text: 'Name is required', icon: 'warning' });
      return;
    }

    try {
      await axios.put(
        `/admin/research-areas/${id}`,
        { name: editDraft.name.trim(), field: editDraft.field },
        { withCredentials: true },
      );
      dispatch({ type: 'CANCEL_EDIT' });
      fetchAreas();
      swal({ text: 'Research area updated', icon: 'success', timer: 1500 });
    } catch (error: any) {
      swal({ text: error.response?.data?.error || 'Failed to update', icon: 'error' });
    }
  };

  const handleDelete = async (area: ResearchArea) => {
    const confirmed = await swal({
      title: 'Delete Research Area',
      text: `Delete "${area.name}"? This cannot be undone.`,
      icon: 'warning',
      buttons: ['Cancel', 'Delete'],
      dangerMode: true,
    });

    if (!confirmed) return;

    try {
      await axios.delete(`/admin/research-areas/${area._id}`, { withCredentials: true });
      fetchAreas();
      swal({ text: 'Research area deleted', icon: 'success', timer: 1500 });
    } catch {
      swal({ text: 'Failed to delete', icon: 'error' });
    }
  };

  const startEdit = (area: ResearchArea) => {
    dispatch({
      type: 'START_EDIT',
      id: area._id,
      draft: { name: area.name, field: area.field },
    });
  };

  const filtered = areas.filter(
    (a) =>
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.field.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div>
      <div className="bg-white rounded-lg shadow-md p-4 border border-gray-200 mb-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Add New Research Area</h3>
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs text-gray-500 mb-1">Name</label>
            <input
              value={newDraft.name}
              onChange={(e) =>
                dispatch({ type: 'SET_NEW_DRAFT', payload: { name: e.target.value } })
              }
              placeholder="e.g. Quantum Computing"
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAdd();
              }}
            />
          </div>
          <div className="min-w-[200px]">
            <label className="block text-xs text-gray-500 mb-1">Field</label>
            <select
              value={newDraft.field}
              onChange={(e) =>
                dispatch({ type: 'SET_NEW_DRAFT', payload: { field: e.target.value } })
              }
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {RESEARCH_FIELDS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={handleAdd}
            className="bg-green-600 text-white px-4 py-2 rounded text-sm hover:bg-green-700 transition-colors"
          >
            Add
          </button>
        </div>
      </div>

      <div className="mb-3">
        <input
          value={search}
          onChange={(e) => dispatch({ type: 'SET_SEARCH', payload: e.target.value })}
          placeholder="Filter research areas..."
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <div className="text-xs text-gray-400 mt-1">{filtered.length} research areas</div>
      </div>

      <div className="bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b">
                <th className="text-left py-3 px-4 font-semibold text-gray-700">Name</th>
                <th className="text-left py-3 px-4 font-semibold text-gray-700">Field</th>
                <th className="text-center py-3 px-4 font-semibold text-gray-700">Default</th>
                <th className="text-left py-3 px-4 font-semibold text-gray-700">Added By</th>
                <th className="text-center py-3 px-4 font-semibold text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="text-center py-8 text-gray-500">
                    Loading...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-8 text-gray-500">
                    No research areas found
                  </td>
                </tr>
              ) : (
                filtered.map((area) => (
                  <tr key={area._id} className="border-b hover:bg-gray-50">
                    <td className="py-2 px-4">
                      {editingId === area._id ? (
                        <input
                          value={editDraft?.name ?? ''}
                          onChange={(e) =>
                            dispatch({
                              type: 'SET_EDIT_DRAFT',
                              payload: { name: e.target.value },
                            })
                          }
                          className="border border-gray-300 rounded px-2 py-1 text-sm w-full focus:outline-none focus:ring-1 focus:ring-blue-500"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleUpdate(area._id);
                            if (e.key === 'Escape') dispatch({ type: 'CANCEL_EDIT' });
                          }}
                          autoFocus
                        />
                      ) : (
                        area.name
                      )}
                    </td>
                    <td className="py-2 px-4">
                      {editingId === area._id ? (
                        <select
                          value={editDraft?.field ?? ''}
                          onChange={(e) =>
                            dispatch({
                              type: 'SET_EDIT_DRAFT',
                              payload: { field: e.target.value },
                            })
                          }
                          className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                        >
                          {RESEARCH_FIELDS.map((f) => (
                            <option key={f} value={f}>
                              {f}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span
                          className={`px-2 py-0.5 rounded text-xs font-medium ${
                            FIELD_COLORS[area.field] || 'bg-gray-100 text-gray-700'
                          }`}
                        >
                          {area.field}
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-4 text-center">
                      {area.isDefault ? (
                        <span className="text-green-600 text-xs font-medium">Yes</span>
                      ) : (
                        <span className="text-gray-400 text-xs">No</span>
                      )}
                    </td>
                    <td className="py-2 px-4 text-xs text-gray-500">{area.addedBy || '--'}</td>
                    <td className="py-2 px-4">
                      <div className="flex gap-1 justify-center">
                        {editingId === area._id ? (
                          <>
                            <button
                              onClick={() => handleUpdate(area._id)}
                              className="text-xs bg-green-600 text-white px-2 py-1 rounded hover:bg-green-700"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => dispatch({ type: 'CANCEL_EDIT' })}
                              className="text-xs bg-gray-300 text-gray-700 px-2 py-1 rounded hover:bg-gray-400"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => startEdit(area)}
                              className="text-xs bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDelete(area)}
                              className="text-xs bg-red-600 text-white px-2 py-1 rounded hover:bg-red-700"
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default AdminResearchAreas;
