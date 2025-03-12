//Listings

export type NewListing = {
  id: number;
  professorIds: string[];
  professorNames: string[];
  title: string;
  departments: string[];
  emails: string[];
  websites: string[];
  description: string;
  keywords: string[];
  established: string;
  views: number;
  favorites: number;
  hiringStatus: number;
  archived: boolean;
  updatedAt: string;
  createdAt: string;
};

export type Listing = {
  id: number;
  departments: string;
  email: string;
  website: string;
  description: string;
  keywords: string;
  lastUpdated: string;
  name: string;
};

//Developer

export type Developer = {
  name: string;
  position: string;
  image?: string;
  location: string;
  website?: string;
  linkedin?: string;
  github?:string;
}