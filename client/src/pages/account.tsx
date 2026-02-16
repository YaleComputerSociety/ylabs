/**
 * Account dashboard page for managing own listings, favorites, and fellowship tracking.
 */
import { useState, useEffect, useContext, useMemo, useRef } from "react";
import { Listing, Fellowship, FellowshipStage } from '../types/types';
import { BrowsableItem } from '../types/browsable';
import { createListing } from '../utils/apiCleaner';
import { createFellowship } from '../utils/createFellowship';
import ListingCard from '../components/accounts/ListingCard';
import BrowseCard from '../components/shared/BrowseCard';
import BrowseListItem from '../components/shared/BrowseListItem';
import ListingDetailModal from "../components/shared/ListingDetailModal";
import FellowshipModal from "../components/fellowship/FellowshipModal";
import LoadingSpinner from "../components/shared/LoadingSpinner";
import axios from '../utils/axios';
import swal from 'sweetalert';
import { exportToGoogleSheets as createGoogleSheet } from '../utils/googleSheets';
import UserContext from "../contexts/UserContext";
import CreateButton from "../components/accounts/CreateButton";
import ProfileEditor from "../components/accounts/ProfileEditor";
import { getDepartmentAbbreviation } from "../utils/departmentNames";
import KanbanBoard, { LabStage } from "../components/shared/KanbanBoard";
import FellowshipKanbanBoard from "../components/shared/FellowshipKanbanBoard";

type FavSortKey = 'name' | 'department' | 'status' | 'dateAdded';
type DeptFilter = string | null;

