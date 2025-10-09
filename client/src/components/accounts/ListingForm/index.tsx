import React, { useState, useEffect } from 'react';
import { Listing } from '../../../types/types';
import { departmentNames } from '../../../utils/departmentNames';
import swal from "sweetalert";
import axios from '../../../utils/axios';
import PulseLoader from "react-spinners/PulseLoader";

import TextInput from './FormFields/TextInput';
import TextArea from './FormFields/TextArea';
import ArrayInput from './FormFields/ArrayInput';
import DepartmentInput from './FormFields/DepartmentInput';
import HiringStatus from './FormFields/HiringStatus';
import { validateTitle, validateDescription, validateEstablished, 
         validateProfessors, validateEmails, validateWebsites, validateProfessorIds } from './utils/validation';
import { createListing } from '../../../utils/apiCleaner';
import { useContext } from "react";
import UserContext from "../../../contexts/UserContext";
         
interface ListingFormProps {
  listing: Listing;
  isCreated: boolean;
  onLoad: (updatedListing: Listing, success: boolean) => void;
  onCancel?: () => void;
  onSave?: (updatedListing: Listing) => void;
  onCreate?: (listing: Listing) => void;
}

const ListingForm = ({ listing, isCreated, onLoad, onCancel, onSave, onCreate }: ListingFormProps) => {
  // Form state
  const [title, setTitle] = useState(listing.title);
  const [professorNames, setProfessorNames] = useState<string[]>([...listing.professorNames]);
  const [ownerName, setOwnerName] = useState<string>(`${listing.ownerFirstName} ${listing.ownerLastName}`);
  const [departments, setDepartments] = useState<string[]>([...listing.departments]);
  const [availableDepartments, setAvailableDepartments] = useState<string[]>([]);
  const [professorIds, setProfessorIds] = useState<string[]>([...listing.professorIds]);
  const [emails, setEmails] = useState<string[]>([...listing.emails]);
  const [ownerEmail, setOwnerEmail] = useState<string>(listing.ownerEmail);
  const [websites, setWebsites] = useState<string[]>(listing.websites ? [...listing.websites] : []);
  const [description, setDescription] = useState(listing.description);
  const [keywords, setKeywords] = useState<string[]>(listing.keywords ? [...listing.keywords] : []);
  const [established, setEstablished] = useState(listing.established || '');
  const [hiringStatus, setHiringStatus] = useState(listing.hiringStatus);
  const [archived, setArchived] = useState(listing.archived);
  const [applicationsEnabled, setApplicationsEnabled] = useState(listing.applicationsEnabled || false);
  const [applicationQuestions, setApplicationQuestions] = useState<Array<{question: string, required: boolean}>>(listing.applicationQuestions || []);
  const [loading, setLoading] = useState(true);

  const { user } = useContext(UserContext);
  const isOwner = user && (user.netId === listing.ownerId);
  
  // Form errors
  const [errors, setErrors] = useState<{
    title?: string;
    description?: string;
    established?: string;
    professorIds?: string;
    professorNames?: string;
    emails?: string;
    websites?: string;
  }>({});

  // Get most recent listing and initialize available departments
  useEffect(() => {
    if (!isCreated) {
      setLoading(true);
      axios.get(`/listings/${listing.id}`, { withCredentials: true }).then((response) => {
        if (!response.data.listing) {
          console.error(`Response, but no listing ${listing.id}:`, response.data);
          onLoad(listing, false);
          return;
        }
        const listing = createListing(response.data.listing);
        // Update state with new listing data
        setTitle(newListing.title);
        setProfessorNames([...newListing.professorNames]);
        setOwnerName(`${newListing.ownerFirstName} ${newListing.ownerLastName}`);
        setDepartments([...newListing.departments]);
        setEmails([...newListing.emails]);
        setOwnerEmail(newListing.ownerEmail);
        setWebsites(newListing.websites ? [...newListing.websites] : []);
        setDescription(newListing.description);
        setKeywords(newListing.keywords ? [...newListing.keywords] : []);
        setEstablished(newListing.established || '');
        setHiringStatus(newListing.hiringStatus);
        setArchived(newListing.archived);
        setApplicationsEnabled(newListing.applicationsEnabled || false);
        setApplicationQuestions(newListing.applicationQuestions || []);

        onLoad(listing, true);

        setAvailableDepartments(
          departmentNames.filter(dept => !listing.departments.includes(dept)).sort()
        );
        setLoading(false);
      }).catch((error) => {
        console.error(`Error fetching most recent listing ${listing.id}:`, error);
        onLoad(listing, false);
      });
    } else {
      setAvailableDepartments(
        departmentNames.filter(dept => !departments.includes(dept)).sort()
      );
      setLoading(false);
    }
  }, []);

  // Live update preview when editing or creating a listing
  useEffect(() => {
    const updatedListing: Listing = {
      ...listing,
      title,
      professorNames,
      departments,
      emails,
      websites,
      description,
      keywords,
      established,
      hiringStatus,
      archived,
      applicationsEnabled,
      applicationQuestions
    };
    onLoad(updatedListing, true);
  }, [title, professorNames, departments, emails, websites, description, keywords, established, hiringStatus, archived, applicationsEnabled, applicationQuestions]);

  // Autosave for applicationsEnabled
  useEffect(() => {
    if (!isCreated && listing.id !== "create" && applicationsEnabled !== listing.applicationsEnabled) {
      const updatedListing = { ...listing, applicationsEnabled };
      axios.put(`/newListings/${listing.id}`, { data: updatedListing })
        .then(response => {
          console.log('Applications enabled status saved:', response.data.listing.applicationsEnabled);
          onLoad(createListing(response.data.listing), true); // Update parent state
        })
        .catch(error => {
          console.error('Error saving applications enabled status:', error);
          swal('Error', 'Failed to update application status', 'error');
          setApplicationsEnabled(listing.applicationsEnabled || false); // Revert on error
        });
    }
  }, [applicationsEnabled]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate all required fields
    const validationErrors = {
      title: validateTitle(title),
      description: validateDescription(description),
      established: validateEstablished(established),
      professorNames: validateProfessors([ownerName, ...professorNames]),
      professorIds: validateProfessorIds(professorIds),
      emails: validateEmails([ownerEmail, ...emails]),
      websites: validateWebsites(websites)
    };
    
    // Filter out undefined errors
    const filteredErrors = Object.fromEntries(
      Object.entries(validationErrors).filter(([_, value]) => value !== undefined)
    );
    
    // Update error state
    setErrors(filteredErrors);
    
    // Only proceed if no errors
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
        keywords,
      established,
      hiringStatus,
      archived,
      applicationsEnabled,
      applicationQuestions
    };
      
      // Show confirmation dialog before saving
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
    if (onCancel) {
      onCancel();
    }
  } else {
    // Clone the original listing to force a new reference
    const originalListing = { ...listing };
    // Reset local state to the official listing values
    setTitle(originalListing.title);
    setProfessorNames([...originalListing.professorNames]);
    setOwnerName(`${originalListing.ownerFirstName} ${originalListing.ownerLastName}`);
    setDepartments([...originalListing.departments]);
    setEmails([...originalListing.emails]);
    setOwnerEmail(originalListing.ownerEmail);
    setWebsites(originalListing.websites ? [...originalListing.websites] : []);
    setDescription(originalListing.description);
    setKeywords(originalListing.keywords ? [...originalListing.keywords] : []);
    setEstablished(originalListing.established || '');
    setHiringStatus(originalListing.hiringStatus);
    setArchived(originalListing.archived);
    setApplicationsEnabled(originalListing.applicationsEnabled || false);
    setApplicationQuestions(originalListing.applicationQuestions || []);

    // Force the parent to update the preview by providing a new object reference.
    onLoad({ ...originalListing }, true);

    if (onCancel) {
      onCancel();
    }
  }
};

  // Handle adding/removing departments
  const handleAddDepartment = (department: string) => {
    setDepartments(prev => [...prev, department]);
    setAvailableDepartments(prev => prev.filter(dept => dept !== department).sort());
  };

  const handleRemoveDepartment = (index: number) => {
    const newDepartments = [...departments];
    const removedDept = newDepartments.splice(index, 1)[0];
    setDepartments(newDepartments);
    setAvailableDepartments(prev => [...prev, removedDept].sort());
  };

  return (
    <div className="border border-gray-300 border-t-0 bg-white p-6 rounded-b-lg shadow-md relative">
      {loading ? (
        <div className="flex flex-col justify-center items-center h-full">
          <PulseLoader color="#66CCFF" size={6} />
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
            {/* Left column - Non-array fields */}
            <div className="col-span-1">
              <TextInput
                id="title"
                label="⭐ Listing Title"
                value={title}
                onChange={setTitle}
                placeholder="Add title"
                error={errors.title}
                onValidate={(value) => {
                  if (errors.title) {
                    setErrors(prev => ({ ...prev, title: validateTitle(value) }));
                  }
                }}
              />

              <TextArea
                id="description"
                label="⭐ Description"
                value={description}
                onChange={setDescription}
                placeholder="Add description"
                rows={10}
                error={errors.description}
              />
              
              <TextInput
                id="established"
                label="Lab Established Year"
                value={established}
                onChange={setEstablished}
                placeholder="e.g. 2006"
                error={errors.established}
                onValidate={(value) => {
                  if (errors.established) {
                    setErrors(prev => ({ ...prev, established: validateEstablished(value) }));
                  }
                }}
              />
            </div>
            
            {/* Right columns - Array fields */}
            <div className="col-span-1 md:col-span-2">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Left array column */}
                <div>
                  <HiringStatus
                    hiringStatus={hiringStatus}
                    setHiringStatus={setHiringStatus}
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
                      onValidate={(newArray) => setErrors(prev => ({ 
                        ...prev, 
                        professorIds: validateProfessorIds(newArray) 
                      }))}
                      infoText="Allow others in your lab to update this listing"
                    />
                  )}

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
                    onValidate={(newArray) => setErrors(prev => ({ 
                      ...prev, 
                      professorNames: validateProfessors(newArray) 
                    }))}
                  />

                  <ArrayInput
                    label="Emails"
                    items={emails}
                    setItems={setEmails}
                    placeholder="Add email"
                    bgColor="bg-green-100"
                    textColor="text-green-800"
                    buttonColor="text-green-500 hover:text-green-700"
                    error={errors.emails}
                    permanentValue={ownerEmail}
                    type="email"
                    onValidate={(newArray) => setErrors(prev => ({ 
                      ...prev, 
                      emails: validateEmails(newArray) 
                    }))}
                  />

                  <div className="mb-6 flex items-center">
                    <input
                      id="archived"
                      type="checkbox"
                      checked={archived}
                      onChange={(e) => setArchived(e.target.checked)}
                      className="mr-3 h-4 w-4 text-blue-500 focus:ring-blue-400 cursor-pointer"
                    />
                    <label className="text-gray-700 text-sm font-bold cursor-pointer" htmlFor="archived">
                      Archive this listing
                    </label>
                  </div>
                </div>

                {/* Right array column */}
                <div>
                  <DepartmentInput
                    departments={departments}
                    availableDepartments={availableDepartments}
                    onAddDepartment={handleAddDepartment}
                    onRemoveDepartment={handleRemoveDepartment}
                  />
                  
                  <ArrayInput
                    label="Websites"
                    items={websites}
                    setItems={setWebsites}
                    placeholder="Add website URL"
                    bgColor="bg-yellow-100"
                    textColor="text-yellow-800"
                    buttonColor="text-yellow-500 hover:text-yellow-700"
                    error={errors.websites}
                    type="url"
                    onValidate={(newArray) => setErrors(prev => ({ 
                      ...prev, 
                      websites: validateWebsites(newArray) 
                    }))}
                  />

                  <ArrayInput
                    label="Keywords (for search)"
                    items={keywords}
                    setItems={setKeywords}
                    placeholder="Add keyword"
                    bgColor="bg-gray-100"
                    textColor="text-gray-800"
                    buttonColor="text-gray-500 hover:text-gray-700"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Application Settings - Full Width Bottom Section */}
          <div className="mt-8 p-6 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl border border-blue-200">
            <div className="flex items-center mb-6">
              <div className="flex items-center">
                <input
                  id="applicationsEnabled"
                  type="checkbox"
                  checked={applicationsEnabled}
                  onChange={(e) => setApplicationsEnabled(e.target.checked)}
                  className="mr-3 h-5 w-5 text-blue-600 focus:ring-blue-500 cursor-pointer rounded"
                />
                <label className="text-gray-800 text-lg font-semibold cursor-pointer flex items-center" htmlFor="applicationsEnabled">
                  <svg className="w-6 h-6 mr-3 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Enable student applications
                </label>
              </div>
            </div>
            
            {applicationsEnabled && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-gray-800 text-lg font-semibold">
                    Application Questions
                  </h3>
                  <span className="text-sm text-gray-600 bg-white px-3 py-1 rounded-full border">
                    {applicationQuestions.length} question{applicationQuestions.length !== 1 ? 's' : ''}
                  </span>
                </div>
                
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {applicationQuestions.map((question, index) => (
                    <div key={index} className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm">
                      <div className="space-y-3">
                        <div>
                          <input
                            type="text"
                            value={question.question}
                            onChange={(e) => {
                              const newQuestions = [...applicationQuestions];
                              newQuestions[index].question = e.target.value;
                              setApplicationQuestions(newQuestions);
                            }}
                            placeholder="What would you like to ask applicants?"
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <label className="flex items-center text-sm text-gray-600">
                            <input
                              type="checkbox"
                              checked={question.required}
                              onChange={(e) => {
                                const newQuestions = [...applicationQuestions];
                                newQuestions[index].required = e.target.checked;
                                setApplicationQuestions(newQuestions);
                              }}
                              className="mr-2 h-4 w-4 text-blue-600 focus:ring-blue-500"
                            />
                            Required question
                          </label>
                          <button
                            type="button"
                            onClick={() => {
                              const newQuestions = applicationQuestions.filter((_, i) => i !== index);
                              setApplicationQuestions(newQuestions);
                            }}
                            className="p-2 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
                            title="Remove question"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                  
                  <button
                    type="button"
                    onClick={() => {
                      setApplicationQuestions([...applicationQuestions, { question: '', required: false }]);
                    }}
                    className="bg-white p-5 border-2 border-dashed border-blue-300 rounded-lg text-blue-600 hover:border-blue-400 hover:bg-blue-50 transition-colors flex items-center justify-center space-x-3 h-full min-h-[120px]"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    </svg>
                    <span className="font-medium">Add Question</span>
                  </button>
                </div>
                
                <div className="bg-blue-100 border border-blue-200 rounded-lg p-4">
                  <div className="flex items-start space-x-3">
                    <svg className="w-6 h-6 text-blue-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div className="text-sm text-blue-800">
                      <p className="font-semibold mb-2">How it works:</p>
                      <p>Students will see these questions when they apply to your lab. Required questions must be answered before they can submit their application. You can add as many questions as needed to gather the information you want from applicants.</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
          
          {/* Form Actions */}
          <div className="mt-6 flex justify-end space-x-3">
            <button
              type="button"
              onClick={handleCancel}
              className={`bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline`}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={`bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline`}
            >
              Save
            </button>
          </div>
        </form>
      )}
    </div>
  );
};

export default ListingForm;
