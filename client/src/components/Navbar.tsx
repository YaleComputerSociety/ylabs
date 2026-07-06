/**
 * Main navigation bar with search, filters, and user controls.
 */
import { useState, useContext } from 'react';
import { useLocation, Link } from 'react-router-dom';
import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Toolbar from '@mui/material/Toolbar';
import IconButton from '@mui/material/IconButton';
import Drawer from '@mui/material/Drawer';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import Collapse from '@mui/material/Collapse';
import useMediaQuery from '@mui/material/useMediaQuery';
import Button from '@mui/material/Button';
import UserButton from './UserButton';
import SignOutButton from './SignOutButton';
import AboutButton from './AboutButton';
import AccountButton from './AccountButton';
import HomeButton from './HomeButton';
import DrawerHomeButton from './DrawerHomeButton';
import YURAButton from './YURAButton';
import AnalyticsButton from './AnalyticsButton';
import UserContext from '../contexts/UserContext';
import UIContext from '../contexts/UIContext';
import SearchContext from '../contexts/SearchContext';
import FellowshipSearchContext from '../contexts/FellowshipSearchContext';
import FeedbackButton from './FeebackButton';
import NavbarSearchBar from './navbar/NavbarSearchBar';
import NavbarSortDropdown from './navbar/NavbarSortDropdown';
import NavbarFellowshipSearchBar from './navbar/NavbarFellowshipSearchBar';
import NavbarFellowshipSortDropdown from './navbar/NavbarFellowshipSortDropdown';
import CombinedFilterDropdown, { FilterTabConfig } from './shared/CombinedFilterDropdown';
import ActiveFilters, { ActiveFilterChip, QuickFilterDef } from './shared/ActiveFilters';
import { getColorForResearchArea } from '../utils/researchAreas';
import { useConfig } from '../hooks/useConfig';

import { ThemeProvider } from '@mui/material/styles';
import theme from '../utils/muiTheme';

const MOBILE_BREAKPOINT = '768px';

const HamburgerIcon = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '2px' }}>
    <div style={{ width: '18px', height: '2px', backgroundColor: 'black' }}></div>
    <div style={{ width: '18px', height: '2px', backgroundColor: 'black' }}></div>
    <div style={{ width: '18px', height: '2px', backgroundColor: 'black' }}></div>
  </div>
);

const SearchIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="11" cy="11" r="8" />
    <path d="M21 21l-4.35-4.35" />
  </svg>
);

const ViewToggle = () => {
  const { viewMode, setViewMode } = useContext(UIContext);
  return (
    <div className="flex border border-gray-200 rounded overflow-hidden">
      <button
        onClick={() => setViewMode('card')}
        className={`p-1.5 transition-colors ${viewMode === 'card' ? 'bg-blue-50 text-blue-600' : 'text-gray-400 hover:text-gray-600'}`}
        aria-label="Card view"
        title="Card view"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
          <rect x="14" y="14" width="7" height="7" />
        </svg>
      </button>
      <button
        onClick={() => setViewMode('list')}
        className={`p-1.5 transition-colors ${viewMode === 'list' ? 'bg-blue-50 text-blue-600' : 'text-gray-400 hover:text-gray-600'}`}
        aria-label="List view"
        title="List view"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="8" y1="6" x2="21" y2="6" />
          <line x1="8" y1="12" x2="21" y2="12" />
          <line x1="8" y1="18" x2="21" y2="18" />
          <line x1="3" y1="6" x2="3.01" y2="6" />
          <line x1="3" y1="12" x2="3.01" y2="12" />
          <line x1="3" y1="18" x2="3.01" y2="18" />
        </svg>
      </button>
    </div>
  );
};

