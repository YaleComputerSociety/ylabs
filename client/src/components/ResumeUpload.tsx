import React, { useState, useContext } from 'react';
import UserContext from '../contexts/UserContext';
import axios from '../utils/axios';
import swal from 'sweetalert';

const ResumeUpload = () => {
  const { user, setUser } = useContext(UserContext);
  const [loading, setLoading] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const handleFileUpload = async (file: File) => {
    if (!user) return;

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

    setLoading(true);

    try {
      const formData = new FormData();
      formData.append('resume', file);
      formData.append('userId', user.netId);

      const response = await axios.post('/applications/upload-resume', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        withCredentials: true
      });

      // Update user context with new resume URL
      if (setUser) {
        setUser({
          ...user,
          resumeUrl: response.data.resumeUrl
        });
      }

      swal('Success', 'Resume uploaded successfully!', 'success');
    } catch (error: any) {
      console.error('Error uploading resume:', error);
      const errorMessage = error.response?.data?.error || 'Failed to upload resume';
      swal('Error', errorMessage, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileUpload(file);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    
    const file = e.dataTransfer.files[0];
    if (file) {
      handleFileUpload(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
  };

  const removeResume = async () => {
    if (!user) return;

    try {
      // You would need to implement a delete endpoint on the backend
      // For now, we'll just update the local state
      if (setUser) {
        setUser({
          ...user,
          resumeUrl: undefined
        });
      }
      swal('Success', 'Resume removed successfully!', 'success');
    } catch (error) {
      console.error('Error removing resume:', error);
      swal('Error', 'Failed to remove resume', 'error');
    }
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-sm border">
      <h3 className="text-lg font-semibold text-gray-800 mb-4">Resume Management</h3>
      
      {user?.resumeUrl ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-green-50 border border-green-200 rounded-lg">
            <div className="flex items-center">
              <svg className="w-8 h-8 text-green-600 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <div>
                <p className="text-sm font-medium text-green-800">Resume uploaded</p>
                <p className="text-xs text-green-600">Ready for lab applications</p>
              </div>
            </div>
            <div className="flex space-x-2">
              <a
                href={user.resumeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-600 hover:text-blue-800"
              >
                View
              </a>
              <button
                onClick={removeResume}
                className="text-sm text-red-600 hover:text-red-800"
              >
                Remove
              </button>
            </div>
          </div>
          
          <div className="text-center">
            <label className="cursor-pointer">
              <span className="text-sm text-blue-600 hover:text-blue-800">
                Upload a different resume
              </span>
              <input
                type="file"
                onChange={handleFileChange}
                accept=".pdf,.doc,.docx"
                className="hidden"
                disabled={loading}
              />
            </label>
          </div>
        </div>
      ) : (
        <div
          className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
            dragActive
              ? 'border-blue-400 bg-blue-50'
              : 'border-gray-300 hover:border-gray-400'
          }`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          <svg className="mx-auto h-12 w-12 text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          
          <div className="space-y-2">
            <p className="text-sm text-gray-600">
              <span className="font-medium text-blue-600 hover:text-blue-500">
                Click to upload
              </span>
              {' '}or drag and drop
            </p>
            <p className="text-xs text-gray-500">
              PDF, DOC, or DOCX (max 5MB)
            </p>
          </div>
          
          <input
            type="file"
            onChange={handleFileChange}
            accept=".pdf,.doc,.docx"
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            disabled={loading}
          />
        </div>
      )}

      {loading && (
        <div className="mt-4 text-center">
          <div className="inline-flex items-center text-sm text-gray-600">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500 mr-2"></div>
            Uploading...
          </div>
        </div>
      )}

      <div className="mt-4 text-xs text-gray-500">
        <p>• Your resume will be automatically attached to lab applications</p>
        <p>• Supported formats: PDF, DOC, DOCX</p>
        <p>• Maximum file size: 5MB</p>
      </div>
    </div>
  );
};

export default ResumeUpload;

