//Cleans api response listing format to the listing type

export const createListing = (listing: any) => {
    const titleDefault = listing._id === "create" ? "* Your Lab's Name (or Professor's Name) *" : "";
    const descriptionDefault = listing._id === "create" ? "This is your new listing! Please edit the details and click save to post it. If you click cancel, this listing will be deleted." : "";
    const currentDate = new Date();

    return {
        id: listing._id,
        ownerId: listing.ownerId,
        ownerFirstName: listing.ownerFirstName,
        ownerLastName: listing.ownerLastName,
        ownerEmail: listing.ownerEmail,
        professorIds: listing.professorIds || [],
        professorNames: listing.professorNames || [],
        title: listing.title || titleDefault,
        departments: listing.departments || [],
        emails: listing.emails || [],
        websites: listing.websites || [],
        description: listing.description || descriptionDefault,
        keywords: listing.keywords || [],
        established: listing.established && listing.established.toString(),
        views: listing.views || 0,
        favorites: listing.favorites || 0,
        hiringStatus: listing.hiringStatus || 0,
        archived: listing.archived || false,
        updatedAt: listing.updatedAt || currentDate.toISOString(),
        createdAt: listing.createdAt || currentDate.toISOString(),
        confirmed: listing.confirmed === undefined ? true : listing.confirmed,
    }
}