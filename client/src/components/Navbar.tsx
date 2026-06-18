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
import HomeButton from './HomeButton';
import YURAButton from './YURAButton';
import AnalyticsButton from './AnalyticsButton';
import UserContext from '../contexts/UserContext';
import SearchContext from '../contexts/SearchContext';
import FeedbackButton from './FeebackButton';
import NavbarSearchBar from './navbar/NavbarSearchBar';
import NavbarSortDropdown from './navbar/NavbarSortDropdown';
import CombinedFilterDropdown, { FilterTabConfig } from './shared/CombinedFilterDropdown';
import ActiveFilters, { ActiveFilterChip, QuickFilterDef } from './shared/ActiveFilters';
import ViewModeToggle from './shared/ViewModeToggle';
import { getColorForResearchArea } from '../utils/researchAreas';
import { useConfig } from '../hooks/useConfig';
import { isPrimaryNavLinkActive, primaryNavLinks } from './navigationLinks';
import { safeRouteSegment } from '../utils/url';

import { ThemeProvider } from '@mui/material/styles';
import theme from '../utils/muiTheme';

const MOBILE_BREAKPOINT = '768px';

const HamburgerIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="3" y1="12" x2="21" y2="12"></line>
    <line x1="3" y1="6" x2="21" y2="6"></line>
    <line x1="3" y1="18" x2="21" y2="18"></line>
  </svg>
);

const CloseIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"></line>
    <line x1="6" y1="6" x2="18" y2="18"></line>
  </svg>
);

const SearchIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="11" cy="11" r="8" />
    <path d="M21 21l-4.35-4.35" />
  </svg>
);

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
      return { bg: 'bg-[var(--yr-panel-muted)]', text: 'text-gray-800' };
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
  return m[area] || 'bg-[var(--yr-panel-muted)] text-gray-900';
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

