//Cleans api response listing format to the listing type

export const createListing = (listing: any) => {
    return {
        id: listing._id,
        ownerId: listing.ownerId,
        ownerFirstName: listing.ownerFirstName,
        ownerLastName: listing.ownerLastName,
        ownerEmail: listing.ownerEmail,
        professorIds: listing.professorIds,
        professorNames: listing.professorNames,
        title: listing.title,
        departments: listing.departments,
        emails: listing.emails,
        websites: listing.websites,
        description: listing.description,
        keywords: listing.keywords,
        established: listing.established ? listing.established.toString() : undefined,
        views: listing.views,
        favorites: listing.favorites,
        hiringStatus: listing.hiringStatus,
        archived: listing.archived,
        updatedAt: listing.updatedAt,
        createdAt: listing.createdAt
    }
}