const Account = () => {
    const [ownListings, setOwnListings] = useState<Listing[]>([]);
    const [favListings, setFavListings] = useState<Listing[]>([]);
    const [favListingsIds, setFavListingsIds] = useState<string[]>([]);
    const [favFellowships, setFavFellowships] = useState<Fellowship[]>([]);
    const [favFellowshipIds, setFavFellowshipIds] = useState<string[]>([]);
    const [isLoading, setIsLoading] = useState<Boolean>(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isFellowshipModalOpen, setIsFellowshipModalOpen] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [isCreating, setIsCreating] = useState(false);
    const [selectedListing, setSelectedListing] = useState<Listing | null>(null);
    const [selectedFellowship, setSelectedFellowship] = useState<Fellowship | null>(null);
    const { user } = useContext(UserContext);

    const [labStage, setLabStage] = useState<Record<string, LabStage>>(() => {
        try {
            const saved = localStorage.getItem('ylabs-lab-stages');
            if (saved) return JSON.parse(saved);

            const oldSaved = localStorage.getItem('ylabs-emailed-labs');
            if (oldSaved) {
                const oldSet: string[] = JSON.parse(oldSaved);
                const migrated: Record<string, LabStage> = {};
                for (const id of oldSet) migrated[id] = 'emailed';
                localStorage.removeItem('ylabs-emailed-labs');
                return migrated;
            }

            return {};
        } catch { return {}; }
    });

    const emailedLabs = useMemo(() => {
        const s = new Set<string>();
        for (const [id, stage] of Object.entries(labStage)) {
            if (stage !== 'not_emailed') s.add(id);
        }
        return s;
    }, [labStage]);
    const [favSortKey, setFavSortKey] = useState<FavSortKey>('dateAdded');
    const [favSortAsc, setFavSortAsc] = useState(true);
    const [labNotes, setLabNotes] = useState<Record<string, string>>(() => {
        try {
            const saved = localStorage.getItem('ylabs-lab-notes');
            return saved ? JSON.parse(saved) : {};
        } catch { return {}; }
    });
    const [editingNoteId, setEditingNoteId] = useState<string | null>(null);

    const [fellowshipStage, setFellowshipStage] = useState<Record<string, FellowshipStage>>(() => {
        try {
            const saved = localStorage.getItem('ylabs-fellowship-stages');
            return saved ? JSON.parse(saved) : {};
        } catch { return {}; }
    });
    const [fellowshipNotes, setFellowshipNotes] = useState<Record<string, string>>(() => {
        try {
            const saved = localStorage.getItem('ylabs-fellowship-notes');
            return saved ? JSON.parse(saved) : {};
        } catch { return {}; }
    });
    const [editingFellowshipNoteId, setEditingFellowshipNoteId] = useState<string | null>(null);
    const [showFellowshipExportMenu, setShowFellowshipExportMenu] = useState(false);
    const fellowshipExportMenuRef = useRef<HTMLDivElement>(null);

    const [deptFilter, setDeptFilter] = useState<DeptFilter>(null);
    const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'closed' | 'emailed'>('all');
    const [showExportMenu, setShowExportMenu] = useState(false);
    const exportMenuRef = useRef<HTMLDivElement>(null);
    const [dashboardView, setDashboardView] = useState<'list' | 'card'>('list');
    const [adminViewMode, setAdminViewMode] = useState<'student' | 'professor'>('student');

    const isAdmin = user?.userType === 'admin';
    const isProfessorUser = user?.userType === 'professor' || user?.userType === 'faculty';
    const showProfView = isAdmin ? adminViewMode === 'professor' : isProfessorUser;

    useEffect(() => {
        localStorage.setItem('ylabs-lab-stages', JSON.stringify(labStage));
    }, [labStage]);

    useEffect(() => {
        if (!showExportMenu) return;
        const handler = (e: MouseEvent) => {
            if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
                setShowExportMenu(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [showExportMenu]);

    useEffect(() => {
        localStorage.setItem('ylabs-lab-notes', JSON.stringify(labNotes));
    }, [labNotes]);

    useEffect(() => {
        localStorage.setItem('ylabs-fellowship-stages', JSON.stringify(fellowshipStage));
    }, [fellowshipStage]);

    useEffect(() => {
        localStorage.setItem('ylabs-fellowship-notes', JSON.stringify(fellowshipNotes));
    }, [fellowshipNotes]);

    useEffect(() => {
        if (!showFellowshipExportMenu) return;
        const handler = (e: MouseEvent) => {
            if (fellowshipExportMenuRef.current && !fellowshipExportMenuRef.current.contains(e.target as Node)) {
                setShowFellowshipExportMenu(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [showFellowshipExportMenu]);

    useEffect(() => {
        reloadListings();
    }, []);

    useEffect(() => {
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            if (isEditing) {
                const message = "You have unsaved changes that will be lost if you leave this page.";
                e.preventDefault();
                (e as any).returnValue = message;
                return message;
            }
        };

        if (isEditing) {
            window.addEventListener('beforeunload', handleBeforeUnload);
        }

        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
        };
    }, [isEditing]);

    const reloadListings = async () => {
        setIsLoading(true);

        await axios.get('/users/listings', { withCredentials: true }).then((response) => {
            const responseOwnListings: Listing[] = response.data.ownListings.map(function(elem: any) {
                return createListing(elem);
            });
            const responseFavListings: Listing[] = response.data.favListings.map(function(elem: any) {
                return createListing(elem);
            });
            setOwnListings(responseOwnListings);
            setFavListings(responseFavListings);
        }).catch((error) => {
            console.error('Error fetching listings:', error);
            setOwnListings([]);
            setFavListings([]);
            setIsLoading(false);
            swal({ text: "Error fetching your listings", icon: "warning" });
        });

        axios.get('/users/favListingsIds', { withCredentials: true }).then((response) => {
            setFavListingsIds(response.data.favListingsIds);
            setIsLoading(false);
        }).catch((error) => {
            console.error("Error fetching user's favorite listings:", error);
            setOwnListings([]);
            setFavListings([]);
            setFavListingsIds([]);
            setIsLoading(false);
            swal({ text: "Error fetching your listings", icon: "warning" });
        });

        axios.get('/users/favFellowships').then((response) => {
            const rawFellowships = response.data.favFellowships || [];
            const fellowships: Fellowship[] = rawFellowships.map((f: any) => createFellowship(f));
            setFavFellowships(fellowships);
            setFavFellowshipIds(fellowships.map((f) => f.id));
        }).catch((error) => {
            console.error("Error fetching user's favorite fellowships:", error);
            setFavFellowshipIds([]);
            setFavFellowships([]);
        });
    };

    const openModal = (listing: Listing) => {
        setSelectedListing(listing);
        setIsModalOpen(true);
    };

    const closeModal = () => {
        setIsModalOpen(false);
        setSelectedListing(null);
    };

    const updateFavorite = (listing: Listing, listingId: string, favorite: boolean) => {
        const prevFavListings = favListings;
        const prevFavListingsIds = favListingsIds;

        if (favorite) {
            setFavListings([listing, ...prevFavListings]);
            setFavListingsIds([listingId, ...prevFavListingsIds]);
            axios.put('/users/favListings', { withCredentials: true, data: { favListings: [listing.id] } }).catch((error) => {
                setFavListings(prevFavListings);
                setFavListingsIds(prevFavListingsIds);
                console.error('Error favoriting listing:', error);
                swal({ text: "Unable to favorite listing", icon: "warning" });
                reloadListings();
            });
        } else {
            setFavListings(prevFavListings.filter((listing) => listing.id !== listingId));
            setFavListingsIds(prevFavListingsIds.filter((id) => id !== listingId));
            axios.delete('/users/favListings', { withCredentials: true, data: { favListings: [listingId] } }).catch((error) => {
                setFavListings(prevFavListings);
                setFavListingsIds(prevFavListingsIds);
                console.error('Error unfavoriting listing:', error);
                swal({ text: "Unable to unfavorite listing", icon: "warning" });
                reloadListings();
            });
        }
    };

    const updateFellowshipFavorite = (fellowshipId: string, favorite: boolean) => {
        const prevFavFellowships = favFellowships;
        const prevFavFellowshipIds = favFellowshipIds;

        if (favorite) {
            setFavFellowshipIds([fellowshipId, ...prevFavFellowshipIds]);
            axios.put('/users/favFellowships', { withCredentials: true, data: { favFellowships: [fellowshipId] } }).catch((error) => {
                setFavFellowships(prevFavFellowships);
                setFavFellowshipIds(prevFavFellowshipIds);
                console.error('Error favoriting fellowship:', error);
                swal({ text: "Unable to favorite fellowship", icon: "warning" });
                reloadListings();
            });
        } else {
            setFavFellowships(prevFavFellowships.filter((f) => (f.id || (f as any)._id) !== fellowshipId));
            setFavFellowshipIds(prevFavFellowshipIds.filter((id) => id !== fellowshipId));
            axios.delete('/users/favFellowships', { withCredentials: true, data: { favFellowships: [fellowshipId] } }).catch((error) => {
                setFavFellowships(prevFavFellowships);
                setFavFellowshipIds(prevFavFellowshipIds);
                console.error('Error unfavoriting fellowship:', error);
                swal({ text: "Unable to unfavorite fellowship", icon: "warning" });
                reloadListings();
            });
        }
    };

    const openFellowshipModal = (fellowship: Fellowship) => {
        setSelectedFellowship(fellowship);
        setIsFellowshipModalOpen(true);
    };

    const closeFellowshipModal = () => {
        setIsFellowshipModalOpen(false);
        setSelectedFellowship(null);
    };

    const updateListing = (listing: Listing) => {
        setOwnListings((prevOwnListings) => prevOwnListings.map((l) => l.id === listing.id ? listing : l));
        setFavListings((prevFavListings) => prevFavListings.map((l) => l.id === listing.id ? listing : l));
    };

    const filterHiddenListings = (listings: Listing[]) => {
        return listings.filter((listing) => listing.confirmed && !listing.archived);
    };

    const postListing = (listing: Listing) => {
        setIsLoading(true);
        const isNewListing = listing.id === "create";
        const request = isNewListing
            ? axios.post('/listings', { withCredentials: true, data: listing })
            : axios.put(`/listings/${listing.id}`, { withCredentials: true, data: listing });

        request.then(() => {
            reloadListings();
            setIsEditing(false);
            setIsLoading(false);
            setIsCreating(false);
        }).catch((error) => {
            console.error(isNewListing ? 'Error creating listing:' : 'Error updating listing:', error);
            swal({ text: isNewListing ? "Unable to create listing" : "Unable to update listing", icon: "warning" });
            reloadListings();
            setIsEditing(false);
            setIsLoading(false);
            setIsCreating(false);
        });
    };

    const clearCreatedListing = () => {
        setOwnListings((prevOwnListings) => prevOwnListings.filter((listing) => listing.id !== "create"));
        setIsEditing(false);
        setIsCreating(false);
    };

    const deleteListing = (listing: Listing) => {
        setIsLoading(true);
        axios.delete(`/listings/${listing.id}`, { withCredentials: true }).then(() => {
            reloadListings();
            setIsLoading(false);
        }).catch((error) => {
            console.error('Error deleting listing:', error);
            swal({ text: "Unable to delete listing", icon: "warning" });
            reloadListings();
            setIsLoading(false);
        });
    };

    const onCreate = () => {
        axios.get('/listings/skeleton', { withCredentials: true }).then((response) => {
            const skeletonListing = createListing(response.data.listing);
            setOwnListings((prevOwnListings) => [...prevOwnListings, skeletonListing]);
            setIsEditing(true);
            setIsCreating(true);
        }).catch((error) => {
            console.error("Error fetching skeleton listing:", error);
            swal({ text: "Unable to create listing", icon: "warning" });
        });
    };

    const availableDepts = useMemo(() => {
        const deptSet = new Set<string>();
        for (const l of filterHiddenListings(favListings)) {
            for (const d of l.departments || []) {
                deptSet.add(getDepartmentAbbreviation(d));
            }
        }
        return Array.from(deptSet).sort();
    }, [favListings]);

    const sortedFavListings = useMemo(() => {
        let visible = filterHiddenListings(favListings);

        if (deptFilter) {
            visible = visible.filter(l =>
                l.departments?.some(d => getDepartmentAbbreviation(d) === deptFilter)
            );
        }

        if (statusFilter === 'open') {
            visible = visible.filter(l => l.hiringStatus >= 0);
        } else if (statusFilter === 'closed') {
            visible = visible.filter(l => l.hiringStatus < 0);
        } else if (statusFilter === 'emailed') {
            visible = visible.filter(l => emailedLabs.has(l.id));
        }

        const sorted = [...visible].sort((a, b) => {
            let cmp = 0;
            switch (favSortKey) {
                case 'name':
                    cmp = `${a.ownerLastName} ${a.ownerFirstName}`.localeCompare(`${b.ownerLastName} ${b.ownerFirstName}`);
                    break;
                case 'department':
                    cmp = (a.departments?.[0] || '').localeCompare(b.departments?.[0] || '');
                    break;
                case 'status':
                    cmp = (b.hiringStatus >= 0 ? 1 : 0) - (a.hiringStatus >= 0 ? 1 : 0);
                    break;
                case 'dateAdded':
                default:
                    cmp = 0;
                    break;
            }
            return favSortAsc ? cmp : -cmp;
        });
        return sorted;
    }, [favListings, favSortKey, favSortAsc, deptFilter, statusFilter, emailedLabs]);

    const exportToCSV = () => {
        const visible = filterHiddenListings(favListings);
        if (visible.length === 0) {
            swal({ text: "No listings to export", icon: "info" });
            return;
        }

        const headers = ['Lab Name', 'Professor', 'Department', 'Email', 'Status', 'Stage', 'Notes', 'Website'];
        const rows = visible.map(l => [
            l.title,
            `${l.ownerFirstName} ${l.ownerLastName}`,
            l.departments?.map(d => getDepartmentAbbreviation(d)).join('; ') || '',
            l.ownerEmail,
            l.hiringStatus >= 0 ? 'Open' : 'Closed',
            (labStage[l.id] || 'not_emailed').replace('_', ' '),
            (labNotes[l.id] || '').replace(/"/g, '""'),
            l.websites?.[0] || '',
        ]);

        const csv = [headers, ...rows].map(row =>
            row.map(cell => `"${cell}"`).join(',')
        ).join('\n');

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `ylabs-favorites-${new Date().toISOString().slice(0, 10)}.csv`;
        link.click();
        URL.revokeObjectURL(url);
    };

    const exportToGoogleSheets = async () => {
        const visible = filterHiddenListings(favListings);
        if (visible.length === 0) {
            swal({ text: "No listings to export", icon: "info" });
            return;
        }

        const headers = ['Lab Name', 'Professor', 'Department', 'Email', 'Status', 'Stage', 'Notes', 'Website'];
        const rows = visible.map(l => [
            l.title,
            `${l.ownerFirstName} ${l.ownerLastName}`,
            l.departments?.map(d => getDepartmentAbbreviation(d)).join('; ') || '',
            l.ownerEmail,
            l.hiringStatus >= 0 ? 'Open' : 'Closed',
            (labStage[l.id] || 'not_emailed').replace('_', ' '),
            labNotes[l.id] || '',
            l.websites?.[0] || '',
        ]);

        try {
            const url = await createGoogleSheet(
                `YLabs Favorites - ${new Date().toISOString().slice(0, 10)}`,
                headers,
                rows,
            );
            window.open(url, '_blank');
            swal({ text: "Google Sheet created!", icon: "success", timer: 2000 });
        } catch (err) {
            console.error('Google Sheets export failed:', err);
            exportToCSV();
            swal({ text: "Could not create Google Sheet. CSV downloaded instead.", icon: "info" });
        }
    };

    const toggleEmailed = (listingId: string) => {
        setLabStage(prev => {
            const current = prev[listingId] || 'not_emailed';
            const next = { ...prev };
            if (current === 'not_emailed') {
                next[listingId] = 'emailed';
            } else {
                delete next[listingId];
            }
            return next;
        });
    };

    const handleStageChange = (listingId: string, stage: LabStage) => {
        setLabStage(prev => {
            const next = { ...prev };
            if (stage === 'not_emailed') {
                delete next[listingId];
            } else {
                next[listingId] = stage;
            }
            return next;
        });
    };

    const handleFellowshipStageChange = (fellowshipId: string, stage: FellowshipStage) => {
        setFellowshipStage(prev => {
            const next = { ...prev };
            if (stage === 'not_applied') {
                delete next[fellowshipId];
            } else {
                next[fellowshipId] = stage;
            }
            return next;
        });
    };

    const exportFellowshipsToCSV = () => {
        if (favFellowships.length === 0) {
            swal({ text: "No fellowships to export", icon: "info" });
            return;
        }

        const headers = ['Fellowship Name', 'Deadline', 'Award Amount', 'Status', 'Applied', 'Notes', 'Application Link', 'Contact'];
        const rows = favFellowships.map(f => [
            f.title,
            f.deadline ? new Date(f.deadline).toLocaleDateString() : 'No deadline',
            f.awardAmount || '',
            f.isAcceptingApplications ? 'Accepting' : 'Closed',
            (fellowshipStage[f.id] || 'not_applied') === 'applied' ? 'Applied' : 'Not Applied',
            (fellowshipNotes[f.id] || '').replace(/"/g, '""'),
            f.applicationLink || '',
            f.contactEmail || f.contactName || '',
        ]);

        const csv = [headers, ...rows].map(row =>
            row.map(cell => `"${cell}"`).join(',')
        ).join('\n');

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `ylabs-fellowships-${new Date().toISOString().slice(0, 10)}.csv`;
        link.click();
        URL.revokeObjectURL(url);
    };

    const exportFellowshipsToGoogleSheets = async () => {
        if (favFellowships.length === 0) {
            swal({ text: "No fellowships to export", icon: "info" });
            return;
        }

        const headers = ['Fellowship Name', 'Deadline', 'Award Amount', 'Status', 'Applied', 'Notes', 'Application Link', 'Contact'];
        const rows = favFellowships.map(f => [
            f.title,
            f.deadline ? new Date(f.deadline).toLocaleDateString() : 'No deadline',
            f.awardAmount || '',
            f.isAcceptingApplications ? 'Accepting' : 'Closed',
            (fellowshipStage[f.id] || 'not_applied') === 'applied' ? 'Applied' : 'Not Applied',
            fellowshipNotes[f.id] || '',
            f.applicationLink || '',
            f.contactEmail || f.contactName || '',
        ]);

        try {
            const url = await createGoogleSheet(
                `YLabs Fellowships - ${new Date().toISOString().slice(0, 10)}`,
                headers,
                rows,
            );
            window.open(url, '_blank');
            swal({ text: "Google Sheet created!", icon: "success", timer: 2000 });
        } catch (err) {
            console.error('Google Sheets export failed:', err);
            exportFellowshipsToCSV();
            swal({ text: "Could not create Google Sheet. CSV downloaded instead.", icon: "info" });
        }
    };

    const handleSortChange = (key: FavSortKey) => {
        if (favSortKey === key) {
            setFavSortAsc(!favSortAsc);
        } else {
            setFavSortKey(key);
            setFavSortAsc(true);
        }
    };

    const SortButton = ({ sortKey, label }: { sortKey: FavSortKey; label: string }) => (
        <button
            onClick={() => handleSortChange(sortKey)}
            className={`text-xs px-2 py-1 rounded transition-colors ${
                favSortKey === sortKey
                    ? 'bg-blue-100 text-blue-700 font-medium'
                    : 'text-gray-500 hover:bg-gray-100'
            }`}
        >
            {label}
            {favSortKey === sortKey && (
                <span className="ml-0.5">{favSortAsc ? '\u2191' : '\u2193'}</span>
            )}
        </button>
    );

    const listingToBrowsable = (l: Listing): BrowsableItem => ({ type: 'listing', data: l });
    const fellowshipToBrowsable = (f: Fellowship): BrowsableItem => ({ type: 'fellowship', data: f });

    const ViewToggle = () => (
        <div className="flex items-center border border-gray-200 rounded-md overflow-hidden">
            <button
                onClick={() => setDashboardView('list')}
                className={`p-1.5 transition-colors ${dashboardView === 'list' ? 'bg-blue-50 text-blue-600' : 'text-gray-400 hover:text-gray-600'}`}
                title="List view"
            >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
                    <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
                </svg>
            </button>
            <button
                onClick={() => setDashboardView('card')}
                className={`p-1.5 transition-colors ${dashboardView === 'card' ? 'bg-blue-50 text-blue-600' : 'text-gray-400 hover:text-gray-600'}`}
                title="Card view"
            >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
                    <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
                </svg>
            </button>
        </div>
    );

    return (
        <div className="mx-auto max-w-[1300px] px-6 pt-6 pb-16 w-full">
            {isLoading ? (
                <div className="flex justify-center pt-12">
                    <LoadingSpinner size="lg" />
                </div>
            ) : (
                <div>
                    {isAdmin && (
                        <div className="flex justify-center mb-6">
                            <div className="inline-flex border border-gray-200 rounded-lg overflow-hidden">
                                <button
                                    onClick={() => setAdminViewMode('student')}
                                    className={`px-4 py-2 text-sm font-medium transition-colors ${
                                        adminViewMode === 'student'
                                            ? 'bg-blue-600 text-white'
                                            : 'bg-white text-gray-600 hover:bg-gray-50'
                                    }`}
                                >
                                    Student View
                                </button>
                                <button
                                    onClick={() => setAdminViewMode('professor')}
                                    className={`px-4 py-2 text-sm font-medium transition-colors ${
                                        adminViewMode === 'professor'
                                            ? 'bg-blue-600 text-white'
                                            : 'bg-white text-gray-600 hover:bg-gray-50'
                                    }`}
                                >
                                    Professor View
                                </button>
                            </div>
                        </div>
                    )}

                    {user && !user.userConfirmed && (
                        <div className="bg-amber-100 border-l-4 border-amber-500 text-amber-700 p-4 mb-6 rounded shadow-sm">
                            <div className="flex items-center">
                                <p className="font-medium">Your account is pending confirmation. Any listings that you create will not be publicly visible as favorites or in search results until your account is confirmed.</p>
                            </div>
                        </div>
                    )}
                    {showProfView && user && (
                        <ProfileEditor netid={user.netId} />
                    )}

                    {user && showProfView && (
                        <>
                            <h2 className="text-2xl font-bold text-gray-800 text-center mb-6 pb-2">Your Listings</h2>
                            {!user.profileVerified && user.userType !== "admin" ? (
                                <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg text-center my-6">
                                    <p className="text-sm text-gray-600">
                                        Verify your profile above to create and manage listings.
                                    </p>
                                </div>
                            ) : (
                                <>
                                    {ownListings.length > 0 && (
                                        <ul>
                                            {ownListings.map((listing) => (
                                                <li key={listing.id} className="mb-2">
                                                    <ListingCard
                                                        listing={listing}
                                                        favListingsIds={favListingsIds}
                                                        updateFavorite={updateFavorite}
                                                        updateListing={updateListing}
                                                        postListing={postListing}
                                                        clearCreatedListing={clearCreatedListing}
                                                        deleteListing={deleteListing}
                                                        openModal={openModal}
                                                        globalEditing={isEditing}
                                                        setGlobalEditing={setIsEditing}
                                                        editable={true}
                                                        reloadListings={reloadListings}
                                                    />
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                    {!isCreating && (
                                        <div className={`flex justify-center align-center ${ownListings.length > 0 ? "mb-6 mt-4" : "my-10"}`}>
                                            <CreateButton globalEditing={isEditing} handleCreate={onCreate} />
                                        </div>
                                    )}
                                </>
                            )}
                        </>
                    )}

                    {showProfView ? (
                        <>
                            <div className="flex items-center justify-between mb-4">
                                <h2 className="text-2xl font-bold text-gray-800">Favorite Listings</h2>
                                <ViewToggle />
                            </div>

                            {filterHiddenListings(favListings).length > 0 ? (
                                dashboardView === 'card' ? (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                        {filterHiddenListings(favListings).map((listing) => (
                                            <BrowseCard
                                                key={listing.id}
                                                item={listingToBrowsable(listing)}
                                                isFavorite={favListingsIds.includes(listing.id)}
                                                onToggleFavorite={(e) => {
                                                    e.stopPropagation();
                                                    updateFavorite(listing, listing.id, !favListingsIds.includes(listing.id));
                                                }}
                                                onOpenModal={() => openModal(listing)}
                                            />
                                        ))}
                                    </div>
                                ) : (
                                    <div className="flex flex-col gap-2">
                                        {filterHiddenListings(favListings).map((listing) => (
                                            <BrowseListItem
                                                key={listing.id}
                                                item={listingToBrowsable(listing)}
                                                isFavorite={favListingsIds.includes(listing.id)}
                                                onToggleFavorite={(e) => {
                                                    e.stopPropagation();
                                                    updateFavorite(listing, listing.id, !favListingsIds.includes(listing.id));
                                                }}
                                                onOpenModal={() => openModal(listing)}
                                            />
                                        ))}
                                    </div>
                                )
                            ) : (
                                <p className="my-4 text-center">No listings found.</p>
                            )}

                            <h2 className="text-2xl font-bold text-gray-800 text-center mb-6 mt-10 pb-2">Favorite Fellowships</h2>
                            {favFellowships.length > 0 ? (
                                dashboardView === 'card' ? (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                        {favFellowships.map((fellowship) => (
                                            <BrowseCard
                                                key={fellowship.id}
                                                item={fellowshipToBrowsable(fellowship)}
                                                isFavorite={favFellowshipIds.includes(fellowship.id)}
                                                onToggleFavorite={(e) => {
                                                    e.stopPropagation();
                                                    updateFellowshipFavorite(fellowship.id, !favFellowshipIds.includes(fellowship.id));
                                                }}
                                                onOpenModal={() => openFellowshipModal(fellowship)}
                                            />
                                        ))}
                                    </div>
                                ) : (
                                    <div className="flex flex-col gap-2">
                                        {favFellowships.map((fellowship) => (
                                            <BrowseListItem
                                                key={fellowship.id}
                                                item={fellowshipToBrowsable(fellowship)}
                                                isFavorite={favFellowshipIds.includes(fellowship.id)}
                                                onToggleFavorite={(e) => {
                                                    e.stopPropagation();
                                                    updateFellowshipFavorite(fellowship.id, !favFellowshipIds.includes(fellowship.id));
                                                }}
                                                onOpenModal={() => openFellowshipModal(fellowship)}
                                            />
                                        ))}
                                    </div>
                                )
                            ) : (
                                <p className="my-4 text-center">No fellowships found.</p>
                            )}
                        </>
                    ) : (
                        <>
                            <div className="flex items-center justify-between mb-2">
                                <h2 className="text-2xl font-bold text-gray-800">Favorite Listings</h2>
                                {filterHiddenListings(favListings).length > 0 && (
                                    <div className="flex items-center gap-2">
                                        <ViewToggle />
                                        <div className="flex items-center gap-1 border border-gray-200 rounded-md px-1 py-0.5">
                                            <span className="text-xs text-gray-400 px-1">Sort:</span>
                                            <SortButton sortKey="dateAdded" label="Added" />
                                            <SortButton sortKey="name" label="Name" />
                                            <SortButton sortKey="department" label="Dept" />
                                            <SortButton sortKey="status" label="Status" />
                                        </div>
                                        <div className="relative" ref={exportMenuRef}>
                                            <button
                                                onClick={() => setShowExportMenu(!showExportMenu)}
                                                className="flex items-center gap-1 text-xs px-3 py-1.5 bg-green-50 text-green-700 border border-green-200 rounded-md hover:bg-green-100 transition-colors"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                                    <polyline points="7 10 12 15 17 10" />
                                                    <line x1="12" y1="15" x2="12" y2="3" />
                                                </svg>
                                                Export
                                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
                                            </button>
                                            {showExportMenu && (
                                                <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg z-20 min-w-[180px]">
                                                    <button
                                                        onClick={() => { exportToCSV(); setShowExportMenu(false); }}
                                                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2"
                                                    >
                                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                            <path d="M14 3v4a1 1 0 0 0 1 1h4" />
                                                            <path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z" />
                                                        </svg>
                                                        Export as CSV
                                                    </button>
                                                    <button
                                                        onClick={() => { exportToGoogleSheets(); setShowExportMenu(false); }}
                                                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2 border-t border-gray-100"
                                                    >
                                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="#34a853" stroke="none">
                                                            <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zM7 12h2v5H7zm4-3h2v8h-2zm4-3h2v11h-2z"/>
                                                        </svg>
                                                        Open in Google Sheets
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {filterHiddenListings(favListings).length > 0 && (
                                <div className="flex flex-wrap items-center gap-2 mb-4">
                                    <span className="text-xs text-gray-400">Filter:</span>
                                    {(['all', 'open', 'closed', 'emailed'] as const).map(s => (
                                        <button
                                            key={s}
                                            onClick={() => setStatusFilter(s)}
                                            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                                                statusFilter === s
                                                    ? 'bg-blue-100 border-blue-300 text-blue-700 font-medium'
                                                    : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                                            }`}
                                        >
                                            {s === 'all' ? 'All' : s === 'open' ? 'Open' : s === 'closed' ? 'Closed' : 'Emailed'}
                                        </button>
                                    ))}
                                    {availableDepts.length > 0 && (
                                        <span className="w-px h-4 bg-gray-200" />
                                    )}
                                    {availableDepts.slice(0, 8).map(dept => (
                                        <button
                                            key={dept}
                                            onClick={() => setDeptFilter(deptFilter === dept ? null : dept)}
                                            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                                                deptFilter === dept
                                                    ? 'bg-blue-100 border-blue-300 text-blue-700 font-medium'
                                                    : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                                            }`}
                                        >
                                            {dept}
                                        </button>
                                    ))}
                                    {availableDepts.length > 8 && (
                                        <span className="text-xs text-gray-400">+{availableDepts.length - 8} more</span>
                                    )}
                                    {(deptFilter || statusFilter !== 'all') && (
                                        <button
                                            onClick={() => { setDeptFilter(null); setStatusFilter('all'); }}
                                            className="text-xs text-red-500 hover:text-red-700 ml-1"
                                        >
                                            Clear
                                        </button>
                                    )}
                                </div>
                            )}

                            {sortedFavListings.length > 0 ? (
                                dashboardView === 'card' ? (
                                    <KanbanBoard
                                        items={sortedFavListings}
                                        labStage={labStage}
                                        onStageChange={handleStageChange}
                                        favIds={favListingsIds}
                                        onToggleFavorite={updateFavorite}
                                        onOpenModal={openModal}
                                    />
                                ) : (
                                    <ul>
                                        {sortedFavListings.map((listing) => (
                                            <li key={listing.id} className="mb-2">
                                                <div className="flex items-stretch gap-2">
                                                    <div className="flex-1">
                                                        <ListingCard
                                                            listing={listing}
                                                            favListingsIds={favListingsIds}
                                                            updateFavorite={updateFavorite}
                                                            updateListing={updateListing}
                                                            postListing={postListing}
                                                            clearCreatedListing={clearCreatedListing}
                                                            deleteListing={deleteListing}
                                                            openModal={openModal}
                                                            globalEditing={isEditing}
                                                            setGlobalEditing={setIsEditing}
                                                            editable={false}
                                                            reloadListings={reloadListings}
                                                        />
                                                    </div>
                                                    <div className="flex flex-col gap-1 justify-center">
                                                        <button
                                                            onClick={() => toggleEmailed(listing.id)}
                                                            className={`p-1.5 rounded border transition-colors ${
                                                                emailedLabs.has(listing.id)
                                                                    ? 'bg-blue-50 border-blue-300 text-blue-600'
                                                                    : 'border-gray-200 text-gray-400 hover:text-gray-600 hover:border-gray-300'
                                                            }`}
                                                            title={emailedLabs.has(listing.id) ? 'Mark as not emailed' : 'Mark as emailed'}
                                                        >
                                                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill={emailedLabs.has(listing.id) ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                                <rect x="2" y="4" width="20" height="16" rx="2" />
                                                                <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                                                            </svg>
                                                        </button>
                                                        <button
                                                            onClick={() => setEditingNoteId(editingNoteId === listing.id ? null : listing.id)}
                                                            className={`p-1.5 rounded border transition-colors ${
                                                                labNotes[listing.id]
                                                                    ? 'bg-yellow-50 border-yellow-300 text-yellow-600'
                                                                    : 'border-gray-200 text-gray-400 hover:text-gray-600 hover:border-gray-300'
                                                            }`}
                                                            title="Add note"
                                                        >
                                                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                                                            </svg>
                                                        </button>
                                                    </div>
                                                </div>
                                                {editingNoteId === listing.id && (
                                                    <div className="mt-1 ml-0">
                                                        <textarea
                                                            value={labNotes[listing.id] || ''}
                                                            onChange={(e) => setLabNotes(prev => ({ ...prev, [listing.id]: e.target.value }))}
                                                            placeholder="Add a note about this lab..."
                                                            rows={2}
                                                            className="w-full text-sm border border-gray-200 rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                                        />
                                                    </div>
                                                )}
                                                {labNotes[listing.id] && editingNoteId !== listing.id && (
                                                    <p className="text-xs text-gray-500 mt-0.5 ml-1 italic truncate">
                                                        Note: {labNotes[listing.id]}
                                                    </p>
                                                )}
                                            </li>
                                        ))}
                                    </ul>
                                )
                            ) : (
                                <p className="my-4 text-center">No listings found.</p>
                            )}

                            <div className="flex items-center justify-between mb-2 mt-10">
                                <h2 className="text-2xl font-bold text-gray-800">Favorite Fellowships</h2>
                                {favFellowships.length > 0 && (
                                    <div className="flex items-center gap-2">
                                        <ViewToggle />
                                        <div className="relative" ref={fellowshipExportMenuRef}>
                                            <button
                                                onClick={() => setShowFellowshipExportMenu(!showFellowshipExportMenu)}
                                                className="flex items-center gap-1 text-xs px-3 py-1.5 bg-green-50 text-green-700 border border-green-200 rounded-md hover:bg-green-100 transition-colors"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                                    <polyline points="7 10 12 15 17 10" />
                                                    <line x1="12" y1="15" x2="12" y2="3" />
                                                </svg>
                                                Export
                                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
                                            </button>
                                            {showFellowshipExportMenu && (
                                                <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg z-20 min-w-[180px]">
                                                    <button
                                                        onClick={() => { exportFellowshipsToCSV(); setShowFellowshipExportMenu(false); }}
                                                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2"
                                                    >
                                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                            <path d="M14 3v4a1 1 0 0 0 1 1h4" />
                                                            <path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z" />
                                                        </svg>
                                                        Export as CSV
                                                    </button>
                                                    <button
                                                        onClick={() => { exportFellowshipsToGoogleSheets(); setShowFellowshipExportMenu(false); }}
                                                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2 border-t border-gray-100"
                                                    >
                                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="#34a853" stroke="none">
                                                            <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zM7 12h2v5H7zm4-3h2v8h-2zm4-3h2v11h-2z"/>
                                                        </svg>
                                                        Open in Google Sheets
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {favFellowships.length > 0 ? (
                                dashboardView === 'card' ? (
                                    <FellowshipKanbanBoard
                                        items={favFellowships}
                                        fellowshipStage={fellowshipStage}
                                        onStageChange={handleFellowshipStageChange}
                                        favIds={favFellowshipIds}
                                        onToggleFavorite={(id, fav) => updateFellowshipFavorite(id, fav)}
                                        onOpenModal={openFellowshipModal}
                                    />
                                ) : (
                                    <ul>
                                        {favFellowships.map((fellowship) => (
                                            <li key={fellowship.id} className="mb-2">
                                                <div className="flex items-stretch gap-2">
                                                    <div className="flex-1">
                                                        <BrowseListItem
                                                            item={fellowshipToBrowsable(fellowship)}
                                                            isFavorite={favFellowshipIds.includes(fellowship.id)}
                                                            onToggleFavorite={(e) => {
                                                                e.stopPropagation();
                                                                updateFellowshipFavorite(fellowship.id, !favFellowshipIds.includes(fellowship.id));
                                                            }}
                                                            onOpenModal={() => openFellowshipModal(fellowship)}
                                                        />
                                                    </div>
                                                    <div className="flex flex-col gap-1 justify-center">
                                                        <button
                                                            onClick={() => handleFellowshipStageChange(
                                                                fellowship.id,
                                                                (fellowshipStage[fellowship.id] || 'not_applied') === 'applied' ? 'not_applied' : 'applied'
                                                            )}
                                                            className={`p-1.5 rounded border transition-colors ${
                                                                (fellowshipStage[fellowship.id] || 'not_applied') === 'applied'
                                                                    ? 'bg-green-50 border-green-300 text-green-600'
                                                                    : 'border-gray-200 text-gray-400 hover:text-gray-600 hover:border-gray-300'
                                                            }`}
                                                            title={(fellowshipStage[fellowship.id] || 'not_applied') === 'applied' ? 'Mark as not applied' : 'Mark as applied'}
                                                        >
                                                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill={(fellowshipStage[fellowship.id] || 'not_applied') === 'applied' ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                                <polyline points="20 6 9 17 4 12" />
                                                            </svg>
                                                        </button>
                                                        <button
                                                            onClick={() => setEditingFellowshipNoteId(editingFellowshipNoteId === fellowship.id ? null : fellowship.id)}
                                                            className={`p-1.5 rounded border transition-colors ${
                                                                fellowshipNotes[fellowship.id]
                                                                    ? 'bg-yellow-50 border-yellow-300 text-yellow-600'
                                                                    : 'border-gray-200 text-gray-400 hover:text-gray-600 hover:border-gray-300'
                                                            }`}
                                                            title="Add note"
                                                        >
                                                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                                                            </svg>
                                                        </button>
                                                    </div>
                                                </div>
                                                {editingFellowshipNoteId === fellowship.id && (
                                                    <div className="mt-1">
                                                        <textarea
                                                            value={fellowshipNotes[fellowship.id] || ''}
                                                            onChange={(e) => setFellowshipNotes(prev => ({ ...prev, [fellowship.id]: e.target.value }))}
                                                            placeholder="Add a note about this fellowship..."
                                                            rows={2}
                                                            className="w-full text-sm border border-gray-200 rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                                        />
                                                    </div>
                                                )}
                                                {fellowshipNotes[fellowship.id] && editingFellowshipNoteId !== fellowship.id && (
                                                    <p className="text-xs text-gray-500 mt-0.5 ml-1 italic truncate">
                                                        Note: {fellowshipNotes[fellowship.id]}
                                                    </p>
                                                )}
                                            </li>
                                        ))}
                                    </ul>
                                )
                            ) : (
                                <p className="my-4 text-center">No fellowships found.</p>
                            )}
                        </>
                    )}

                    {selectedListing && (
                        <ListingDetailModal
                            isOpen={isModalOpen}
                            onClose={closeModal}
                            listing={selectedListing}
                            isFavorite={favListingsIds.includes(selectedListing.id)}
                            onToggleFavorite={(e) => {
                                e.stopPropagation();
                                updateFavorite(selectedListing, selectedListing.id, !favListingsIds.includes(selectedListing.id));
                            }}
                        />
                    )}

                    {selectedFellowship && (
                        <FellowshipModal
                            fellowship={selectedFellowship}
                            isOpen={isFellowshipModalOpen}
                            onClose={closeFellowshipModal}
                            isFavorite={favFellowshipIds.includes(selectedFellowship.id)}
                            toggleFavorite={() => {
                                updateFellowshipFavorite(
                                    selectedFellowship.id,
                                    !favFellowshipIds.includes(selectedFellowship.id)
                                );
                            }}
                        />
                    )}
                </div>
            )}
        </div>
    );
};

export default Account;