export default function Navbar() {
  const { isAuthenticated, user } = useContext(UserContext);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const isMobile = useMediaQuery(`(max-width:${MOBILE_BREAKPOINT})`);
  const showPageControlsPanel = useMediaQuery('(max-width:1279px)');
  const location = useLocation();

  const isAdmin = user?.userType === 'admin';
  const isProfessorUser = user?.userType === 'professor' || user?.userType === 'faculty';
  const isListingsPage = false;
  const isHomePage = isListingsPage;

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

  const listingChips: ActiveFilterChip[] = [
    ...selectedResearchAreas.map((area) => ({
      key: `area-${area}`,
      label: area,
      colorClass: `${getResearchAreaChipColor(area)} border border-[var(--yr-line-strong)]`,
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
        minHeight: 44,
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
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', p: 1 }}>
          <IconButton
            size="large"
            aria-label="Close menu"
            onClick={(event) => {
              event.stopPropagation();
              setDrawerOpen(false);
            }}
            sx={{
              borderRadius: '4px',
              height: 44,
              width: 44,
              padding: '8px',
              '&:hover': { backgroundColor: 'transparent' },
            }}
          >
            <CloseIcon />
          </IconButton>
        </Box>
        <List>
          {isAuthenticated ? (
            <>
              {primaryNavLinks.map((link) => {
                const active = isPrimaryNavLinkActive(location.pathname, link);
                return (
                  <ListItem key={link.key} sx={listItemStyle}>
                    <Button
                      component={Link}
                      to={link.to}
                      sx={{
                        textTransform: 'none',
                        color: active ? 'var(--yr-blue)' : 'var(--yr-text)',
                        fontWeight: active ? 600 : 400,
                        justifyContent: 'flex-start',
                        minHeight: 44,
                        width: '100%',
                        pl: 1,
                      }}
                    >
                      {link.label}
                    </Button>
                  </ListItem>
                );
              })}
              <ListItem sx={listItemStyle}>
                <AboutButton />
              </ListItem>
              {isAdmin && (
                <ListItem sx={listItemStyle}>
                  <AnalyticsButton />
                </ListItem>
              )}
              {isProfessorUser && (
                <ListItem sx={listItemStyle}>
                  <Button
                    component={Link}
                    to="/account"
                    sx={{
                      textTransform: 'none',
                      color: location.pathname === '/account' ? 'var(--yr-blue)' : 'var(--yr-text)',
                      fontWeight: location.pathname === '/account' ? 600 : 400,
                      justifyContent: 'flex-start',
                      minHeight: 44,
                      width: '100%',
                      pl: 1,
                    }}
                  >
                    Edit Profile
                  </Button>
                </ListItem>
              )}
              {isProfessorUser && user?.netId && (
                <ListItem sx={listItemStyle}>
                  <Button
                    component={Link}
                    to={`/profile/${safeRouteSegment(user.netId)}`}
                    sx={{
                      textTransform: 'none',
                      color:
                        location.pathname === `/profile/${user.netId}` ? 'var(--yr-blue)' : 'var(--yr-text)',
                      fontWeight: location.pathname === `/profile/${user.netId}` ? 600 : 400,
                      justifyContent: 'flex-start',
                      minHeight: 44,
                      width: '100%',
                      pl: 1,
                    }}
                  >
                    Public Profile
                  </Button>
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
            background: 'color-mix(in srgb, var(--yr-panel) 96%, var(--yr-page))',
            color: 'var(--yr-ink)',
            height: { xs: '68px', sm: '68px' },
            '& .MuiToolbar-root': {
              minHeight: '68px !important',
              height: '68px !important',
              paddingLeft: { xs: '20px !important', sm: '32px !important' },
              paddingRight: { xs: '16px', lg: '24px' },
              transition: 'padding 0.3s ease',
            },
            boxShadow: '0 1px 0 rgba(11, 31, 58, 0.06)',
            borderBottom: '1px solid var(--yr-line)',
          }}
        >
          <Toolbar sx={{ height: '68px', width: '100%', justifyContent: 'flex-start' }}>
            <Box sx={{ flexShrink: 0 }}>{isAuthenticated ? <HomeButton /> : <YURAButton />}</Box>

            {isAuthenticated && isListingsPage && (
              <Box
                sx={{
                  display: { xs: 'none', xl: 'flex' },
                  gap: '12px',
                  ml: 1,
                  alignItems: 'center',
                  minWidth: 0,
                  flexShrink: 1,
                  flexGrow: 1,
                  overflow: 'hidden',
                }}
              >
                <NavbarSearchBar />
                <CombinedFilterDropdown tabs={listingFilterTabs} />
                <NavbarSortDropdown />
                <ViewModeToggle />
              </Box>
            )}

            {isAuthenticated && (
              <>
                <Box
                  sx={{
                    display: 'flex',
                    gap: { xs: '8px', lg: '14px' },
                    alignItems: 'center',
                    ml: 'auto',
                    flexShrink: 0,
                  }}
                >
                  {!isMobile && (
                    <>
                      <Box
                        component="nav"
                        aria-label="Primary navigation"
                        sx={{ display: 'flex', gap: 0, alignItems: 'center', flexShrink: 0 }}
                      >
                        {primaryNavLinks.map((link) => {
                          const active = isPrimaryNavLinkActive(location.pathname, link);
                          return (
                            <Button
                              key={link.key}
                              component={Link}
                              to={link.to}
                              disableRipple
                              className={`!normal-case !text-sm !min-w-0 !min-h-[44px] !px-3 !py-0 !inline-flex !items-center !rounded-none !border-b-2 hover:!bg-transparent ${active ? '!font-semibold !text-[var(--yr-blue)] !border-[var(--yr-blue)] hover:!text-[var(--yr-blue)]' : '!font-normal !text-[var(--yr-muted)] !border-transparent hover:!text-[var(--yr-blue)]'}`}
                              sx={{
                                borderRadius: '6px 6px 0 0',
                                transition:
                                  'background-color 150ms ease, color 150ms ease, border-color 150ms ease',
                                '&:hover': {
                                  backgroundColor: 'rgba(24, 74, 155, 0.05) !important',
                                },
                                '&:focus-visible': {
                                  outline: '2px solid rgba(0, 53, 107, 0.45)',
                                  outlineOffset: '2px',
                                },
                              }}
                            >
                              {link.label}
                            </Button>
                          );
                        })}
                      </Box>
                      {isAdmin && <AnalyticsButton />}
                      <UserButton />
                    </>
                  )}
                  {isListingsPage && showPageControlsPanel && (
                    <IconButton
                      size="small"
                      color="inherit"
                      aria-label="search"
                      onClick={() => setMobileSearchOpen(!mobileSearchOpen)}
                      sx={{
                        borderRadius: '4px',
                        height: 44,
                        width: 44,
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
                      aria-label="Open menu"
                      aria-expanded={drawerOpen}
                      aria-controls="primary-mobile-menu"
                      onClick={toggleDrawer(true)}
                      sx={{
                        borderRadius: '4px',
                        height: 44,
                        width: 44,
                        padding: '8px',
                        '&:hover': { backgroundColor: 'transparent' },
                      }}
                    >
                      <HamburgerIcon />
                    </IconButton>
                  )}
                </Box>
                <Drawer
                  anchor="right"
                  open={drawerOpen}
                  onClose={toggleDrawer(false)}
                  slotProps={{ paper: { id: 'primary-mobile-menu' } }}
                >
                  {mobileMenu()}
                </Drawer>
              </>
            )}
          </Toolbar>
        </AppBar>

        {isAuthenticated && isListingsPage && showPageControlsPanel && (
          <Collapse in={mobileSearchOpen}>
            <Box
              sx={{
                bgcolor: 'var(--yr-panel)',
                borderTop: '1px solid var(--yr-line)',
                boxShadow: '0px 2px 4px rgba(11, 31, 58, 0.1)',
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

        {isAuthenticated && isListingsPage && (
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

      </Box>
    </ThemeProvider>
  );
}
