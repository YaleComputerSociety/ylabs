//Cleans api response listing format to the listing type

export const createListing = (listing: any) => {
    const titleDefault = "";
    const descriptionDefault = "";
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
        applicantDescription: listing.applicantDescription || '',
        keywords: listing.keywords || [],
        researchAreas: listing.researchAreas || listing.keywords || [],
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