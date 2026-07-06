/**
 * Analytics dashboard page for admin usage statistics.
 */
import { useEffect, useReducer } from 'react';
import axios from '../utils/axios';
import swal from 'sweetalert';
import AdminPanel from '../components/admin/AdminPanel';
import {
  analyticsReducer,
  createInitialAnalyticsState,
} from '../reducers/analyticsReducer';

const Analytics = () => {
  const [state, dispatch] = useReducer(
    analyticsReducer,
    undefined,
    () => createInitialAnalyticsState()
  );
  const { data, isLoading, lastUpdated } = state;

  const fetchAnalytics = async () => {
    dispatch({ type: 'FETCH_START' });
    try {
      const response = await axios.get('/analytics', { withCredentials: true });
      dispatch({
        type: 'FETCH_SUCCESS',
        payload: { data: response.data, timestamp: new Date().toLocaleString() },
      });
    } catch (error) {
      console.error('Error fetching analytics:', error);
      swal({
        text: 'Failed to load analytics data',
        icon: 'error',
      });
      dispatch({
        type: 'FETCH_FAILURE',
        payload: error instanceof Error ? error.message : 'Failed to load analytics data',
      });
    }
  };

  useEffect(() => {
    fetchAnalytics();
  }, []);

  if (isLoading || !data) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="text-xl">Loading analytics...</div>
      </div>
    );
  }

  const StatCard = ({
    title,
    value,
    subtitle,
  }: {
    title: string;
    value: number | string;
    subtitle?: string;
  }) => (
    <div className="bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden">
      <div
        className="h-0.5"
        style={{
          background: 'linear-gradient(90deg, #0055A4 0%, #3b82f6 60%, #93c5fd 100%)',
          opacity: 0.5,
        }}
      />
      <div className="p-6">
        <h3 className="text-sm font-medium text-gray-600 mb-2">{title}</h3>
        <p className="text-3xl font-bold text-gray-900">{value}</p>
        {subtitle && <p className="text-sm text-gray-500 mt-1">{subtitle}</p>}
      </div>
    </div>
  );

  const formatUserType = (type: string) => {
    const typeMap: { [key: string]: string } = {
      undergraduate: 'Undergrads',
      graduate: 'Graduates',
      professor: 'Professors',
      faculty: 'Faculty',
      admin: 'Admins',
      unknown: 'Unknown',
    };
    return typeMap[type] || type;
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-4xl font-bold">Analytics Dashboard</h1>
        <div className="text-right">
          <button
            onClick={fetchAnalytics}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors mb-2"
          >
            Refresh Data
          </button>
          <p className="text-sm text-gray-500">Last updated: {lastUpdated}</p>
        </div>
      </div>

      <section className="mb-10">
        <h2 className="text-2xl font-bold mb-4 text-gray-800 border-b-2 border-blue-600 pb-2">
          Visitor Statistics
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          <StatCard
            title="Total Visitors (Lifetime)"
            value={data.visitors.lifetime.total}
            subtitle="Unique users who've logged in"
          />
          <StatCard
            title="Visitors (Last 7 Days)"
            value={data.visitors.last7Days.total}
            subtitle="Active in past week"
          />
          <StatCard
            title="Visitors Today"
            value={data.visitors.today.total}
            subtitle="Logged in today"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          <StatCard
            title="Total Login Events"
            value={data.visitors.loginFrequency.totalLogins}
            subtitle="All-time login count"
          />
          <StatCard
            title="Logins (Last 7 Days)"
            value={data.visitors.loginFrequency.loginsLast7Days}
            subtitle="Total logins this week"
          />
          <StatCard
            title="Logins Today"
            value={data.visitors.loginFrequency.loginsToday}
            subtitle="Login events today"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white rounded-lg shadow-md p-6 border border-gray-200">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Lifetime Visitors by Type</h3>
            <div className="space-y-2">
              {data.visitors.lifetime.byType.map((item) => (
                <div key={item.userType} className="flex justify-between text-sm">
                  <span className="text-gray-600">{formatUserType(item.userType)}:</span>
                  <span className="font-medium">{item.count}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-md p-6 border border-gray-200">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Last 7 Days by Type</h3>
            <div className="space-y-2">
              {data.visitors.last7Days.byType.map((item) => (
                <div key={item.userType} className="flex justify-between text-sm">
                  <span className="text-gray-600">{formatUserType(item.userType)}:</span>
                  <span className="font-medium">{item.count}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-md p-6 border border-gray-200">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Today by Type</h3>
            <div className="space-y-2">
              {data.visitors.today.byType.length > 0 ? (
                data.visitors.today.byType.map((item) => (
                  <div key={item.userType} className="flex justify-between text-sm">
                    <span className="text-gray-600">{formatUserType(item.userType)}:</span>
                    <span className="font-medium">{item.count}</span>
                  </div>
                ))
              ) : (
                <p className="text-sm text-gray-500">No visitors yet today</p>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="mb-10">
        <h2 className="text-2xl font-bold mb-4 text-gray-800 border-b-2 border-blue-600 pb-2">
          User Engagement
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          <StatCard
            title="Total Searches"
            value={data.engagement.search.totalSearches}
            subtitle="All-time search queries"
          />
          <StatCard
            title="Searches (Last 7 Days)"
            value={data.engagement.search.searchesLast7Days}
            subtitle="Recent searches"
          />
          <StatCard
            title="Searches Today"
            value={data.engagement.search.searchesToday}
            subtitle="Searches today"
          />
        </div>

        {data.engagement.topSearchQueries.length > 0 && (
          <div className="bg-white rounded-lg shadow-md p-6 border border-gray-200 mb-6">
            <h3 className="text-lg font-semibold text-gray-700 mb-4">
              Top Search Queries (Last 30 Days)
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {data.engagement.topSearchQueries.map((item, index) => (
                <div key={index} className="flex justify-between border-b pb-2">
                  <span className="text-gray-700">{item.query || '(empty search)'}</span>
                  <span className="font-medium text-blue-600">{item.count} searches</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          <StatCard
            title="Total View Events"
            value={data.engagement.views.totalViews}
            subtitle="Listing views tracked"
          />
          <StatCard
            title="Views (Last 7 Days)"
            value={data.engagement.views.viewsLast7Days}
            subtitle="Recent views"
          />
          <StatCard
            title="Views Today"
            value={data.engagement.views.viewsToday}
            subtitle="Views today"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <StatCard
            title="Active Users (Last 7 Days)"
            value={data.engagement.userActivity.activeUsers}
            subtitle="Users with activity"
          />
          <StatCard
            title="Avg Events Per User"
            value={data.engagement.userActivity.avgEventsPerUser.toFixed(1)}
            subtitle="Last 7 days"
          />
        </div>
      </section>

      {data.engagement.mostActiveUsers.length > 0 && (
        <section className="mb-10">
          <h2 className="text-2xl font-bold mb-4 text-gray-800 border-b-2 border-blue-600 pb-2">
            Most Active Users (Last 30 Days)
          </h2>
          <div className="bg-white rounded-lg shadow-md p-6 border border-gray-200">
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-4 font-semibold text-gray-700">User ID</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-700">Type</th>
                    <th className="text-right py-3 px-4 font-semibold text-gray-700">Events</th>
                  </tr>
                </thead>
                <tbody>
                  {data.engagement.mostActiveUsers.map((user) => (
                    <tr key={user.userId} className="border-b hover:bg-gray-50">
                      <td className="py-3 px-4 text-gray-800">{user.userId}</td>
                      <td className="py-3 px-4 text-gray-600">{formatUserType(user.userType)}</td>
                      <td className="py-3 px-4 text-right font-medium">{user.eventCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {data.engagement.trendingListings.length > 0 && (
        <section className="mb-10">
          <h2 className="text-2xl font-bold mb-4 text-gray-800 border-b-2 border-blue-600 pb-2">
            Trending Listings (Last 30 Days)
          </h2>
          <div className="bg-white rounded-lg shadow-md p-6 border border-gray-200">
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-4 font-semibold text-gray-700">Title</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-700">Owner</th>
                    <th className="text-right py-3 px-4 font-semibold text-gray-700">Views</th>
                    <th className="text-right py-3 px-4 font-semibold text-gray-700">
                      Unique Viewers
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.engagement.trendingListings.map((listing) => (
                    <tr key={listing.listingId} className="border-b hover:bg-gray-50">
                      <td className="py-3 px-4 text-gray-800">{listing.title}</td>
                      <td className="py-3 px-4 text-gray-600">
                        {listing.ownerFirstName} {listing.ownerLastName}
                      </td>
                      <td className="py-3 px-4 text-right font-medium">{listing.views}</td>
                      <td className="py-3 px-4 text-right font-medium">{listing.uniqueViewers}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      <section className="mb-10">
        <h2 className="text-2xl font-bold mb-4 text-gray-800 border-b-2 border-blue-600 pb-2">
          Listings Overview
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
          <StatCard title="Total Listings" value={data.listings.overview.total} />
          <StatCard title="Active Listings" value={data.listings.overview.active} />
          <StatCard title="Archived Listings" value={data.listings.overview.archived} />
          <StatCard title="Unconfirmed Listings" value={data.listings.overview.unconfirmed} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <StatCard
            title="New Listings (Last 7 Days)"
            value={data.listings.newListingsLast7Days}
            subtitle="Created in past week"
          />
          <StatCard
            title="New Listings Today"
            value={data.listings.newListingsToday}
            subtitle="Created today"
          />
          <StatCard
            title="Listings with 0 Views"
            value={data.listings.listingsWithZeroViews}
            subtitle="May need attention"
          />
        </div>
      </section>

      <section className="mb-10">
        <h2 className="text-2xl font-bold mb-4 text-gray-800 border-b-2 border-blue-600 pb-2">
          Cumulative Engagement Metrics
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard title="Total Views (Counter)" value={data.engagement.totalViewsFromCounters} />
          <StatCard
            title="Total Favorites (Counter)"
            value={data.engagement.totalFavoritesFromCounters}
          />
          <StatCard title="Avg Views per Listing" value={data.engagement.avgViews.toFixed(1)} />
          <StatCard
            title="Avg Favorites per Listing"
            value={data.engagement.avgFavorites.toFixed(1)}
          />
        </div>
      </section>

      <section className="mb-10">
        <h2 className="text-2xl font-bold mb-4 text-gray-800 border-b-2 border-blue-600 pb-2">
          Views by Department
        </h2>
        <div className="bg-white rounded-lg shadow-md p-6 border border-gray-200">
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-4 font-semibold text-gray-700">Department</th>
                  <th className="text-right py-3 px-4 font-semibold text-gray-700">Total Views</th>
                  <th className="text-right py-3 px-4 font-semibold text-gray-700">Listings</th>
                  <th className="text-right py-3 px-4 font-semibold text-gray-700">Avg Views</th>
                </tr>
              </thead>
              <tbody>
                {data.engagement.viewsByDepartment.slice(0, 15).map((dept) => (
                  <tr key={dept.department} className="border-b hover:bg-gray-50">
                    <td className="py-3 px-4 text-gray-800">{dept.department}</td>
                    <td className="py-3 px-4 text-right font-medium">{dept.totalViews}</td>
                    <td className="py-3 px-4 text-right">{dept.listingCount}</td>
                    <td className="py-3 px-4 text-right">{dept.avgViews}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="mb-10">
        <h2 className="text-2xl font-bold mb-4 text-gray-800 border-b-2 border-blue-600 pb-2">
          Listings by Department
        </h2>
        <div className="bg-white rounded-lg shadow-md p-6 border border-gray-200">
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-4 font-semibold text-gray-700">Department</th>
                  <th className="text-right py-3 px-4 font-semibold text-gray-700">Listings</th>
                </tr>
              </thead>
              <tbody>
                {data.listings.byDepartment.slice(0, 15).map((dept) => (
                  <tr key={dept.department} className="border-b hover:bg-gray-50">
                    <td className="py-3 px-4 text-gray-800">{dept.department}</td>
                    <td className="py-3 px-4 text-right font-medium">{dept.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="mb-10">
        <h2 className="text-2xl font-bold mb-4 text-gray-800 border-b-2 border-blue-600 pb-2">
          Top Professors by Listings
        </h2>
        <div className="bg-white rounded-lg shadow-md p-6 border border-gray-200">
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-4 font-semibold text-gray-700">Professor</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-700">NetID</th>
                  <th className="text-right py-3 px-4 font-semibold text-gray-700">Listings</th>
                </tr>
              </thead>
              <tbody>
                {data.listings.byProfessor.map((prof) => (
                  <tr key={prof.netId} className="border-b hover:bg-gray-50">
                    <td className="py-3 px-4 text-gray-800">{prof.professorName}</td>
                    <td className="py-3 px-4 text-gray-600">{prof.netId}</td>
                    <td className="py-3 px-4 text-right font-medium">{prof.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="mb-10">
        <h2 className="text-2xl font-bold mb-4 text-gray-800 border-b-2 border-blue-600 pb-2">
          Top 10 Most Viewed Listings (All-Time)
        </h2>
        <div className="bg-white rounded-lg shadow-md p-6 border border-gray-200">
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-4 font-semibold text-gray-700">Title</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-700">Owner</th>
                  <th className="text-right py-3 px-4 font-semibold text-gray-700">Views</th>
                </tr>
              </thead>
              <tbody>
                {data.listings.topViewedListings.map((listing) => (
                  <tr key={listing._id} className="border-b hover:bg-gray-50">
                    <td className="py-3 px-4 text-gray-800">{listing.title}</td>
                    <td className="py-3 px-4 text-gray-600">
                      {listing.ownerFirstName} {listing.ownerLastName}
                    </td>
                    <td className="py-3 px-4 text-right font-medium">{listing.views}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="mb-10">
        <h2 className="text-2xl font-bold mb-4 text-gray-800 border-b-2 border-blue-600 pb-2">
          Top 10 Most Favorited Listings
        </h2>
        <div className="bg-white rounded-lg shadow-md p-6 border border-gray-200">
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-4 font-semibold text-gray-700">Title</th>
                  <th className="text-left py-3 px-4 font-semibold text-gray-700">Owner</th>
                  <th className="text-right py-3 px-4 font-semibold text-gray-700">Favorites</th>
                </tr>
              </thead>
              <tbody>
                {data.listings.topFavoritedListings.map((listing) => (
                  <tr key={listing._id} className="border-b hover:bg-gray-50">
                    <td className="py-3 px-4 text-gray-800">{listing.title}</td>
                    <td className="py-3 px-4 text-gray-600">
                      {listing.ownerFirstName} {listing.ownerLastName}
                    </td>
                    <td className="py-3 px-4 text-right font-medium">{listing.favorites}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="mb-10">
        <h2 className="text-2xl font-bold mb-4 text-gray-800 border-b-2 border-blue-600 pb-2">
          User Statistics
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
          <StatCard title="Total Users" value={data.users.overview.total} />
          <StatCard title="Confirmed Users" value={data.users.overview.confirmed} />
          <StatCard title="New Users (7 Days)" value={data.users.newUsersLast7Days} />
          <StatCard title="New Users Today" value={data.users.newUsersToday} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white rounded-lg shadow-md p-6 border border-gray-200">
            <h3 className="text-lg font-semibold text-gray-700 mb-4">Users by Type</h3>
            <div className="space-y-3">
              {data.users.byType.map((item) => (
                <div key={item.userType} className="flex justify-between">
                  <span className="text-gray-600">{formatUserType(item.userType)}:</span>
                  <span className="font-bold text-lg">{item.count}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-md p-6 border border-gray-200">
            <h3 className="text-lg font-semibold text-gray-700 mb-4">New Users Today by Type</h3>
            <div className="space-y-3">
              {data.users.newUsersTodayByType.length > 0 ? (
                data.users.newUsersTodayByType.map((item) => (
                  <div key={item.userType} className="flex justify-between">
                    <span className="text-gray-600">{formatUserType(item.userType)}:</span>
                    <span className="font-bold text-lg">{item.count}</span>
                  </div>
                ))
              ) : (
                <p className="text-gray-500">No new users today</p>
              )}
            </div>
          </div>
        </div>
      </section>

      <AdminPanel />
    </div>
  );
};

export default Analytics;
