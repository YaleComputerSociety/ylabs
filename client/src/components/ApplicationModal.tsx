import React, { useState, useContext } from 'react';
import { NewListing, Application } from '../types/types';
import UserContext from '../contexts/UserContext';
import axios from '../utils/axios';
import swal from 'sweetalert';

interface ApplicationModalProps {
  isOpen: boolean;
  onClose: () => void;
  listing: NewListing;
  onApplicationSubmitted?: (application: Application) => void;
}

const ApplicationModal = ({ isOpen, onClose, listing, onApplicationSubmitted }: ApplicationModalProps) => {
  const { user } = useContext(UserContext);
  const [coverLetter, setCoverLetter] = useState('');
  const [customAnswers, setCustomAnswers] = useState<{[key: number]: string}>({});
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);

  if (!isOpen || !user || !listing.applicationsEnabled) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Check file size (5MB limit)
      if (file.size > 5 * 1024 * 1024) {
        swal('Error', 'File size must be less than 5MB', 'error');
        return;
      }
      // Check file type
      const allowedTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
      if (!allowedTypes.includes(file.type)) {
        swal('Error', 'Only PDF, DOC, and DOCX files are allowed', 'error');
        return;
      }
      setResumeFile(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!user) return;

    // Validate required questions
    const requiredQuestions = listing.applicationQuestions?.filter(q => q.required) || [];
    for (const question of requiredQuestions) {
      const questionIndex = listing.applicationQuestions?.indexOf(question) || 0;
      if (!customAnswers[questionIndex]?.trim()) {
        swal('Error', `Please answer the required question: "${question.question}"`, 'error');
        return;
      }
    }

    setLoading(true);

    try {
      const formData = new FormData();
      formData.append('listingId', listing.id);
      formData.append('studentId', user.netId);
      formData.append('studentName', `${user.fname || ''} ${user.lname || ''}`.trim());
      formData.append('studentEmail', user.email || '');
      formData.append('studentNetId', user.netId);
      formData.append('coverLetter', coverLetter);
      
      if (resumeFile) {
        formData.append('resume', resumeFile);
      }

      // Prepare custom questions answers
      const customQuestions = listing.applicationQuestions?.map((question, index) => ({
        question: question.question,
        answer: customAnswers[index] || ''
      })) || [];
      formData.append('customQuestions', JSON.stringify(customQuestions));

      const response = await axios.post('/applications/submit', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        withCredentials: true
      });

      swal('Success', 'Your application has been submitted successfully!', 'success');
      
      if (onApplicationSubmitted) {
        onApplicationSubmitted(response.data.application);
      }
      
      onClose();
    } catch (error: any) {
      console.error('Error submitting application:', error);
      const errorMessage = error.response?.data?.error || 'Failed to submit application';
      swal('Error', errorMessage, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div 
      className="fixed inset-0 bg-black/65 z-50 flex items-center justify-center overflow-y-auto p-4 pt-24" 
      onClick={handleBackdropClick}
    >
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-6">
          {/* Header */}
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-bold text-gray-800">
              Apply to {listing.title}
            </h2>
            <button 
              onClick={onClose} 
              className="p-1 rounded-full hover:bg-gray-100"
              aria-label="Close"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Resume Upload */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Resume (PDF, DOC, DOCX - Max 5MB)
              </label>
              <input
                type="file"
                onChange={handleFileChange}
                accept=".pdf,.doc,.docx"
                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
              />
              {resumeFile && (
                <p className="mt-1 text-sm text-green-600">
                  Selected: {resumeFile.name}
                </p>
              )}
            </div>

            {/* Cover Letter */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Cover Letter (Optional)
              </label>
              <textarea
                value={coverLetter}
                onChange={(e) => setCoverLetter(e.target.value)}
                rows={6}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Tell us why you're interested in this lab..."
              />
            </div>

            {/* Custom Questions */}
            {listing.applicationQuestions && listing.applicationQuestions.length > 0 && (
              <div>
                <h3 className="text-lg font-medium text-gray-800 mb-4">Application Questions</h3>
                <div className="space-y-4">
                  {listing.applicationQuestions.map((question, index) => (
                    <div key={index}>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {question.question}
                        {question.required && <span className="text-red-500 ml-1">*</span>}
                      </label>
                      <textarea
                        value={customAnswers[index] || ''}
                        onChange={(e) => setCustomAnswers(prev => ({
                          ...prev,
                          [index]: e.target.value
                        }))}
                        rows={3}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Your answer..."
                        required={question.required}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Submit Button */}
            <div className="flex justify-end space-x-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-gray-700 bg-gray-200 hover:bg-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-gray-500"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {loading ? 'Submitting...' : 'Submit Application'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default ApplicationModal;

