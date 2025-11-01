import React, { useState, useEffect, useContext } from 'react';
import { Application, ApplicationStats } from '../types/types';
import UserContext from '../contexts/UserContext';
import axios, { backendBaseURL } from '../utils/axios';
import swal from 'sweetalert';

const ProfessorDashboard = () => {
  const { user } = useContext(UserContext);
  const [applications, setApplications] = useState<Application[]>([]);
  const [stats, setStats] = useState<ApplicationStats>({ total: 0, pending: 0, accepted: 0, rejected: 0 });
  const [loading, setLoading] = useState(false);
  const [selectedListing, setSelectedListing] = useState<string>('');
  const [filter, setFilter] = useState<'all' | 'pending' | 'accepted' | 'rejected'>('all');
  const [userListings, setUserListings] = useState<any[]>([]);
  const [listingsLoading, setListingsLoading] = useState(true);

  useEffect(() => {
    if (user) {
      fetchUserListings();
    }
  }, [user]);

  useEffect(() => {
    if (user && selectedListing) {
      fetchApplications();
      fetchStats();
    }
  }, [user, selectedListing, filter]);

  const fetchUserListings = async () => {
    if (!user) return;
    
    try {
      setListingsLoading(true);
      const response = await axios.get('/users/listings', {
        withCredentials: true
      });
      const listings = response.data.ownListings || [];
      setUserListings(listings);
      
      // Auto-select first listing with applications enabled
      const firstWithApps = listings.find((listing: any) => listing.applicationsEnabled);
      if (firstWithApps) {
        setSelectedListing(firstWithApps._id);
      }
    } catch (error) {
      console.error('Error fetching user listings:', error);
    } finally {
      setListingsLoading(false);
    }
  };

  const fetchApplications = async () => {
    if (!user || !selectedListing) return;
    
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (filter !== 'all') {
        params.append('status', filter);
      }
      
      const response = await axios.get(`/applications/listing/${selectedListing}?${params}`, {
        withCredentials: true
      });
      setApplications(response.data.applications || []);
    } catch (error) {
      console.error('Error fetching applications:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    if (!user || !selectedListing) return;
    
    try {
      const response = await axios.get(`/applications/listing/${selectedListing}/stats`, {
        withCredentials: true
      });
      setStats(response.data.stats);
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  };

  const updateApplicationStatus = async (applicationId: string, status: string) => {
    try {
      const response = await axios.put(`/applications/${applicationId}/status`, {
        status
      }, {
        withCredentials: true
      });

      // Update local state
      setApplications(prev => prev.map(app => 
        app._id === applicationId 
          ? { ...app, status, updatedAt: new Date().toISOString() }
          : app
      ));

      // Update stats
      await fetchStats();

      swal('Success', `Application ${status} successfully`, 'success');
    } catch (error) {
      console.error('Error updating application status:', error);
      swal('Error', 'Failed to update application status', 'error');
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

  if (listingsLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  const listingsWithApps = userListings.filter((listing: any) => listing.applicationsEnabled);

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-800 mb-2">Application Dashboard</h1>
        <p className="text-gray-600">Manage student applications for your labs</p>
      </div>

      {/* Listing Selector */}
      {listingsWithApps.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-gray-400 mb-4">
            <svg className="mx-auto h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">No labs with applications enabled</h3>
          <p className="text-gray-500">
            Enable applications on your lab listings to start receiving student applications.
          </p>
        </div>
      ) : (
        <>
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Select Lab to Manage Applications
            </label>
            <select
              value={selectedListing}
              onChange={(e) => setSelectedListing(e.target.value)}
              className="w-full max-w-md px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Choose a lab...</option>
              {listingsWithApps.map((listing: any) => (
                <option key={listing._id} value={listing._id}>
                  {listing.title}
                </option>
              ))}
            </select>
          </div>

          {selectedListing && (
            <>
              {/* Stats Cards */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-white p-4 rounded-lg shadow-sm border">
                  <div className="text-2xl font-bold text-gray-900">{stats.total}</div>
                  <div className="text-sm text-gray-600">Total Applications</div>
                </div>
                <div className="bg-white p-4 rounded-lg shadow-sm border">
                  <div className="text-2xl font-bold text-yellow-600">{stats.pending}</div>
                  <div className="text-sm text-gray-600">Pending</div>
                </div>
                <div className="bg-white p-4 rounded-lg shadow-sm border">
                  <div className="text-2xl font-bold text-green-600">{stats.accepted}</div>
                  <div className="text-sm text-gray-600">Accepted</div>
                </div>
                <div className="bg-white p-4 rounded-lg shadow-sm border">
                  <div className="text-2xl font-bold text-red-600">{stats.rejected}</div>
                  <div className="text-sm text-gray-600">Rejected</div>
                </div>
              </div>

              {/* Filter Tabs */}
              <div className="mb-6">
                <div className="flex space-x-1 bg-gray-100 p-1 rounded-lg w-fit">
                  {[
                    { key: 'all', label: 'All', count: stats.total },
                    { key: 'pending', label: 'Pending', count: stats.pending },
                    { key: 'accepted', label: 'Accepted', count: stats.accepted },
                    { key: 'rejected', label: 'Rejected', count: stats.rejected },
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
                      ? 'Students will appear here when they apply to your labs.'
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
                            {application.studentName} ({application.studentNetId})
                          </h3>
                          <p className="text-gray-600">{application.studentEmail}</p>
                          <p className="text-sm text-gray-500">
                            Applied {new Date(application.appliedAt).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="flex items-center space-x-3">
                          <span className={`inline-flex px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(application.status)}`}>
                            {getStatusText(application.status)}
                          </span>
                          
                          {application.status === 'pending' && (
                            <div className="flex space-x-2">
                              <button
                                onClick={() => {
                                  swal({
                                    title: 'Accept Application',
                                    text: 'Are you sure you want to accept this application?',
                                    icon: 'warning',
                                    buttons: ['Cancel', 'Accept'],
                                  }).then((willAccept) => {
                                    if (willAccept) {
                                      updateApplicationStatus(application._id, 'accepted');
                                    }
                                  });
                                }}
                                className="px-3 py-1 bg-green-600 text-white text-sm rounded-md hover:bg-green-700"
                              >
                                Accept
                              </button>
                              <button
                                onClick={() => {
                                  swal({
                                    title: 'Reject Application',
                                    text: 'Are you sure you want to reject this application?',
                                    icon: 'warning',
                                    buttons: ['Cancel', 'Reject'],
                                    dangerMode: true,
                                  }).then((willReject) => {
                                    if (willReject) {
                                      updateApplicationStatus(application._id, 'rejected');
                                    }
                                  });
                                }}
                                className="px-3 py-1 bg-red-600 text-white text-sm rounded-md hover:bg-red-700"
                              >
                                Reject
                              </button>
                            </div>
                          )}
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

                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
};

export default ProfessorDashboard;

