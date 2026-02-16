/**
 * Listing creation and edit form with all fields.
 */
import React, { useState, useEffect, useContext, useMemo } from 'react';
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
  const [applicantDescription, setApplicantDescription] = useState(listing.applicantDescription || '');
  const [researchAreas, setResearchAreas] = useState<string[]>(listing.researchAreas ? [...listing.researchAreas] : (listing.keywords ? [...listing.keywords] : []));
  const [established, setEstablished] = useState(listing.established || '');
  const [hiringStatus, setHiringStatus] = useState(listing.hiringStatus);
  const [archived, setArchived] = useState(listing.archived);
  const [loading, setLoading] = useState(true);

  const { user } = useContext(UserContext);
  const isOwner = user && (user.netId === listing.ownerId);

  const [errors, setErrors] = useState<{
    title?: string;
    description?: string;
    established?: string;
    professorIds?: string;
    professorNames?: string;
    emails?: string;
    websites?: string;
    departments?: string;
  }>({});

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
        setTitle(listing.title);
        setProfessorNames([...listing.professorNames]);
        setOwnerName(`${listing.ownerFirstName} ${listing.ownerLastName}`);
        setDepartments([...listing.departments]);
        setEmails([...listing.emails]);
        setOwnerEmail(listing.ownerEmail);
        setWebsites(listing.websites ? [...listing.websites] : []);
        setDescription(listing.description);
        setApplicantDescription(listing.applicantDescription || '');
        setResearchAreas(listing.researchAreas ? [...listing.researchAreas] : (listing.keywords ? [...listing.keywords] : []));
        setEstablished(listing.established || '');
        setHiringStatus(listing.hiringStatus);
        setArchived(listing.archived);

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

    const filteredErrors = Object.fromEntries(
      Object.entries(validationErrors).filter(([_, value]) => value !== undefined)
    );

    setErrors(filteredErrors);

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
    const originalListing = { ...listing };
    setTitle(originalListing.title);
    setProfessorNames([...originalListing.professorNames]);
    setOwnerName(`${originalListing.ownerFirstName} ${originalListing.ownerLastName}`);
    setDepartments([...originalListing.departments]);
    setEmails([...originalListing.emails]);
    setOwnerEmail(originalListing.ownerEmail);
    setWebsites(originalListing.websites ? [...originalListing.websites] : []);
    setDescription(originalListing.description);
    setApplicantDescription(originalListing.applicantDescription || '');
    setResearchAreas(originalListing.researchAreas ? [...originalListing.researchAreas] : (originalListing.keywords ? [...originalListing.keywords] : []));
    setEstablished(originalListing.established || '');
    setHiringStatus(originalListing.hiringStatus);
    setArchived(originalListing.archived);

    onLoad({ ...originalListing }, true);

    if (onCancel) {
      onCancel();
    }
  }
};

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
                  setErrors(prev => ({ ...prev, title: validateTitle(value) }));
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
              onValidate={(newArray) => setErrors(prev => ({
                ...prev,
                professorNames: validateProfessors(newArray)
              }))}
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
              onValidate={(newArray) => setErrors(prev => ({
                ...prev,
                websites: validateWebsites(newArray)
              }))}
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
              onValidate={(newArray) => setErrors(prev => ({
                ...prev,
                emails: validateEmails(newArray)
              }))}
            />

            <ResearchAreaInput
              researchAreas={researchAreas}
              onAddResearchArea={(area) => setResearchAreas(prev => [...prev, area])}
              onRemoveResearchArea={(index) => setResearchAreas(prev => prev.filter((_, i) => i !== index))}
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
                  onValidate={(newArray) => setErrors(prev => ({
                    ...prev,
                    professorIds: validateProfessorIds(newArray)
                  }))}
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
                    setErrors(prev => ({ ...prev, established: validateEstablished(value) }));
                  }
                }}
              />

              <div className="flex items-center">
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
