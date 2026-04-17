/**
 * Listing creation and edit form with all fields.
 *
 * Form state lives in reducers/listingFormReducer.ts; this component owns
 * rendering, validation calls, and the one-shot fetch.
 */
import React, { useEffect, useContext, useMemo, useReducer, useCallback } from 'react';
import { Listing } from '../../../types/types';
import { useConfig } from '../../../hooks/useConfig';
import swal from "sweetalert";
import axios from '../../../utils/axios';
import PulseLoader from "react-spinners/PulseLoader";

import TextInput from './FormFields/TextInput';
import TextArea from './FormFields/TextArea';
import ArrayInput from './FormFields/ArrayInput';
import DepartmentInput from './FormFields/DepartmentInput';
import HiringStatus from './FormFields/HiringStatus';
import ResearchAreaInput from './FormFields/ResearchAreaInput';
import { validateTitle, validateDescription, validateEstablished,
         validateProfessors, validateEmails, validateWebsites, validateProfessorIds, validateDepartments } from './utils/validation';
import { createListing } from '../../../utils/apiCleaner';
import UserContext from "../../../contexts/UserContext";
import {
  ListingFormErrors,
  createInitialListingFormState,
  listingFormReducer,
} from '../../../reducers/listingFormReducer';

interface ListingFormProps {
  listing: Listing;
  isCreated: boolean;
  onLoad: (updatedListing: Listing, success: boolean) => void;
  onCancel?: () => void;
  onSave?: (updatedListing: Listing) => void;
  onCreate?: (listing: Listing) => void;
}

