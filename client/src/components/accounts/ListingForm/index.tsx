import React, { useState, useEffect } from 'react';
import { NewListing } from '../../../types/types';
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
         validateProfessors, validateEmails, validateWebsites } from './utils/validation';
import { createListing } from '../../../utils/apiCleaner';
         
interface ListingFormProps {
  listing: NewListing;
  isCreated: boolean;
  onLoad: (updatedListing: NewListing, success: boolean) => void;
  onCancel?: () => void;
  onSave?: (updatedListing: NewListing) => void;
  onCreate?: (newListing: NewListing) => void;
}

const ListingForm = ({ listing, isCreated, onLoad, onCancel, onSave, onCreate }: ListingFormProps) => {
  // Form state
  const [title, setTitle] = useState(listing.title);
  const [professorNames, setProfessorNames] = useState<string[]>([...listing.professorNames]);
  const [ownerName, setOwnerName] = useState<string>(`${listing.ownerFirstName} ${listing.ownerLastName}`);
  const [departments, setDepartments] = useState<string[]>([...listing.departments]);
  const [availableDepartments, setAvailableDepartments] = useState<string[]>([]);
  const [emails, setEmails] = useState<string[]>([...listing.emails]);
  const [ownerEmail, setOwnerEmail] = useState<string>(listing.ownerEmail);
  const [websites, setWebsites] = useState<string[]>(listing.websites ? [...listing.websites] : []);
  const [description, setDescription] = useState(listing.description);
  const [keywords, setKeywords] = useState<string[]>(listing.keywords ? [...listing.keywords] : []);
  const [established, setEstablished] = useState(listing.established || '');
  const [hiringStatus, setHiringStatus] = useState(listing.hiringStatus);
  const [archived, setArchived] = useState(listing.archived);
  const [loading, setLoading] = useState(true);
  
  // Form errors
  const [errors, setErrors] = useState<{
    title?: string;
    description?: string;
    established?: string;
    professorNames?: string;
    emails?: string;
    websites?: string;
  }>({});

  // Get most recent listing and initialize available departments
  useEffect(() => {
    if (!isCreated) {
      setLoading(true);
      axios.get(`/newListings/${listing.id}`, { withCredentials: true }).then((response) => {
        if (!response.data.listing) {
          console.error(`Response, but no listing ${listing.id}:`, response.data);
          onLoad(listing, false);
          return;
        }
        const newListing = createListing(response.data.listing);
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

        onLoad(newListing, true);

        setAvailableDepartments(
          departmentNames.filter(dept => !newListing.departments.includes(dept)).sort()
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
    const updatedListing: NewListing = {
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
      archived
    };
    onLoad(updatedListing, true);
  }, [title, professorNames, departments, emails, websites, description, keywords, established, hiringStatus, archived]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate all required fields
    const validationErrors = {
      title: validateTitle(title),
      description: validateDescription(description),
      established: validateEstablished(established),
      professorNames: validateProfessors([ownerName, ...professorNames]),
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
      const updatedListing: NewListing = {
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
        archived
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
  console.log("CANCELLED LOL")
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
                label="Listing Title"
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
                label="Description"
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

                  <HiringStatus
                    hiringStatus={hiringStatus}
                    setHiringStatus={setHiringStatus}
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
          
          {/* Form Actions */}
          <div className="absolute bottom-6 right-6 flex space-x-3 bg-white py-2 px-1">
            <button
              type="button"
              onClick={handleCancel}
              className={`${isCreated ? "bg-red-500 hover:bg-red-700 text-white" : "bg-gray-300 hover:bg-gray-400 text-gray-800"} font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline`}
            >
              {isCreated ? "Delete" : "Cancel"}
            </button>
            <button
              type="submit"
              className={`${isCreated ? "bg-green-500 hover:bg-green-700" : "bg-blue-500 hover:bg-blue-700"} text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline`}
            >
              {isCreated ? "Create" : "Save"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};

export default ListingForm;