const getAcademicDisciplineColor = (area: string): { bg: string; text: string } => {
  switch (area) {
    case 'Computing & AI':
      return { bg: 'bg-blue-200', text: 'text-blue-800' };
    case 'Life Sciences':
      return { bg: 'bg-green-200', text: 'text-green-800' };
    case 'Physical Sciences & Engineering':
      return { bg: 'bg-yellow-200', text: 'text-yellow-800' };
    case 'Health & Medicine':
      return { bg: 'bg-red-200', text: 'text-red-800' };
    case 'Social Sciences':
      return { bg: 'bg-purple-200', text: 'text-purple-800' };
    case 'Humanities & Arts':
      return { bg: 'bg-pink-200', text: 'text-pink-800' };
    case 'Environmental Sciences':
      return { bg: 'bg-teal-200', text: 'text-teal-800' };
    case 'Economics':
      return { bg: 'bg-orange-200', text: 'text-orange-800' };
    case 'Mathematics':
      return { bg: 'bg-indigo-200', text: 'text-indigo-800' };
    default:
      return { bg: 'bg-gray-200', text: 'text-gray-800' };
  }
};

const getResearchAreaChipColor = (area: string) => {
  const m: Record<string, string> = {
    'Computing & AI': 'bg-blue-200 text-gray-900',
    'Life Sciences': 'bg-green-200 text-gray-900',
    'Physical Sciences & Engineering': 'bg-yellow-200 text-gray-900',
    'Health & Medicine': 'bg-red-200 text-gray-900',
    'Social Sciences': 'bg-purple-200 text-gray-900',
    'Humanities & Arts': 'bg-pink-200 text-gray-900',
    'Environmental Sciences': 'bg-teal-200 text-gray-900',
    Economics: 'bg-orange-200 text-gray-900',
    Mathematics: 'bg-indigo-200 text-gray-900',
  };
  return m[area] || 'bg-gray-100 text-gray-900';
};

const listingQuickFilters: QuickFilterDef[] = [
  {
    label: 'Open Only',
    value: 'open',
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
    ),
  },
  {
    label: 'Recently Added',
    value: 'recent',
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
  },
  {
    label: 'YSM',
    value: 'ysm',
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 21h18" />
        <path d="M5 21V7l7-4 7 4v14" />
        <path d="M9 21v-4h6v4" />
      </svg>
    ),
  },
  {
    label: 'YSPH',
    value: 'ysph',
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 21h18" />
        <path d="M5 21V7l7-4 7 4v14" />
        <path d="M9 21v-4h6v4" />
      </svg>
    ),
  },
  {
    label: 'YC',
    value: 'yc',
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 21h18" />
        <path d="M5 21V7l7-4 7 4v14" />
        <path d="M9 21v-4h6v4" />
      </svg>
    ),
  },
];

const fellowshipQuickFilters: QuickFilterDef[] = [
  {
    label: 'Open Only',
    value: 'open',
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
    ),
  },
  {
    label: 'Closing Soon',
    value: 'closingSoon',
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
  },
  {
    label: 'Recently Added',
    value: 'recent',
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
      </svg>
    ),
  },
];

