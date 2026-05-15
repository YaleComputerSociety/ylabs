/**
 * Professor dashboard section: manage a professor's own posted roles (create, edit
 * inline, save, delete). Owns the own-listings reducer and its axios/side-
 * effect lifecycle (fetch on mount, beforeunload warning while editing).
 * Extracted from pages/account.tsx as part of the three-way split with
 * ProfileEditor and FavoritesManager.
 */
import { useEffect, useReducer } from 'react';
import { Listing, User } from '../../types/types';
import {
  ownListingsReducer,
  createInitialOwnListingsState,
} from '../../reducers/ownListingsReducer';
import { createListing } from '../../utils/apiCleaner';
import axios from '../../utils/axios';
import swal from 'sweetalert';
import ListingCard from './ListingCard';
import CreateButton from './CreateButton';
import LoadingSpinner from '../shared/LoadingSpinner';

interface ListingEditorProps {
  user: User | null;
}

const ListingEditor = ({ user }: ListingEditorProps) => {
  const [state, dispatch] = useReducer(ownListingsReducer, undefined, () =>
    createInitialOwnListingsState({ isLoading: true }),
  );
  const { ownListings, isLoading, isEditing, isCreating } = state;

  const reloadListings = async () => {
    dispatch({ type: 'SET_LOADING', value: true });

    await axios
      .get('/users/listings', { withCredentials: true })
      .then((response) => {
        const responseOwnListings: Listing[] = response.data.ownListings.map(function (elem: any) {
          return createListing(elem);
        });
        dispatch({ type: 'SET_OWN_LISTINGS', listings: responseOwnListings });
        dispatch({ type: 'SET_LOADING', value: false });
      })
      .catch((error) => {
        console.error('Error fetching posted roles:', error);
        dispatch({ type: 'SET_OWN_LISTINGS', listings: [] });
        dispatch({ type: 'SET_LOADING', value: false });
        swal({ text: 'Error fetching your posted roles', icon: 'warning' });
      });
  };

  useEffect(() => {
    reloadListings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isEditing) {
        const message = 'You have unsaved changes that will be lost if you leave this page.';
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

  const setGlobalEditing = (editing: boolean) => {
    if (editing) {
      dispatch({ type: 'START_EDIT' });
    } else {
      dispatch({ type: 'END_EDIT' });
    }
  };

  const updateListing = (listing: Listing) => {
    dispatch({ type: 'UPDATE_LISTING', listing });
  };

  const postListing = (listing: Listing) => {
    dispatch({ type: 'SET_LOADING', value: true });
    const isNewListing = listing.id === 'create';
    const request = isNewListing
      ? axios.post('/listings', { withCredentials: true, data: listing })
      : axios.put(`/listings/${listing.id}`, { withCredentials: true, data: listing });

    request
      .then(() => {
        reloadListings();
        dispatch({ type: 'END_EDIT' });
        dispatch({ type: 'SET_LOADING', value: false });
      })
      .catch((error) => {
        console.error(
          isNewListing ? 'Error creating posted role:' : 'Error updating posted role:',
          error,
        );
        swal({
          text: isNewListing ? 'Unable to create posted role' : 'Unable to update posted role',
          icon: 'warning',
        });
        reloadListings();
        dispatch({ type: 'END_EDIT' });
        dispatch({ type: 'SET_LOADING', value: false });
      });
  };

  const clearCreatedListing = () => {
    dispatch({ type: 'CANCEL_CREATE' });
  };

  const deleteListing = (listing: Listing) => {
    dispatch({ type: 'SET_LOADING', value: true });
    axios
      .delete(`/listings/${listing.id}`, { withCredentials: true })
      .then(() => {
        reloadListings();
        dispatch({ type: 'SET_LOADING', value: false });
      })
      .catch((error) => {
        console.error('Error deleting posted role:', error);
        swal({ text: 'Unable to delete posted role', icon: 'warning' });
        reloadListings();
        dispatch({ type: 'SET_LOADING', value: false });
      });
  };

  const onCreate = () => {
    axios
      .get('/listings/skeleton', { withCredentials: true })
      .then((response) => {
        const skeletonListing = createListing(response.data.listing);
        dispatch({ type: 'START_CREATE', skeleton: skeletonListing });
      })
      .catch((error) => {
        console.error('Error fetching skeleton posted role:', error);
        swal({ text: 'Unable to create posted role', icon: 'warning' });
      });
  };

  // ListingCard requires favorite/modal callbacks even for owned listings;
  // favorites and the detail modal are owned by FavoritesManager, so stub these
  // out with no-ops here.
  const noopUpdateFavorite = () => {};
  const noopOpenModal = () => {};

  if (isLoading) {
    return (
      <div className="flex justify-center pt-12">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <>
      <h2 className="text-2xl font-bold text-gray-800 text-center mb-6 pb-2">
        Your Posted Roles
      </h2>
      {!user.profileVerified && user.userType !== 'admin' ? (
        <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg text-center my-6">
          <p className="text-sm text-gray-600">
            Verify your profile above to create and manage posted roles.
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
                    favListingsIds={[]}
                    updateFavorite={noopUpdateFavorite}
                    updateListing={updateListing}
                    postListing={postListing}
                    clearCreatedListing={clearCreatedListing}
                    deleteListing={deleteListing}
                    openModal={noopOpenModal}
                    globalEditing={isEditing}
                    setGlobalEditing={setGlobalEditing}
                    editable={true}
                    reloadListings={reloadListings}
                  />
                </li>
              ))}
            </ul>
          )}
          {!isCreating && (
            <div
              className={`flex justify-center align-center ${ownListings.length > 0 ? 'mb-6 mt-4' : 'my-10'}`}
            >
              <CreateButton globalEditing={isEditing} handleCreate={onCreate} />
            </div>
          )}
        </>
      )}
    </>
  );
};

export default ListingEditor;