const ListingForm = ({ listing, isCreated, onLoad, onCancel, onSave, onCreate }: ListingFormProps) => {
  const { departments: allDepartmentsConfig } = useConfig();
  const departmentNames = useMemo(() => allDepartmentsConfig.map(d => d.displayName), [allDepartmentsConfig]);

  const [state, dispatch] = useReducer(
    listingFormReducer,
    listing,
    createInitialListingFormState
  );

  const {
    title,
    professorNames,
    ownerName,
    departments,
    availableDepartments,
    professorIds,
    emails,
    ownerEmail,
    websites,
    description,
    applicantDescription,
    researchAreas,
    established,
    hiringStatus,
    archived,
    loading,
    errors,
  } = state;

  const { user } = useContext(UserContext);
  const isOwner = user && (user.netId === listing.ownerId);

  // Setters shaped like Dispatch<SetStateAction<T>> so existing child components
  // (ArrayInput, HiringStatus, etc.) can remain unchanged.
  const setTitle = useCallback((value: string) => {
    dispatch({ type: 'SET_TITLE', payload: value });
  }, []);

  const setProfessorNames = useCallback(
    (value: React.SetStateAction<string[]>) => {
      dispatch({ type: 'SET_PROFESSOR_NAMES', payload: value });
    },
    []
  ) as React.Dispatch<React.SetStateAction<string[]>>;

  const setProfessorIds = useCallback(
    (value: React.SetStateAction<string[]>) => {
      dispatch({ type: 'SET_PROFESSOR_IDS', payload: value });
    },
    []
  ) as React.Dispatch<React.SetStateAction<string[]>>;

  const setEmails = useCallback(
    (value: React.SetStateAction<string[]>) => {
      dispatch({ type: 'SET_EMAILS', payload: value });
    },
    []
  ) as React.Dispatch<React.SetStateAction<string[]>>;

  const setWebsites = useCallback(
    (value: React.SetStateAction<string[]>) => {
      dispatch({ type: 'SET_WEBSITES', payload: value });
    },
    []
  ) as React.Dispatch<React.SetStateAction<string[]>>;

  const setDescription = useCallback((value: string) => {
    dispatch({ type: 'SET_DESCRIPTION', payload: value });
  }, []);

  const setApplicantDescription = useCallback((value: string) => {
    dispatch({ type: 'SET_APPLICANT_DESCRIPTION', payload: value });
  }, []);

  const setEstablished = useCallback((value: string) => {
    dispatch({ type: 'SET_ESTABLISHED', payload: value });
  }, []);

  const setHiringStatus = useCallback(
    (value: React.SetStateAction<number>) => {
      dispatch({ type: 'SET_HIRING_STATUS', payload: value });
    },
    []
  ) as React.Dispatch<React.SetStateAction<number>>;

  const updateError = useCallback((field: keyof ListingFormErrors, value: string | undefined) => {
    dispatch({ type: 'UPDATE_ERROR', field, value });
  }, []);

  useEffect(() => {
    if (!isCreated) {
      dispatch({ type: 'SET_LOADING', payload: true });
      axios.get(`/listings/${listing.id}`, { withCredentials: true }).then((response) => {
        if (!response.data.listing) {
          console.error(`Response, but no listing ${listing.id}:`, response.data);
          onLoad(listing, false);
          return;
        }
        const fetched = createListing(response.data.listing);
        const nextAvailable = departmentNames
          .filter(dept => !fetched.departments.includes(dept))
          .sort();
        dispatch({
          type: 'HYDRATE',
          listing: fetched,
          availableDepartments: nextAvailable,
        });
        onLoad(fetched, true);
      }).catch((error) => {
        console.error(`Error fetching most recent listing ${listing.id}:`, error);
        onLoad(listing, false);
      });
    } else {
      dispatch({
        type: 'SET_AVAILABLE_DEPARTMENTS',
        payload: departmentNames.filter(dept => !departments.includes(dept)).sort(),
      });
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, []);

  useEffect(() => {
    const updatedListing: Listing = {
      ...listing,
      title,
      professorNames,
      departments,
      emails,
      websites,
      description,
      applicantDescription,
      keywords: researchAreas,
      researchAreas,
      established,
      hiringStatus,
      archived
    };
    onLoad(updatedListing, true);
  }, [title, professorNames, departments, emails, websites, description, applicantDescription, researchAreas, established, hiringStatus, archived]);

  const setResearchAreas = useCallback(
    (value: React.SetStateAction<string[]>) => {
      dispatch({ type: 'SET_RESEARCH_AREAS', payload: value });
    },
    []
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const validationErrors = {
      title: validateTitle(title),
      description: validateDescription(description),
      established: validateEstablished(established),
      professorNames: validateProfessors([ownerName, ...professorNames]),
      professorIds: validateProfessorIds(professorIds),
      emails: validateEmails([ownerEmail, ...emails]),
      websites: validateWebsites(websites),
      departments: validateDepartments(departments)
    };

    const filteredErrors: ListingFormErrors = Object.fromEntries(
      Object.entries(validationErrors).filter(([_, value]) => value !== undefined)
    );

    dispatch({ type: 'SET_ERRORS', payload: filteredErrors });

    if (Object.keys(filteredErrors).length === 0) {
      const updatedListing: Listing = {
        ...listing,
        title,
        professorIds,
        professorNames,
        departments,
        emails,
        websites,
        description,
        applicantDescription,
        keywords: researchAreas,
        researchAreas,
        established,
        hiringStatus,
        archived
      };

      if (isCreated) {
        swal({
          title: "Create Listing",
          text: "Are you sure you want to create this listing?",
          icon: "info",
          buttons: ["Cancel", "Create"],
        }).then((willSave) => {
          if (willSave && onCreate) {
            onCreate(updatedListing);
          }
        });
      } else {
        swal({
          title: "Submit Form",
          text: "Are you sure you want to save these changes?",
          icon: "info",
          buttons: ["Cancel", "Save"],
        }).then((willSave) => {
          if (willSave && onSave) {
            onSave(updatedListing);
          }
        });
      }
    } else {
      console.log('Validation errors:', filteredErrors);
    }
  };

const handleCancel = () => {
  if (isCreated) {
    swal({
      title: "Delete Listing",
      text: "Are you sure you want to delete this listing? This action cannot be undone",
      icon: "warning",
      buttons: ["Cancel", "Delete"],
      dangerMode: true,
    }).then((willCancel) => {
      if (willCancel && onCancel) {
        onCancel();
      }
    });
  } else {
    dispatch({ type: 'RESET_FROM_LISTING', listing });
    onLoad({ ...listing }, true);
    if (onCancel) {
      onCancel();
    }
  }
};

  const handleAddDepartment = (department: string) => {
    dispatch({ type: 'ADD_DEPARTMENT', department });
  };

  const handleRemoveDepartment = (index: number) => {
    dispatch({ type: 'REMOVE_DEPARTMENT', index });
  };

  return (
    <div className="border border-gray-300 border-t-0 bg-white p-6 rounded-b-lg shadow-md relative">
      {loading ? (
        <div className="flex flex-col justify-center items-center h-full">
          <PulseLoader color="#66CCFF" size={6} />
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <TextInput
              id="title"
              label="Listing Title"
              value={title}
              onChange={setTitle}
              placeholder="Your Lab's Name (or Professor's Name)"
              error={errors.title}
              required
              onValidate={(value) => {
                if (errors.title) {
                  updateError('title', validateTitle(value));
                }
              }}
            />

            <HiringStatus
              hiringStatus={hiringStatus}
              setHiringStatus={setHiringStatus}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <TextArea
              id="description"
              label="Research Description"
              value={description}
              onChange={setDescription}
              placeholder="Describe your research in (3-4 sentences)"
              rows={6}
              error={errors.description}
              required
            />

            <TextArea
              id="applicantDescription"
              label="Applicant Prerequisites"
              value={applicantDescription}
              onChange={setApplicantDescription}
              placeholder="Describe what you want in an applicant (1-2 sentences)"
              rows={6}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <ArrayInput
              label="Professors"
              items={professorNames}
              setItems={setProfessorNames}
              placeholder="Add professor"
              bgColor="bg-blue-100"
              textColor="text-blue-800"
              buttonColor="text-blue-500 hover:text-blue-700"
              error={errors.professorNames}
              permanentValue={ownerName}
              onValidate={(newArray) => updateError('professorNames', validateProfessors(newArray))}
            />

            <ArrayInput
              label="Research Website"
              items={websites}
              setItems={setWebsites}
              placeholder="Add website URL"
              bgColor="bg-yellow-100"
              textColor="text-yellow-800"
              buttonColor="text-yellow-500 hover:text-yellow-700"
              error={errors.websites}
              type="url"
              onValidate={(newArray) => updateError('websites', validateWebsites(newArray))}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <ArrayInput
              label="Professor Emails"
              items={emails}
              setItems={setEmails}
              placeholder="Add email"
              bgColor="bg-green-100"
              textColor="text-green-800"
              buttonColor="text-green-500 hover:text-green-700"
              error={errors.emails}
              permanentValue={ownerEmail}
              type="email"
              onValidate={(newArray) => updateError('emails', validateEmails(newArray))}
            />

            <ResearchAreaInput
              researchAreas={researchAreas}
              onAddResearchArea={(area) => setResearchAreas((prev) => [...prev, area])}
              onRemoveResearchArea={(index) => setResearchAreas((prev) => prev.filter((_, i) => i !== index))}
            />
          </div>

          <details className="mb-16">
            <summary className="cursor-pointer text-sm font-medium text-gray-600 hover:text-gray-800 py-2 select-none">
              Advanced Options
            </summary>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
              <DepartmentInput
                departments={departments}
                availableDepartments={availableDepartments}
                onAddDepartment={handleAddDepartment}
                onRemoveDepartment={handleRemoveDepartment}
                required
                error={errors.departments}
              />

              {isOwner && (
                <ArrayInput
                  label="Co-Editors"
                  items={professorIds}
                  setItems={setProfessorIds}
                  placeholder="Add netid"
                  bgColor="bg-green-100"
                  textColor="text-green-800"
                  buttonColor="text-green-500 hover:text-green-700"
                  error={errors.professorIds}
                  onValidate={(newArray) => updateError('professorIds', validateProfessorIds(newArray))}
                  infoText="Allow others in your lab to update this listing"
                />
              )}

              <TextInput
                id="established"
                label="Lab Established Year"
                value={established}
                onChange={setEstablished}
                placeholder="e.g. 2006"
                error={errors.established}
                onValidate={(value) => {
                  if (errors.established) {
                    updateError('established', validateEstablished(value));
                  }
                }}
              />

              <div className="flex items-center">
                <input
                  id="archived"
                  type="checkbox"
                  checked={archived}
                  onChange={(e) => dispatch({ type: 'SET_ARCHIVED', payload: e.target.checked })}
                  className="mr-3 h-4 w-4 text-blue-500 focus:ring-blue-400 cursor-pointer"
                />
                <label className="text-gray-700 text-sm font-bold cursor-pointer" htmlFor="archived">
                  Archive this listing
                </label>
              </div>
            </div>
          </details>

          <div className="absolute bottom-6 right-6 flex space-x-3 bg-white py-2 px-1">
            <button
              type="button"
              onClick={handleCancel}
              className={`py-2 px-4 rounded-md text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                isCreated
                  ? "border border-gray-300 text-gray-600 hover:bg-gray-50 focus:ring-gray-300"
                  : "border border-gray-300 text-gray-600 hover:bg-gray-50 focus:ring-gray-300"
              }`}
            >
              {isCreated ? "Discard" : "Cancel"}
            </button>
            <button
              type="submit"
              className="py-2 px-4 rounded-md text-sm font-medium text-white transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-600"
              style={{ backgroundColor: 'rgba(0, 85, 164, 0.85)' }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(0, 85, 164, 1)'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgba(0, 85, 164, 0.85)'}
            >
              {isCreated ? "Create Listing" : "Save Changes"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};

export default ListingForm;
