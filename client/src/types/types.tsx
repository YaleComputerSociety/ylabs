//Listings

export type Listing = {
  id: string;
  ownerId: string;
  ownerFirstName: string;
  ownerLastName: string;
  ownerEmail: string;
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
  confirmed: boolean;
};

export type User = {
  netId: string;
  userType: string;
  userConfirmed: boolean;
}

export type UserData = {
  netId: string;
  userType: string;
  userConfirmed: boolean;
}


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

interface ImportMeta {
  readonly env: {
    readonly VITE_APP_TITLE: string;
    readonly MODE: string;
    readonly BASE_URL: string;
    readonly PROD: boolean;
    readonly DEV: boolean;
    [key: string]: string | boolean | undefined;
  };
}