export default function Navbar() {
  const { isAuthenticated, user } = useContext(UserContext);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [mobileFellowshipSearchOpen, setMobileFellowshipSearchOpen] = useState(false);
  const isMobile = useMediaQuery(`(max-width:${MOBILE_BREAKPOINT})`);
  const _showFellowshipMobilePanel = useMediaQuery('(max-width:1279px)');
  const location = useLocation();

  const isAdmin = user?.userType === 'admin';
  const isHomePage = location.pathname === '/';
  const isFellowshipsPage = location.pathname === '/fellowships';
  const isAccountPage = location.pathname === '/account';

  const {
    selectedDepartments,
    setSelectedDepartments,
    allDepartments,
    departmentsFilterMode,
    setDepartmentsFilterMode,
    selectedResearchAreas,
    setSelectedResearchAreas,
    allResearchAreas,
    researchAreasFilterMode,
    setResearchAreasFilterMode,
    selectedListingResearchAreas,
    setSelectedListingResearchAreas,
    allListingResearchAreas,
    listingResearchAreasFilterMode,
    setListingResearchAreasFilterMode,
    quickFilter,
    setQuickFilter,
    totalCount,
    isLoading: listingLoading,
    setFilterBarHeight,
  } = useContext(SearchContext);

  const {
    filterOptions: fellowshipFilterOptions,
    selectedYearOfStudy,
    setSelectedYearOfStudy,
    selectedTermOfAward,
    setSelectedTermOfAward,
    selectedPurpose,
    setSelectedPurpose,
    selectedRegions,
    setSelectedRegions,
    selectedCitizenship,
    setSelectedCitizenship,
    setFilterBarHeight: setFellowshipFilterBarHeight,
    quickFilter: fellowshipQuickFilter,
    setQuickFilter: setFellowshipQuickFilter,
    fellowships: _fellowshipResults,
    isLoading: fellowshipLoading,
    total: fellowshipTotal,
  } = useContext(FellowshipSearchContext);

  const { getDepartmentColor: getColorFromConfig } = useConfig();

  const listingFilterTabs: FilterTabConfig[] = [
    {
      key: 'departments',
      label: 'Departments',
      options: allDepartments,
      selected: selectedDepartments,
      setSelected: setSelectedDepartments,
      searchable: true,
      filterMode: departmentsFilterMode,
      setFilterMode: setDepartmentsFilterMode,
    },
    {
      key: 'disciplines',
      label: 'Disciplines',
      options: allResearchAreas,
      selected: selectedResearchAreas,
      setSelected: setSelectedResearchAreas,
      colorFn: getAcademicDisciplineColor,
      filterMode: researchAreasFilterMode,
      setFilterMode: setResearchAreasFilterMode,
    },
    {
      key: 'researchAreas',
      label: 'Research',
      options: allListingResearchAreas,
      selected: selectedListingResearchAreas,
      setSelected: setSelectedListingResearchAreas,
      searchable: true,
      colorFn: getColorForResearchArea,
      maxDisplay: 100,
      filterMode: listingResearchAreasFilterMode,
      setFilterMode: setListingResearchAreasFilterMode,
    },
  ];

  const fellowshipFilterTabs: FilterTabConfig[] = [
    {
      key: 'year',
      label: 'Year',
      options: fellowshipFilterOptions.yearOfStudy,
      selected: selectedYearOfStudy,
      setSelected: setSelectedYearOfStudy,
    },
    {
      key: 'term',
      label: 'Term',
      options: fellowshipFilterOptions.termOfAward,
      selected: selectedTermOfAward,
      setSelected: setSelectedTermOfAward,
    },
    {
      key: 'purpose',
      label: 'Purpose',
      options: fellowshipFilterOptions.purpose,
      selected: selectedPurpose,
      setSelected: setSelectedPurpose,
    },
    {
      key: 'region',
      label: 'Region',
      options: fellowshipFilterOptions.globalRegions,
      selected: selectedRegions,
      setSelected: setSelectedRegions,
    },
    {
      key: 'citizenship',
      label: 'Citizenship',
      options: fellowshipFilterOptions.citizenshipStatus,
      selected: selectedCitizenship,
      setSelected: setSelectedCitizenship,
    },
  ];

  const listingChips: ActiveFilterChip[] = [
    ...selectedResearchAreas.map((area) => ({
      key: `area-${area}`,
      label: area,
      colorClass: `${getResearchAreaChipColor(area)} border border-gray-300`,
      onRemove: () => setSelectedResearchAreas((prev) => prev.filter((a) => a !== area)),
    })),
    ...selectedDepartments.map((dept) => ({
      key: `dept-${dept}`,
      label: dept,
      colorClass: `${getColorFromConfig(dept)} text-gray-900`,
      onRemove: () => setSelectedDepartments((prev) => prev.filter((d) => d !== dept)),
    })),
    ...selectedListingResearchAreas.map((area) => {
      const colors = getColorForResearchArea(area);
      return {
        key: `listing-area-${area}`,
        label: area,
        colorClass: `${colors.bg} ${colors.text}`,
        onRemove: () => setSelectedListingResearchAreas((prev) => prev.filter((a) => a !== area)),
      };
    }),
  ];

  const fellowshipFilterGroups = [
    { label: 'Year', values: selectedYearOfStudy, clear: () => setSelectedYearOfStudy([]) },
    { label: 'Term', values: selectedTermOfAward, clear: () => setSelectedTermOfAward([]) },
    { label: 'Purpose', values: selectedPurpose, clear: () => setSelectedPurpose([]) },
    { label: 'Region', values: selectedRegions, clear: () => setSelectedRegions([]) },
    { label: 'Citizenship', values: selectedCitizenship, clear: () => setSelectedCitizenship([]) },
  ].filter((g) => g.values.length > 0);

  const fellowshipChips: ActiveFilterChip[] = fellowshipFilterGroups.map((group) => {
    const display =
      group.values.length <= 3
        ? group.values.join(', ')
        : `${group.values.slice(0, 2).join(', ')} +${group.values.length - 2} more`;
    return {
      key: `f-${group.label}`,
      label: `${group.label}: ${display}`,
      colorClass: 'bg-gray-100 text-gray-700 border border-gray-300',
      onRemove: group.clear,
    };
  });

  const toggleDrawer = (open: boolean) => (event: React.KeyboardEvent | React.MouseEvent) => {
    if (
      event.type === 'keydown' &&
      ((event as React.KeyboardEvent).key === 'Tab' ||
        (event as React.KeyboardEvent).key === 'Shift')
    ) {
      return;
    }
    setDrawerOpen(open);
  };

  const mobileMenu = () => {
    const listItemStyle = {
      '& .MuiButton-root': {
        paddingLeft: 1,
        justifyContent: 'flex-start',
        width: '100%',
      },
    };

    return (
      <Box
        sx={{ width: 250 }}
        role="presentation"
        onClick={toggleDrawer(false)}
        onKeyDown={toggleDrawer(false)}
      >
        <List>
          {isAuthenticated ? (
            <>
              <ListItem sx={listItemStyle}>
                <DrawerHomeButton />
              </ListItem>
              <ListItem sx={listItemStyle}>
                <Button
                  component={Link}
                  to="/fellowships"
                  sx={{
                    textTransform: 'none',
                    color: isFellowshipsPage ? '#0055A4' : '#333',
                    fontWeight: isFellowshipsPage ? 600 : 400,
                    justifyContent: 'flex-start',
                    width: '100%',
                    pl: 1,
                  }}
                >
                  Find Fellowships
                </Button>
              </ListItem>
              <ListItem sx={listItemStyle}>
                <AccountButton />
              </ListItem>
              <ListItem sx={listItemStyle}>
                <AboutButton />
              </ListItem>
              {isAdmin && (
                <ListItem sx={listItemStyle}>
                  <AnalyticsButton />
                </ListItem>
              )}
              <ListItem sx={listItemStyle}>
                <FeedbackButton />
              </ListItem>
              <ListItem sx={listItemStyle}>
                <SignOutButton />
              </ListItem>
            </>
          ) : (
            <ListItem sx={listItemStyle}>
              <YURAButton />
            </ListItem>
          )}
        </List>
      </Box>
    );
  };

  return (
    <ThemeProvider theme={theme}>
      <Box sx={{ flexGrow: 1 }}>
        <AppBar
          position="static"
          sx={{
            position: 'relative',
            background: 'linear-gradient(180deg, #ffffff 0%, #f3f4f6 100%)',
            color: '#000000',
            height: { xs: '64px', sm: '64px' },
            '& .MuiToolbar-root': {
              minHeight: '64px !important',
              height: '64px !important',
              paddingLeft: '32px !important',
              paddingRight: { lg: '85px' },
              transition: 'padding 0.3s ease',
            },
            boxShadow: '0px 1px 4px rgba(0, 0, 0, 0.1), 0px 1px 3px rgba(0, 85, 164, 0.06)',
            borderBottom: '1px solid rgba(0, 0, 0, 0.06)',
          }}
        >
          {isAuthenticated && !isMobile && (
            <Box
              sx={{
                position: 'absolute',
                right: '16px',
                top: '50%',
                transform: 'translateY(-50%)',
                display: 'flex',
                gap: '14px',
                alignItems: 'center',
                zIndex: 10,
              }}
            >
              <Box sx={{ display: 'flex', gap: 0, alignItems: 'center' }}>
                <Button
                  component={Link}
                  to="/"
                  disableRipple
                  sx={{
                    textTransform: 'none',
                    fontSize: '0.875rem',
                    fontWeight: isHomePage ? 600 : 400,
                    color: isHomePage ? '#0055A4' : '#666',
                    borderBottom: isHomePage ? '2px solid #0055A4' : '2px solid transparent',
                    borderRadius: 0,
                    px: 1.5,
                    py: 0.5,
                    minWidth: 'auto',
                    '&:hover': { backgroundColor: 'transparent', color: '#0055A4' },
                  }}
                >
                  Find Labs
                </Button>
                <Button
                  component={Link}
                  to="/fellowships"
                  disableRipple
                  sx={{
                    textTransform: 'none',
                    fontSize: '0.875rem',
                    fontWeight: isFellowshipsPage ? 600 : 400,
                    color: isFellowshipsPage ? '#0055A4' : '#666',
                    borderBottom: isFellowshipsPage ? '2px solid #0055A4' : '2px solid transparent',
                    borderRadius: 0,
                    px: 1.5,
                    py: 0.5,
                    minWidth: 'auto',
                    '&:hover': { backgroundColor: 'transparent', color: '#0055A4' },
                  }}
                >
                  Find Fellowships
                </Button>
                <Button
                  component={Link}
                  to="/account"
                  disableRipple
                  sx={{
                    textTransform: 'none',
                    fontSize: '0.875rem',
                    fontWeight: isAccountPage ? 600 : 400,
                    color: isAccountPage ? '#0055A4' : '#666',
                    borderBottom: isAccountPage ? '2px solid #0055A4' : '2px solid transparent',
                    borderRadius: 0,
                    px: 1.5,
                    py: 0.5,
                    minWidth: 'auto',
                    '&:hover': { backgroundColor: 'transparent', color: '#0055A4' },
                  }}
                >
                  Dashboard
                </Button>
              </Box>
              <UserButton />
            </Box>
          )}
          <Toolbar sx={{ height: '64px', width: '100%', justifyContent: 'flex-start' }}>
            <Box sx={{ flexShrink: 0 }}>{isAuthenticated ? <HomeButton /> : <YURAButton />}</Box>

            {isAuthenticated && isHomePage && (
              <Box
                sx={{
                  display: { xs: 'none', md: 'flex' },
                  gap: '12px',
                  ml: 1,
                  mr: '380px',
                  alignItems: 'center',
                  flexShrink: 1,
                  overflow: 'visible',
                }}
              >
                <NavbarSearchBar />
                <CombinedFilterDropdown tabs={listingFilterTabs} />
                <NavbarSortDropdown />
                <ViewToggle />
              </Box>
            )}

            {isAuthenticated && isFellowshipsPage && (
              <Box
                sx={{
                  display: { xs: 'none', md: 'flex' },
                  gap: '12px',
                  ml: 1,
                  mr: '380px',
                  alignItems: 'center',
                  flexShrink: 1,
                  overflow: 'visible',
                }}
              >
                <NavbarFellowshipSearchBar />
                <CombinedFilterDropdown tabs={fellowshipFilterTabs} />
                <NavbarFellowshipSortDropdown />
                <ViewToggle />
              </Box>
            )}

            {isAuthenticated && (
              <>
                <Box sx={{ display: 'flex', gap: '8px', alignItems: 'center', ml: 'auto' }}>
                  {(isHomePage || isFellowshipsPage) && isMobile && (
                    <IconButton
                      size="small"
                      color="inherit"
                      aria-label="search"
                      onClick={() => {
                        if (isHomePage) setMobileSearchOpen(!mobileSearchOpen);
                        if (isFellowshipsPage)
                          setMobileFellowshipSearchOpen(!mobileFellowshipSearchOpen);
                      }}
                      sx={{
                        borderRadius: '4px',
                        padding: '8px',
                        '&:hover': { backgroundColor: 'transparent' },
                      }}
                    >
                      <SearchIcon />
                    </IconButton>
                  )}
                  {isMobile && (
                    <IconButton
                      size="large"
                      edge="end"
                      color="inherit"
                      aria-label="menu"
                      onClick={toggleDrawer(true)}
                      sx={{
                        borderRadius: '4px',
                        padding: '8px',
                        '&:hover': { backgroundColor: 'transparent' },
                      }}
                    >
                      <HamburgerIcon />
                    </IconButton>
                  )}
                </Box>
                <Drawer anchor="right" open={drawerOpen} onClose={toggleDrawer(false)}>
                  {mobileMenu()}
                </Drawer>
              </>
            )}
          </Toolbar>
        </AppBar>

        {isAuthenticated && isHomePage && isMobile && (
          <Collapse in={mobileSearchOpen}>
            <Box
              sx={{
                bgcolor: 'white',
                boxShadow: '0px 2px 4px rgba(0, 0, 0, 0.1)',
                p: 2,
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
              }}
            >
              <NavbarSearchBar />
              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                <CombinedFilterDropdown tabs={listingFilterTabs} />
                <NavbarSortDropdown />
              </Box>
            </Box>
          </Collapse>
        )}

        {isAuthenticated && isFellowshipsPage && isMobile && (
          <Collapse in={mobileFellowshipSearchOpen}>
            <Box
              sx={{
                bgcolor: 'white',
                boxShadow: '0px 2px 4px rgba(0, 0, 0, 0.1)',
                p: 2,
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
              }}
            >
              <NavbarFellowshipSearchBar />
              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                <CombinedFilterDropdown tabs={fellowshipFilterTabs} />
                <NavbarFellowshipSortDropdown />
              </Box>
            </Box>
          </Collapse>
        )}

        {isAuthenticated && isHomePage && (
          <ActiveFilters
            quickFilters={listingQuickFilters}
            activeQuickFilter={quickFilter}
            onQuickFilterChange={setQuickFilter}
            totalCount={totalCount}
            isLoading={listingLoading}
            chips={listingChips}
            onClearAll={() => {
              setSelectedDepartments([]);
              setSelectedResearchAreas([]);
              setSelectedListingResearchAreas([]);
              setQuickFilter(null);
            }}
            onHeightChange={setFilterBarHeight}
          />
        )}

        {isAuthenticated && isFellowshipsPage && (
          <ActiveFilters
            quickFilters={fellowshipQuickFilters}
            activeQuickFilter={fellowshipQuickFilter}
            onQuickFilterChange={setFellowshipQuickFilter}
            totalCount={fellowshipTotal}
            isLoading={fellowshipLoading}
            chips={fellowshipChips}
            onClearAll={() => {
              setSelectedYearOfStudy([]);
              setSelectedTermOfAward([]);
              setSelectedPurpose([]);
              setSelectedRegions([]);
              setSelectedCitizenship([]);
              setFellowshipQuickFilter(null);
            }}
            onHeightChange={setFellowshipFilterBarHeight}
          />
        )}
      </Box>
    </ThemeProvider>
  );
}
