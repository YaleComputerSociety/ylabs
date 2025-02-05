//Listings

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