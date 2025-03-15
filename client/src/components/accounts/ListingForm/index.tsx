import React, { useState, useEffect } from 'react';
import { NewListing } from '../../../types/types';
import { departmentNames } from '../../../utils/departmentNames';
import swal from "sweetalert";

import TextInput from './FormFields/TextInput';
import TextArea from './FormFields/TextArea';
import ArrayInput from './FormFields/ArrayInput';
import DepartmentInput from './FormFields/DepartmentInput';
import HiringStatus from './FormFields/HiringStatus';
import { validateTitle, validateDescription, validateEstablished, 
         validateProfessors, validateEmails, validateWebsites } from './utils/validation';
         
interface ListingFormProps {
  listing: NewListing;
  onCancel?: () => void;
  onSave?: (updatedListing: NewListing) => void;
}

const ListingForm = ({ listing, onCancel, onSave }: ListingFormProps) => {
  // Form state
  const [title, setTitle] = useState(listing.title);
  const [professorNames, setProfessorNames] = useState<string[]>([...listing.professorNames]);
  const ownerName = `${listing.ownerFirstName} ${listing.ownerLastName}`;
  const [departments, setDepartments] = useState<string[]>([...listing.departments]);
  const [availableDepartments, setAvailableDepartments] = useState<string[]>([]);
  const [emails, setEmails] = useState<string[]>([...listing.emails]);
  const ownerEmail = listing.ownerEmail;
  const [websites, setWebsites] = useState<string[]>(listing.websites ? [...listing.websites] : []);
  const [description, setDescription] = useState(listing.description);
  const [keywords, setKeywords] = useState<string[]>(listing.keywords ? [...listing.keywords] : []);
  const [established, setEstablished] = useState(listing.established || '');
  const [hiringStatus, setHiringStatus] = useState(listing.hiringStatus);
  const [archived, setArchived] = useState(listing.archived);
  
  // Form errors
  const [errors, setErrors] = useState<{
    title?: string;
    description?: string;
    established?: string;
    professorNames?: string;
    emails?: string;
    websites?: string;
  }>({});

  // Initialize available departments
  useEffect(() => {
    setAvailableDepartments(
      departmentNames.filter(dept => !departments.includes(dept)).sort()
    );
  }, []);

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
    } else {
      console.log('Validation errors:', filteredErrors);
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
            onClick={onCancel}
            className="bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline"
          >
            Save
          </button>
        </div>
      </form>
    </div>
  );
};

export default ListingForm;