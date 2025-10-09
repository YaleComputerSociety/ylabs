import React, { useState, useEffect, useContext } from 'react';
import { Application } from '../types/types';
import UserContext from '../contexts/UserContext';
import axios, { backendBaseURL } from '../utils/axios';
import swal from 'sweetalert';

const StudentApplications = () => {
  const { user } = useContext(UserContext);
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<'all' | 'pending' | 'accepted' | 'rejected'>('all');

  useEffect(() => {
    if (user) {
      fetchApplications();
    }
  }, [user, filter]);

  const fetchApplications = async () => {
    if (!user) return;
    
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (filter !== 'all') {
        params.append('status', filter);
      }
      
      const response = await axios.get(`/applications/student/${user.netId}?${params}`, {
        withCredentials: true
      });
      setApplications(response.data.applications || []);
    } catch (error) {
      console.error('Error fetching applications:', error);
      swal('Error', 'Failed to load applications', 'error');
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'accepted':
        return 'bg-green-100 text-green-800';
      case 'rejected':
        return 'bg-red-100 text-red-800';
      case 'pending':
      default:
        return 'bg-yellow-100 text-yellow-800';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'accepted':
        return 'Accepted';
      case 'rejected':
        return 'Rejected';
      case 'pending':
      default:
        return 'Pending';
    }
  };

  const filteredApplications = applications.filter(app => 
    filter === 'all' || app.status === filter
  );

  if (!user || !['undergraduate', 'graduate'].includes(user.userType)) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="text-center py-12">
          <h3 className="text-lg font-medium text-gray-900 mb-2">Access Denied</h3>
          <p className="text-gray-500">
            Only students can view applications.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-800 mb-2">My Applications</h1>
        <p className="text-gray-600">Track your lab applications and their status</p>
      </div>

      {/* Filter Tabs */}
      <div className="mb-6">
        <div className="flex space-x-1 bg-gray-100 p-1 rounded-lg w-fit">
          {[
            { key: 'all', label: 'All', count: applications.length },
            { key: 'pending', label: 'Pending', count: applications.filter(app => app.status === 'pending').length },
            { key: 'accepted', label: 'Accepted', count: applications.filter(app => app.status === 'accepted').length },
            { key: 'rejected', label: 'Rejected', count: applications.filter(app => app.status === 'rejected').length },
          ].map(({ key, label, count }) => (
            <button
              key={key}
              onClick={() => setFilter(key as any)}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                filter === key
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              {label} ({count})
            </button>
          ))}
        </div>
      </div>

      {/* Applications List */}
      {loading ? (
        <div className="flex justify-center items-center h-32">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        </div>
      ) : filteredApplications.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-gray-400 mb-4">
            <svg className="mx-auto h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            {filter === 'all' ? 'No applications yet' : `No ${filter} applications`}
          </h3>
          <p className="text-gray-500">
            {filter === 'all' 
              ? 'You haven\'t applied to any labs yet. Browse available labs and submit applications.'
              : `You don't have any ${filter} applications.`
            }
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredApplications.map((application) => (
            <div key={application._id} className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">
                    {application.listing?.title || 'Lab Application'}
                  </h3>
                  <p className="text-gray-600">
                    {application.listing?.ownerFirstName} {application.listing?.ownerLastName}
                  </p>
                  <p className="text-sm text-gray-500">
                    Applied {new Date(application.appliedAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center space-x-3">
                  <span className={`inline-flex px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(application.status)}`}>
                    {getStatusText(application.status)}
                  </span>
                </div>
              </div>

              {/* Application Details */}
              <div className="space-y-3">
                {application.coverLetter && (
                  <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-1">Cover Letter</h4>
                    <p className="text-sm text-gray-600 whitespace-pre-wrap">
                      {application.coverLetter}
                    </p>
                  </div>
                )}

                {application.customQuestions && application.customQuestions.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-2">Application Questions</h4>
                    <div className="space-y-2">
                      {application.customQuestions.map((qa, index) => (
                        <div key={index} className="text-sm">
                          <p className="font-medium text-gray-700">{qa.question}</p>
                          <p className="text-gray-600 mt-1 whitespace-pre-wrap">{qa.answer || 'No answer provided'}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {application.resumeUrl && (
                  <div>
                    <a
                      href={`${backendBaseURL}${application.resumeUrl}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center text-sm text-blue-600 hover:text-blue-800"
                    >
                      <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      View Resume
                    </a>
                  </div>
                )}

                {application.professorNotes && (
                  <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-1">Professor Notes</h4>
                    <p className="text-sm text-gray-600 whitespace-pre-wrap">
                      {application.professorNotes}
                    </p>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default StudentApplications;
