/**
 * Admin panel tab for managing departments.
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

const DEPARTMENT_CATEGORIES = [
  'Computing & AI',
  'Life Sciences',
  'Physical Sciences & Engineering',
  'Health & Medicine',
  'Social Sciences',
  'Humanities & Arts',
  'Environmental Sciences',
  'Economics',
  'Mathematics',
];

const CATEGORY_COLORS: Record<string, string> = {
  'Computing & AI': 'bg-blue-100 text-blue-800',
  'Life Sciences': 'bg-green-100 text-green-800',
  'Physical Sciences & Engineering': 'bg-yellow-100 text-yellow-800',
  'Health & Medicine': 'bg-red-100 text-red-800',
  'Social Sciences': 'bg-purple-100 text-purple-800',
  'Humanities & Arts': 'bg-pink-100 text-pink-800',
  'Environmental Sciences': 'bg-teal-100 text-teal-800',
  Economics: 'bg-orange-100 text-orange-800',
  Mathematics: 'bg-indigo-100 text-indigo-800',
};

interface DepartmentDoc {
  _id: string;
  abbreviation: string;
  name: string;
  displayName: string;
  categories: string[];
  primaryCategory: string;
  colorKey: number;
  isActive: boolean;
}

interface NewDraft {
  abbr: string;
  name: string;
  category: string;
}

interface EditDraft {
  abbr: string;
  name: string;
  category: string;
  active: boolean;
}

const INITIAL_NEW_DRAFT: NewDraft = {
  abbr: '',
  name: '',
  category: DEPARTMENT_CATEGORIES[0],
};

const AdminDepartments = () => {
  const [state, dispatch] = useReducer<
    React.Reducer<
      InlineCrudState<DepartmentDoc, NewDraft, EditDraft>,
      InlineCrudAction<DepartmentDoc, NewDraft, EditDraft>
    >
  >(
    inlineCrudReducer,
    createInitialInlineCrudState<DepartmentDoc, NewDraft, EditDraft>(INITIAL_NEW_DRAFT),
  );

  const {
    items: departments,
    isLoading,
    search,
    newDraft,
    editingId,
    editDraft,
  } = state;

  const fetchDepartments = async () => {
    dispatch({ type: 'FETCH_START' });
    try {
      const response = await axios.get('/admin/departments', { withCredentials: true });
      dispatch({ type: 'FETCH_SUCCESS', items: response.data.departments });
    } catch (error) {
      console.error('Error fetching departments:', error);
      dispatch({ type: 'FETCH_FAILURE' });
      swal({ text: 'Failed to fetch departments', icon: 'error' });
    }
  };

  useEffect(() => {
    fetchDepartments();
  }, []);

  const handleAdd = async () => {
    if (!newDraft.abbr.trim() || !newDraft.name.trim()) {
      swal({ text: 'Abbreviation and name are required', icon: 'warning' });
      return;
    }

    try {
      await axios.post(
        '/admin/departments',
        {
          abbreviation: newDraft.abbr.trim().toUpperCase(),
          name: newDraft.name.trim(),
          primaryCategory: newDraft.category,
          categories: [newDraft.category],
        },
        { withCredentials: true },
      );
      dispatch({ type: 'RESET_NEW_DRAFT', initial: INITIAL_NEW_DRAFT });
      fetchDepartments();
      swal({ text: 'Department added', icon: 'success', timer: 1500 });
    } catch (error: any) {
      swal({ text: error.response?.data?.error || 'Failed to add department', icon: 'error' });
    }
  };

  const handleUpdate = async (id: string) => {
    if (!editDraft || !editDraft.abbr.trim() || !editDraft.name.trim()) {
      swal({ text: 'Abbreviation and name are required', icon: 'warning' });
      return;
    }

    try {
      await axios.put(
        `/admin/departments/${id}`,
        {
          abbreviation: editDraft.abbr.trim().toUpperCase(),
          name: editDraft.name.trim(),
          displayName: `${editDraft.abbr.trim().toUpperCase()} - ${editDraft.name.trim()}`,
          primaryCategory: editDraft.category,
          categories: [editDraft.category],
          isActive: editDraft.active,
        },
        { withCredentials: true },
      );
      dispatch({ type: 'CANCEL_EDIT' });
      fetchDepartments();
      swal({ text: 'Department updated', icon: 'success', timer: 1500 });
    } catch (error: any) {
      swal({ text: error.response?.data?.error || 'Failed to update department', icon: 'error' });
    }
  };

  const handleDelete = async (dept: DepartmentDoc) => {
    const confirmed = await swal({
      title: 'Delete Department',
      text: `Delete "${dept.displayName}"? This cannot be undone. Listings referencing this department will NOT be automatically updated.`,
      icon: 'warning',
      buttons: ['Cancel', 'Delete'],
      dangerMode: true,
    });

    if (!confirmed) return;

    try {
      await axios.delete(`/admin/departments/${dept._id}`, { withCredentials: true });
      fetchDepartments();
      swal({ text: 'Department deleted', icon: 'success', timer: 1500 });
    } catch {
      swal({ text: 'Failed to delete department', icon: 'error' });
    }
  };

  const startEdit = (dept: DepartmentDoc) => {
    dispatch({
      type: 'START_EDIT',
      id: dept._id,
      draft: {
        abbr: dept.abbreviation,
        name: dept.name,
        category: dept.primaryCategory,
        active: dept.isActive,
      },
    });
  };

  const filtered = departments.filter(
    (d) =>
      d.abbreviation.toLowerCase().includes(search.toLowerCase()) ||
      d.name.toLowerCase().includes(search.toLowerCase()) ||
      d.displayName.toLowerCase().includes(search.toLowerCase()) ||
      d.primaryCategory.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div>
      <div className="bg-white rounded-lg shadow-md p-4 border border-gray-200 mb-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Add New Department</h3>
        <div className="flex flex-wrap gap-2 items-end">
          <div className="w-28">
            <label className="block text-xs text-gray-500 mb-1">Abbreviation</label>
            <input
              value={newDraft.abbr}
              onChange={(e) => dispatch({ type: 'SET_NEW_DRAFT', payload: { abbr: e.target.value } })}
              placeholder="e.g. CPSC"
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase"
            />
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs text-gray-500 mb-1">Full Name</label>
            <input
              value={newDraft.name}
              onChange={(e) => dispatch({ type: 'SET_NEW_DRAFT', payload: { name: e.target.value } })}
              placeholder="e.g. Computer Science"
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAdd();
              }}
            />
          </div>
          <div className="min-w-[200px]">
            <label className="block text-xs text-gray-500 mb-1">Category</label>
            <select
              value={newDraft.category}
              onChange={(e) => dispatch({ type: 'SET_NEW_DRAFT', payload: { category: e.target.value } })}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {DEPARTMENT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
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
          placeholder="Filter departments..."
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <div className="text-xs text-gray-400 mt-1">{filtered.length} departments</div>
      </div>

      <div className="bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b">
                <th className="text-left py-3 px-4 font-semibold text-gray-700">Abbr</th>
                <th className="text-left py-3 px-4 font-semibold text-gray-700">Name</th>
                <th className="text-left py-3 px-4 font-semibold text-gray-700">Display Name</th>
                <th className="text-left py-3 px-4 font-semibold text-gray-700">Category</th>
                <th className="text-center py-3 px-4 font-semibold text-gray-700">Active</th>
                <th className="text-center py-3 px-4 font-semibold text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-gray-500">
                    Loading...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-gray-500">
                    No departments found
                  </td>
                </tr>
              ) : (
                filtered.map((dept) => (
                  <tr key={dept._id} className="border-b hover:bg-gray-50">
                    <td className="py-2 px-4">
                      {editingId === dept._id && editDraft ? (
                        <input
                          value={editDraft.abbr}
                          onChange={(e) =>
                            dispatch({ type: 'SET_EDIT_DRAFT', payload: { abbr: e.target.value } })
                          }
                          className="border border-gray-300 rounded px-2 py-1 text-sm w-20 uppercase focus:outline-none focus:ring-1 focus:ring-blue-500"
                          autoFocus
                        />
                      ) : (
                        <span className="font-mono font-semibold">{dept.abbreviation}</span>
                      )}
                    </td>
                    <td className="py-2 px-4">
                      {editingId === dept._id && editDraft ? (
                        <input
                          value={editDraft.name}
                          onChange={(e) =>
                            dispatch({ type: 'SET_EDIT_DRAFT', payload: { name: e.target.value } })
                          }
                          className="border border-gray-300 rounded px-2 py-1 text-sm w-full focus:outline-none focus:ring-1 focus:ring-blue-500"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleUpdate(dept._id);
                            if (e.key === 'Escape') dispatch({ type: 'CANCEL_EDIT' });
                          }}
                        />
                      ) : (
                        dept.name
                      )}
                    </td>
                    <td className="py-2 px-4 text-xs text-gray-500">{dept.displayName}</td>
                    <td className="py-2 px-4">
                      {editingId === dept._id && editDraft ? (
                        <select
                          value={editDraft.category}
                          onChange={(e) =>
                            dispatch({
                              type: 'SET_EDIT_DRAFT',
                              payload: { category: e.target.value },
                            })
                          }
                          className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                        >
                          {DEPARTMENT_CATEGORIES.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span
                          className={`px-2 py-0.5 rounded text-xs font-medium ${
                            CATEGORY_COLORS[dept.primaryCategory] || 'bg-gray-100 text-gray-700'
                          }`}
                        >
                          {dept.primaryCategory}
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-4 text-center">
                      {editingId === dept._id && editDraft ? (
                        <label className="flex items-center justify-center gap-1">
                          <input
                            type="checkbox"
                            checked={editDraft.active}
                            onChange={(e) =>
                              dispatch({
                                type: 'SET_EDIT_DRAFT',
                                payload: { active: e.target.checked },
                              })
                            }
                            className="rounded"
                          />
                          <span className="text-xs">{editDraft.active ? 'Yes' : 'No'}</span>
                        </label>
                      ) : dept.isActive ? (
                        <span className="text-green-600 text-xs font-medium">Yes</span>
                      ) : (
                        <span className="text-red-600 text-xs font-medium">No</span>
                      )}
                    </td>
                    <td className="py-2 px-4">
                      <div className="flex gap-1 justify-center">
                        {editingId === dept._id ? (
                          <>
                            <button
                              onClick={() => handleUpdate(dept._id)}
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
                              onClick={() => startEdit(dept)}
                              className="text-xs bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDelete(dept)}
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

export default AdminDepartments;
