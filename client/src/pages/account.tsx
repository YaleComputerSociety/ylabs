import React, { useState } from "react";

// Minimal "pencil" icon as an SVG. You could also use a library (e.g., react-icons).
const PencilIcon = () => (
  <svg
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    viewBox="0 0 24 24"
    style={{ verticalAlign: "middle" }}
  >
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
  </svg>
);

/****************************************************************
 * Example listing interface matching your Mongoose listingSchema
 ***************************************************************/
interface Listing {
  _id: string;
  departments: string[];
  email: string;
  website?: string;
  description?: string;
  keywords?: string;
  last_updated: string;
  lname: string;
  fname: string;
  // (timestamps automatically handled by Mongoose; omitted here)
}

/****************************************************************
 * Example user interface matching your Mongoose userSchema
 ***************************************************************/
interface User {
  netid: string;
  email: string;
  isProfessor: boolean;
  fname: string;
  lname: string;
  website?: string;
  bio?: string;
  departments: string[];
  ownListings: Listing[];
  favListings: Listing[];
  // (timestamps automatically handled by Mongoose; omitted here)
}

/****************************************************************
 * FAKE DATA (no DB changes)
 * In a real app, you'd fetch user + listings from your server.
 ***************************************************************/
const fakeListings: Listing[] = [
  {
    _id: "LIST1001",
    departments: ["Computer Science", "Data Science"],
    email: "professor-ai@university.edu",
    website: "https://prof-ai.university.edu",
    description: "Deep learning research focusing on neural networks.",
    keywords: "Neural Networks, AI",
    last_updated: "2025-02-12",
    lname: "Smith",
    fname: "Alice",
  },
  {
    _id: "LIST1002",
    departments: ["Biology"],
    email: "dr.bio@university.edu",
    website: "https://bio.university.edu",
    description: "Research on CRISPR gene editing.",
    keywords: "CRISPR, Genetics",
    last_updated: "2025-01-25",
    lname: "Johnson",
    fname: "Bob",
  },
];

const Account: React.FC = () => {
  // Randomly pick one listing for demonstration:
  const randomIndex = Math.floor(Math.random() * fakeListings.length);
  const randomListing = fakeListings[randomIndex];

  // Example user: toggle isProfessor to see differences.
  const [user, setUser] = useState<User>({
    netid: "jdoe123",
    email: "jdoe123@university.edu",
    isProfessor: true,
    fname: "John",
    lname: "Doe",
    website: "https://johndoeprofessor.com",
    bio: "Professor of Computer Science specializing in AI.",
    departments: ["Computer Science"],
    ownListings: [randomListing], // if professor
    favListings: [],             // students would store randomListing here instead
  });

  // For adding a brand-new listing (professors only):
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");

  // For editing an existing listing (professors only):
  // We'll store the listing ID we're editing, plus local states for its new title + description.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [editingDescription, setEditingDescription] = useState("");

  /****************************************************************
   * Add new listing (client-side only)
   ****************************************************************/
  const handleAddListing = () => {
    const newId = (Math.random() * 1000000).toFixed(0);
    const newListing: Listing = {
      _id: newId,
      fname: user.fname,
      lname: user.lname,
      email: user.email,
      departments: user.departments, // or empty if you prefer
      last_updated: new Date().toISOString(),
      keywords: newTitle,
      description: newDescription,
    };
    setUser((prev) => ({
      ...prev,
      ownListings: [...prev.ownListings, newListing],
    }));

    setNewTitle("");
    setNewDescription("");
    setShowAddForm(false);
    alert("New listing added (no real DB update).");
  };

  /****************************************************************
   * Begin editing a listing
   ****************************************************************/
  const startEditing = (listing: Listing) => {
    setEditingId(listing._id);
    setEditingTitle(listing.keywords || "");
    setEditingDescription(listing.description || "");
  };

  /****************************************************************
   * Cancel editing
   ****************************************************************/
  const cancelEditing = () => {
    setEditingId(null);
    setEditingTitle("");
    setEditingDescription("");
  };

  /****************************************************************
   * Confirm & save edits to a listing
   ****************************************************************/
  const saveEdits = (listingId: string) => {
    if (!window.confirm("Are you sure you want to save these changes?")) {
      return;
    }
    setUser((prev) => {
      const updatedListings = prev.ownListings.map((lst) => {
        if (lst._id === listingId) {
          return {
            ...lst,
            keywords: editingTitle,
            description: editingDescription,
            last_updated: new Date().toISOString(),
          };
        }
        return lst;
      });
      return { ...prev, ownListings: updatedListings };
    });
    // Reset editing
    cancelEditing();
  };

  return (
    <div style={{ margin: 0, padding: 0 }}>
      {/* Inline styling adapted from your HTML snippet, plus a header section */}
      <style>{`
        body {
          margin: 0;
          font-family: 'Nunito', sans-serif;
          color: inherit; 
          background: inherit;
        }
        header.site-header {
          background: #333;
          color: #fff;
          padding: 1em;
        }
        header.site-header h1 {
          margin: 0;
          font-size: 1.5em;
        }
        .container {
          width: 100%;
          max-width: 1200px;
          margin: 0 auto;
          background: #fff;
          box-shadow: 0 2px 10px rgba(0,0,0,0.1);
          border-radius: 8px;
          padding: 20px;
        }
        .name, .tag-item, .listing-title, .listing-description {
          cursor: pointer;
          transition: background 0.3s, border 0.3s;
        }
        .name:hover,
        .tag-item:hover,
        .listing-title:hover,
        .listing-description:hover {
          background: #efefef;
        }
        .tags {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin: 10px 0;
        }
        .tag-item {
          background: #8dbec8;
          color: #fff;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 0.9em;
        }
        .listings-section {
          margin-top: 1.5em;
        }
        .listings {
          list-style: none;
          padding: 0;
          margin: 1em 0;
        }
        .listing-item {
          margin-bottom: 1.5em;
          border-left: 3px solid #8dbec8;
          padding-left: 8px;
          position: relative;
        }

        /* Pencil icon on hover */
        .edit-button {
          visibility: hidden;
          position: absolute;
          top: 0;
          right: 0;
          background: transparent;
          border: none;
          cursor: pointer;
          color: #555;
          padding: 4px;
        }
        .listing-item:hover .edit-button {
          visibility: visible;
        }

        .edit-button svg:hover {
          color: #000;
        }

        .buttons {
          margin-top: 20px;
          display: flex;
          gap: 10px;
        }
        .button-add,
        .button-save,
        .button-cancel {
          background: #8dbec8;
          color: #fff;
          border: none;
          padding: 8px 16px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 1em;
        }
        .button-add:hover,
        .button-save:hover,
        .button-cancel:hover {
          opacity: 0.8;
        }
        .button-save {
          background: #9db53c;
        }
        .button-cancel {
          background: #c42b1c;
        }
        .add-listing-form {
          display: ${showAddForm ? "block" : "none"};
          margin-top: 20px;
          background: #f2f2f2;
          padding: 10px;
          border-radius: 6px;
        }
        label {
          display: block;
          margin: 6px 0 3px;
        }
        input[type="text"],
        textarea {
          width: 100%;
          padding: 8px;
          box-sizing: border-box;
          font-family: 'Nunito', sans-serif;
        }
      `}</style>

      {/* SITE HEADER */}
      <header className="site-header">
        <h1>My University Portal</h1>
      </header>

      {/* MAIN CONTENT */}
      <div className="container">
        <h2>Account Page</h2>
        <h3 className="name">
          {user.fname} {user.lname}
        </h3>

        {/* Departments as tags */}
        <div className="tags">
          {user.departments.map((dept, idx) => (
            <span key={idx} className="tag-item">
              {dept}
            </span>
          ))}
        </div>

        {/* If professor, show "Own Listings" + editing logic */}
        {user.isProfessor && (
          <div className="listings-section">
            <h3>Your Own Listings</h3>
            {user.ownListings.length > 0 ? (
              <ul className="listings">
                {user.ownListings.map((listing) => {
                  const isEditing = listing._id === editingId;
                  return (
                    <li key={listing._id} className="listing-item">
                      {/* Pencil icon (appears on hover) */}
                      {!isEditing && (
                        <button
                          className="edit-button"
                          onClick={() => startEditing(listing)}
                        >
                          <PencilIcon />
                        </button>
                      )}

                      {/* If user is editing this listing, show input fields */}
                      {isEditing ? (
                        <>
                          <label>Title:</label>
                          <input
                            type="text"
                            value={editingTitle}
                            onChange={(e) => setEditingTitle(e.target.value)}
                          />
                          <label>Description:</label>
                          <textarea
                            rows={3}
                            value={editingDescription}
                            onChange={(e) => setEditingDescription(e.target.value)}
                          />
                          <div style={{ marginTop: "10px" }}>
                            <button
                              className="button-save"
                              onClick={() => saveEdits(listing._id)}
                            >
                              Save
                            </button>
                            <button
                              className="button-cancel"
                              onClick={cancelEditing}
                            >
                              Cancel
                            </button>
                          </div>
                        </>
                      ) : (
                        // Otherwise show read-only
                        <>
                          <div className="listing-title">
                            <strong>{listing.keywords || "(No Title)"}</strong>
                          </div>
                          <div className="listing-description">
                            {listing.description || "No Description"}
                          </div>
                          <small style={{ color: "#666" }}>
                            Last updated: {listing.last_updated}
                          </small>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p>You currently have no listings.</p>
            )}
          </div>
        )}

        {/* Everyone sees favorite listings */}
        <div className="listings-section">
          <h3>Your Favorite Listings</h3>
          {user.favListings.length > 0 ? (
            <ul className="listings">
              {user.favListings.map((fav) => (
                <li key={fav._id} className="listing-item">
                  <div className="listing-title">
                    <strong>{fav.keywords || "(No Title)"}</strong>
                  </div>
                  <div className="listing-description">
                    {fav.description || "No Description"}
                  </div>
                  <small style={{ color: "#666" }}>
                    Last updated: {fav.last_updated}
                  </small>
                </li>
              ))}
            </ul>
          ) : (
            <p>No favorite listings yet.</p>
          )}
        </div>

        {/* If professor, allow adding new listings (client-only) */}
        {user.isProfessor && (
          <>
            <div className="buttons">
              <button className="button-add" onClick={() => setShowAddForm(true)}>
                Add New Listing
              </button>
            </div>

            {/* New listing form */}
            <div className="add-listing-form">
              <label htmlFor="newListingTitle">Title:</label>
              <input
                type="text"
                id="newListingTitle"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Enter listing title"
              />

              <label htmlFor="newListingDescription">Description:</label>
              <textarea
                id="newListingDescription"
                rows={4}
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="Enter listing description"
              />

              <div style={{ marginTop: "10px" }}>
                <button className="button-add" onClick={handleAddListing}>
                  Add
                </button>
                <button className="button-cancel" onClick={() => setShowAddForm(false)}>
                  Cancel
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default Account;
